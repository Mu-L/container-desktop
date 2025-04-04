import { isEmpty } from "lodash-es";

import { systemNotifier } from "@/container-client/notifier";
import { Runner } from "@/container-client/runner";
import {
  type ApiConnection,
  type ApiStartOptions,
  type AvailabilityCheck,
  type CommandExecutionResult,
  type Connection,
  type ContainerEngine,
  ContainerEngineHost,
  type ControllerScope,
  type EngineConnectorAvailability,
  type EngineConnectorSettings,
  type ILogger,
  OperatingSystem,
  type Program,
  type RunnerStopperOptions,
  type StartupStatus,
  type SubscriptionOptions,
  type SystemInfo,
  type SystemPruneReport,
  type SystemResetReport,
} from "@/env/Types";
import { createLogger } from "@/logger";
import { deepMerge } from "@/utils";
import type EventEmitter from "eventemitter3";
import { ContainerClient, createApplicationApiDriver } from "../../Api.clients";
import { findProgramPath, findProgramVersion } from "../../detector";

export abstract class AbstractEngine {
  protected logLevel = "debug";

  public static ENGINE: ContainerEngine;
  public ENGINE!: ContainerEngine;
  public ENGINE_HOST_CLIENTS: (typeof AbstractContainerEngineHostClient)[] = [];

  public osType: OperatingSystem;

  public logger!: ILogger;

  static create(a, b?: any): Promise<AbstractEngine> {
    throw new Error("Must implement");
  }

  constructor(osType: OperatingSystem) {
    this.osType = osType || CURRENT_OS_TYPE;
  }

  setLogLevel(level: string): void {
    console.debug("Setting engine log level", level);
    this.logLevel = level;
  }

  async setup() {
    this.logger = createLogger(`${this.ENGINE}.host`);
    this.logger.debug(this.ENGINE, "Created adapter");
  }

  async createEngineHostClient(
    host: typeof AbstractContainerEngineHostClient,
    id: string,
  ): Promise<AbstractContainerEngineHostClient> {
    return await host.create(id, this.osType);
  }

  async createEngineHostClientByName(host: ContainerEngineHost, id: string) {
    const EngineHostClient = this.ENGINE_HOST_CLIENTS.find((it) => it.HOST === host);
    if (!EngineHostClient) {
      this.logger.error("Unable to find specified host", host, "within known engines", this.ENGINE_HOST_CLIENTS);
      throw new Error("Unable to find specified host");
    }
    return await this.createEngineHostClient(EngineHostClient, id);
  }
}

export interface ContainerEngineHostClient {
  startApi(customSettings?: EngineConnectorSettings, opts?: ApiStartOptions);
  isEngineAvailable();
  getApiConnection(connection?: Connection, customSettings?: EngineConnectorSettings): Promise<ApiConnection>;
  getSettings(): Promise<EngineConnectorSettings>;
  getAutomaticSettings(): Promise<EngineConnectorSettings>;
  // Controller behavior
  isScoped(): boolean;
  getControllerScopes(
    customSettings?: EngineConnectorSettings,
    skipAvailabilityCheck?: boolean,
  ): Promise<ControllerScope[]>;
  startScope(scope: ControllerScope): Promise<StartupStatus>;
  stopScope(scope: ControllerScope): Promise<boolean>;
  startScopeByName(name: string): Promise<StartupStatus>;
  stopScopeByName(name: string): Promise<boolean>;

  isApiRunning(): Promise<AvailabilityCheck>;
  getSystemInfo(
    connection?: Connection,
    customFormat?: string,
    customSettings?: EngineConnectorSettings,
  ): Promise<SystemInfo>;

  setLogLevel(level: string): void;
  getEvents(opts?: SubscriptionOptions): Promise<any[]>;
}

export abstract class AbstractContainerEngineHostClient implements ContainerEngineHostClient {
  public static HOST: ContainerEngineHost;

  public LABEL = "Abstract";
  public PROGRAM!: string;
  public CONTROLLER!: string;
  public ENGINE!: ContainerEngine;
  public HOST!: ContainerEngineHost;
  public id!: string;

  protected osType: OperatingSystem;
  protected apiStarted: boolean;
  protected logLevel = "debug";

  protected runner!: Runner;
  protected settings: EngineConnectorSettings = {
    api: {
      baseURL: "",
      connection: {
        uri: "",
        relay: "",
      },
    },
    program: {
      name: this.PROGRAM,
      path: this.PROGRAM,
      version: "",
    },
    rootfull: false,
    mode: "mode.automatic",
  };

  public logger!: ILogger;
  protected containerApiClient?: ContainerClient;

  abstract startApi(customSettings?: EngineConnectorSettings, opts?: ApiStartOptions);
  abstract isEngineAvailable(): Promise<AvailabilityCheck>;
  abstract getApiConnection(connection?: Connection, customSettings?: EngineConnectorSettings): Promise<ApiConnection>;
  // Controller behavior
  abstract isScoped(): boolean;
  abstract getControllerScopes(
    customSettings?: EngineConnectorSettings,
    skipAvailabilityCheck?: boolean,
  ): Promise<ControllerScope[]>;
  abstract getControllerDefaultScope(customSettings?: EngineConnectorSettings): Promise<ControllerScope | undefined>;
  abstract startScope(scope: ControllerScope): Promise<StartupStatus>;
  abstract stopScope(scope: ControllerScope): Promise<boolean>;
  abstract startScopeByName(name: string): Promise<StartupStatus>;
  abstract stopScopeByName(name: string): Promise<boolean>;

  abstract shouldKeepStartedScopeRunning(): boolean;

  constructor(osType: OperatingSystem) {
    this.osType = osType || CURRENT_OS_TYPE;
    this.apiStarted = false;
  }
  getEvents(opts?: SubscriptionOptions): Promise<any[]> {
    throw new Error("Method not implemented.");
  }

  setLogLevel(level: string): void {
    console.debug("Setting container engine host client log level", level);
    this.logLevel = level;
    if (this.containerApiClient) {
      this.containerApiClient.setLogLevel(level);
    }
  }

  async getContainerApiClient() {
    if (!this.containerApiClient) {
      const connection: Connection = {
        name: "Current",
        label: "Current",
        settings: this.settings,
        engine: this.ENGINE,
        host: this.HOST,
        id: this.id,
      };
      this.containerApiClient = new ContainerClient(connection, createApplicationApiDriver(connection));
      this.containerApiClient.setLogLevel(this.logLevel);
    }
    return this.containerApiClient;
  }

  static create(id: string, osType: OperatingSystem): Promise<AbstractContainerEngineHostClient> {
    throw new Error("Must implement");
  }

  async setup() {
    this.runner = new Runner(this);
    this.logger = createLogger("host.client");
    this.logger.debug(this.id, "Client host created", this.settings);
  }

  async setSettings(settings: EngineConnectorSettings) {
    this.settings = settings;
  }

  async getAutomaticSettings(): Promise<EngineConnectorSettings> {
    this.logger.warn(this.id, "Settings are in automatic mode - fetching");
    const settings = await this.getSettings();
    try {
      // 1.0 - detect program
      if (this.isScoped()) {
        const existingScope = settings.controller?.scope || "";
        const controllerProgram = await this.findHostProgram({ name: this.CONTROLLER, path: "" }, settings);
        settings.controller = controllerProgram;
        settings.controller.scope = existingScope;
        if (isEmpty(existingScope)) {
          const defaultScope = await this.getControllerDefaultScope(settings);
          this.logger.warn(this.id, "Default scope is", defaultScope);
          if (defaultScope) {
            settings.controller.scope = defaultScope.Name;
            if (defaultScope.Usable) {
              const scopeProgram = await this.findScopeProgram({ name: this.PROGRAM, path: "" }, settings);
              settings.program = scopeProgram;
            } else {
              this.logger.warn(this.id, "Default scope is not usable - program will not be detected");
            }
            // API connection
          } else {
            this.logger.error(this.id, "No default scope found - program will not be detected");
          }
        } else {
          try {
            const scopeProgram = await this.findScopeProgram({ name: this.PROGRAM, path: "" }, settings);
            settings.program = scopeProgram;
          } catch (error: any) {
            this.logger.error(this.id, "Unable to get scope program", error);
          }
        }
      } else {
        const hostProgram = await this.findHostProgram({ name: this.PROGRAM, path: "" }, settings);
        settings.program = hostProgram;
      }
      // 2.0 - detect API connection
      const api = await this.getApiConnection(undefined, settings);
      settings.api.connection.uri = api.uri;
      settings.api.connection.relay = api.relay;
    } catch (error: any) {
      this.logger.error(this.id, "Unable to get automatic settings", error);
    }
    return settings;
  }

  async getSettings(): Promise<EngineConnectorSettings> {
    return this.settings;
  }

  async stopApi(customSettings?: EngineConnectorSettings, opts?: RunnerStopperOptions) {
    this.logger.debug("Stopping API - begin");
    const settings = customSettings || (await this.getSettings());
    await Command.StopConnectionServices(this.id, settings);
    if (!this.runner) {
      this.logger.warn("Stopping API - skip(no runner)");
      return true;
    }
    if (!this.apiStarted) {
      this.logger.debug("Stopping API - skip(not started here)");
      return false;
    }
    const stopped = await this.runner.stopApi(settings, opts);
    this.logger.debug("Stopping API - complete", { stopped });
    if (stopped) {
      this.apiStarted = false;
    }
    return stopped;
  }

  async isProgramAvailable(settings: EngineConnectorSettings): Promise<AvailabilityCheck> {
    const result: AvailabilityCheck = { success: false, details: undefined };
    const currentSettings = settings || (await this.getSettings());
    const programPath = currentSettings.program.path || currentSettings.program.name;
    // Native path to program
    if (!programPath) {
      result.details = "Path not set";
      return result;
    }
    if (!(await FS.isFilePresent(programPath))) {
      result.details = "Not present in path";
      return result;
    }
    result.success = true;
    result.details = "Program is available";
    return result;
  }

  async isApiAvailable(): Promise<AvailabilityCheck> {
    const result: AvailabilityCheck = { success: false, details: undefined };
    const settings = await this.getSettings();
    if (!settings.api.baseURL) {
      result.details = "API base URL is not set";
      this.logger.error(result.details);
      return result;
    }
    if (!settings.api.connection) {
      result.details = "API connection string is not set";
      this.logger.error(result.details);
      return result;
    }
    // Check unix socket as file
    if (this.osType === OperatingSystem.Windows) {
      // TODO: Check named pipe
    } else {
      // if (!isFilePresent(settings.api.connection)) {
      //   result.details = "API connection string as unix path is not present";
      //   return result;
      // }
    }
    result.success = true;
    result.details = "API is configured";
    return result;
  }

  async isApiRunning() {
    systemNotifier.transmit("engine.availability", {
      trace: "Checking if API is running",
    });
    this.logger.debug(this.id, ">> Checking if API is running");
    // Guard configuration
    const available = await this.isApiAvailable();
    if (!available.success) {
      this.logger.error(this.id, "API is not available - unable to ping", available);
      return available;
    }
    // Test reachability
    const result: AvailabilityCheck = {
      success: false,
      details: undefined,
    };
    const client = await this.getContainerApiClient();
    const driver = client.getDriver();
    systemNotifier.transmit("engine.availability", {
      trace: "Performing api health check - start",
    });
    try {
      const response = await driver.request({
        method: "GET",
        url: "/_ping",
        timeout: 3000,
      });
      result.success = response?.data === "OK";
      result.details = result.success ? "Api is reachable" : response?.data;
      if (!result.success) {
        this.logger.error(this.id, "API ping service failed - response error", response);
      }
    } catch (error: any) {
      result.details = "API is not reachable - start manually or connect";
      this.logger.error(this.id, "API ping service failed - response failure", error, driver);
    }
    systemNotifier.transmit("engine.availability", {
      trace: "Performing api health check - complete",
    });
    this.logger.debug(this.id, "<< Checking if API is running", result);
    return result;
  }

  // Executes command inside controller scope

  async runHostCommand(program: string, args?: string[], settings?: EngineConnectorSettings) {
    const commandLauncher =
      this.osType === OperatingSystem.Windows && !program.endsWith(".exe") ? `${program}.exe` : program;
    const commandLine = [commandLauncher].concat(args || []).join(" ");
    this.logger.debug(this.id, ">> Running host command", commandLine);
    const result = await Command.Execute(commandLauncher, args || []);
    this.logger.debug(this.id, "<< Running host command", commandLine, {
      success: result.success,
      code: result.code,
      stderr: result.stderr || "",
    });
    return result;
  }

  // System commands

  async getSystemInfo(connection?: Connection, customFormat?: string, customSettings?: EngineConnectorSettings) {
    let info: SystemInfo = {} as SystemInfo;
    let result: CommandExecutionResult;
    const settings = customSettings || (await this.getSettings());
    const programPath = settings.program.path || settings.program.name || "";
    if (this.isScoped()) {
      result = await this.runScopeCommand(
        programPath,
        ["system", "info", "--format", customFormat || "json"],
        settings.controller?.scope || "",
        settings,
      );
    } else {
      result = await this.runHostCommand(programPath, ["system", "info", "--format", customFormat || "json"], settings);
    }
    if (!result.success) {
      this.logger.error(this.id, "Unable to get system info", result);
      return info;
    }
    try {
      info = result.stdout ? JSON.parse(result.stdout) : info;
    } catch (error: any) {
      this.logger.error(this.id, "Unable to decode system info", error, result);
    }
    return info;
  }

  async pruneSystem(opts?: any) {
    const input: any = {
      all: true,
      filter: {},
      force: true,
      volumes: false,
      ...(opts || {}),
    };
    const args = ["system", "prune"];
    if (input.all) {
      args.push("--all");
    }
    if (input.filter) {
      args.push(...Object.keys(input.filter).map((key) => `label=${key}=${input.filter[key]}`));
    }
    if (input.force) {
      args.push("--force");
    }
    if (input.volumes) {
      args.push("--volumes");
    }
    const settings = await this.getSettings();
    const programPath = settings.program.path || settings.program.name || "";
    let result: CommandExecutionResult;
    if (this.isScoped()) {
      result = await this.runScopeCommand(programPath, args, settings.controller?.scope || "");
    } else {
      result = await this.runHostCommand(programPath, args);
    }
    if (result.success) {
      this.logger.debug(this.id, "System prune complete", result);
      try {
        // TODO: Parse report
        const report: SystemPruneReport = {} as any;
        return report;
      } catch (error: any) {
        this.logger.error(this.id, "Unable to decode system info", error, result);
      }
    } else {
      this.logger.error(this.id, "System prune error", result);
    }
    throw new Error("Unable to prune system");
  }

  async resetSystem() {
    if (this.PROGRAM === "docker") {
      this.logger.debug(this.id, "No such concept for current host - skipping");
      return true;
    }
    const settings = await this.getSettings();
    const programPath = settings.program.path || settings.program.name || "";
    const args = ["system", "reset", "--force", "--log-level=debug"];
    let result: CommandExecutionResult;
    if (this.isScoped()) {
      result = await this.runScopeCommand(programPath, args, settings.controller?.scope || "");
    } else {
      result = await this.runHostCommand(programPath, args);
    }
    if (result.success) {
      this.logger.debug(this.id, "System reset success", result);
      try {
        const report: SystemResetReport = JSON.parse(result.stdout || "{}");
        return report;
      } catch (error: any) {
        this.logger.error(this.id, "Unable to decode system info", error, result);
      }
    } else {
      this.logger.error(this.id, "System reset error", result);
    }
    throw new Error("Unable to reset system");
  }

  // System events

  async getEventsStream(opts?: SubscriptionOptions) {
    try {
      this.logger.warn(this.id, "Subscribing to connection events - creating api client", opts);
      const client = await this.getContainerApiClient();
      const driver = client.getDriver();
      this.logger.warn(this.id, "Subscribing to connection events - issuing request");
      const response = await driver.get("/events", {
        timeout: 0,
        responseType: "stream",
      });
      return response.data as EventEmitter;
    } catch (error: any) {
      this.logger.error(
        this.id,
        "Subscribing to connection events failed",
        error.message,
        error.response
          ? {
              code: error.response.status,
              statusText: error.response.statusText,
            }
          : "",
      );
    }
  }

  // Controller behavior
  abstract runScopeCommand(
    program: string,
    args: string[],
    scope: string,
    settings?: EngineConnectorSettings,
  ): Promise<CommandExecutionResult>;

  async isControllerAvailable(settings: EngineConnectorSettings) {
    let success = false;
    let details: string | undefined;
    const controllerPath = settings.controller?.path;
    if (controllerPath) {
      if (await FS.isFilePresent(controllerPath)) {
        success = true;
        details = "Controller is available";
      } else {
        details = "Not present in path";
      }
    } else {
      details = "Path not set";
    }
    return { success, details };
  }

  async getAvailability(userSettings?: EngineConnectorSettings) {
    this.logger.debug(this.id, ">> Checking availability");
    const settings = userSettings || (await this.getSettings());
    systemNotifier.transmit("engine.availability", {
      trace: "Detecting host availability",
    });
    const check = await this.isEngineAvailable();
    const availability: EngineConnectorAvailability = {
      enabled: check.success,
      host: false,
      controller: false,
      controllerScope: false,
      program: false,
      api: false,
      report: {
        host: "Not checked",
        controller: "Not checked",
        controllerScope: "Not checked",
        program: "Not checked",
        api: "Not checked",
      },
    };
    availability.report.host = check.details || "";
    if (check.success) {
      availability.host = true;
    }
    if (availability.host) {
      systemNotifier.transmit("engine.availability", {
        trace: "Detecting host program availability",
      });
      const controllerAvailability = await this.isControllerAvailable(settings);
      availability.report.controller = controllerAvailability.details;
      if (controllerAvailability.success) {
        availability.controller = true;
      }
    } else {
      availability.report.controller = "Not checked - host not available";
    }
    if (availability.controller) {
      const controllerScope = await this.isControllerAvailable(settings);
      availability.report.controllerScope = controllerScope.details;
      if (controllerScope.success) {
        availability.controllerScope = true;
      }
    } else {
      availability.report.controllerScope = "Not checked - controller not available";
    }
    if (availability.controllerScope) {
      systemNotifier.transmit("engine.availability", {
        trace: "Detecting guest program availability",
      });
      const program = await this.isProgramAvailable(settings);
      availability.report.program = program.details || "";
      if (program.success) {
        availability.program = true;
      }
    } else {
      availability.report.program = "Not checked - controller scope not available";
    }
    systemNotifier.transmit("engine.availability", {
      trace: "Detecting guest api availability",
    });
    const api = await this.isApiRunning();
    availability.report.api = api.details ?? "";
    if (api.success) {
      availability.api = true;
      availability.report.api = "API is running";
    } else {
      availability.api = false;
      availability.report.api = "API is not running";
    }
    systemNotifier.transmit("engine.availability", {
      trace: "Availability check complete",
    });
    this.logger.debug(this.id, "<< Checking availability", availability);
    return availability;
  }

  async getScopeEnvironmentVariable(scope: string, variable: string) {
    let value = "";
    if (this.isScoped()) {
      const settings = await this.getSettings();
      if (settings.controller) {
        if (settings.controller?.scope) {
          this.logger.debug(this.id, "Get scoped environment variable", scope, variable);
          const output = await this.runScopeCommand("printenv", [variable], scope || settings.controller?.scope);
          if (output.success) {
            value = `${output.stdout || ""}`.trim();
            this.logger.debug(this.id, "Scoped environment variable has been read", output);
          } else {
            this.logger.error(this.id, "Scoped environment variable could not be read", output);
          }
        } else {
          this.logger.error(this.id, "Controller scope is not defined", settings.controller);
        }
      } else {
        this.logger.debug(this.id, "Get scoped environment variable", scope, variable);
        return await Platform.getEnvironmentVariable(variable);
      }
    }
    return value;
  }

  async findHostProgram(program: Program, settings?: EngineConnectorSettings): Promise<Program> {
    systemNotifier.transmit("engine.availability", {
      trace: `Detecting host ${program.name} program path and version`,
    });
    const output = deepMerge({}, program);
    output.path = await findProgramPath(program.name, { osType: this.osType });
    output.version = await findProgramVersion(output.path, {
      osType: this.osType,
    });
    return output;
  }

  async findHostProgramVersion(program: Program, settings?: EngineConnectorSettings): Promise<string> {
    return await findProgramVersion(program.path, { osType: this.osType });
  }

  async findScopeProgram(program: Program, settings?: EngineConnectorSettings): Promise<Program> {
    systemNotifier.transmit("engine.availability", {
      trace: `Detecting guest ${program.name} program path and version`,
    });
    const executor = async (path: string, args: string[]) => {
      const userSettings = settings || (await this.getSettings());
      return await this.runScopeCommand(path, args, userSettings.controller?.scope || "");
    };
    const output = deepMerge({}, program);
    output.path = await findProgramPath(program.name, { osType: OperatingSystem.Linux }, executor);
    output.version = await findProgramVersion(output.path, { osType: OperatingSystem.Linux }, executor);
    return output;
  }

  async findScopeProgramVersion(program: Program, settings?: EngineConnectorSettings): Promise<string> {
    const executor = async (path: string, args: string[]) => {
      const userSettings = settings || (await this.getSettings());
      return await this.runScopeCommand(path, args, userSettings.controller?.scope || "");
    };
    return await findProgramVersion(program.path, { osType: OperatingSystem.Linux }, executor);
  }

  async getConnectionDataDir() {
    systemNotifier.transmit("engine.availability", {
      trace: "Detecting connection system data dir",
    });
    let dataDir: string | undefined;
    this.logger.debug(this.id, "Get this data dir", this);
    if (this.settings.controller) {
      try {
        if (this.settings.controller.scope) {
          dataDir = await this.getScopeEnvironmentVariable(this.settings.controller.scope, "XDG_DATA_HOME");
          if (isEmpty(dataDir)) {
            this.logger.error(this.id, "Unable to get controller scope data dir using XDG_DATA_HOME");
            const homeDir = await this.getScopeEnvironmentVariable(this.settings.controller.scope, "HOME");
            if (isEmpty(homeDir)) {
              this.logger.error(this.id, "Unable to get controller scope data dir using HOME");
            } else {
              dataDir = `${homeDir}/.local/share`;
            }
          }
        } else {
          if (this.HOST === ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR) {
            dataDir = await Platform.getUserDataPath();
          } else {
            this.logger.error(this.id, "Controller scope is not defined", this.settings.controller);
            return dataDir || "";
          }
        }
      } catch (error: any) {
        this.logger.error(this.id, "Unable to get controller scope data dir", error.message);
      }
    } else {
      this.logger.error(this.id, "Controller scope is not defined", this);
    }
    const output = dataDir || "$HOME/.local/share";
    this.logger.debug(this.id, "Connection data dir is", output);
    return output;
  }
}
