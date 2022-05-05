import { useCallback, useState, useMemo, useEffect } from "react";
import { Button, ControlGroup, InputGroup, Intent, RadioGroup, Radio, FormGroup, Label, HTMLSelect, ButtonGroup, Tab, Tabs } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import { useForm, useFormContext, FormProvider, Controller } from "react-hook-form";

// project
import { Connector, ContainerAdapter, ContainerEngine, TestResult, Program } from "../../Types";
import { Native, Platforms } from "../../Native";
import { useStoreActions, useStoreState } from "../../domain/types";
import { RadioLabel } from "../../components/RadioLabel";
import { RestrictedTo } from "../../components/RestrictedTo";
import { Notification } from "../../Notification";

import "./EngineManager.css";

interface ContainerEngineSettingsProps {
  connector: Connector;
  disabled?: boolean;
}

export interface ConnectorFormData {
  action: string;
  scope: string; // WSL distribution or LIMA instance
  programPath: string;
  connectionString: string;
}

export const ContainerEngineSettingsProgramLocal: React.FC<ContainerEngineSettingsProps> = ({ connector, disabled }) => {
  const { t } = useTranslation();
  const { engine } = connector;
  const currentConnector = connector;
  const { current } = currentConnector.settings;
  const { api, program } = current;

  const wslDistributions: any[] = [];

  const setUserPreferences = useStoreActions((actions) => actions.setUserPreferences);
  const testProgramReachability = useStoreActions((actions) => actions.testProgramReachability);
  const testApiReachability = useStoreActions((actions) => actions.testApiReachability);
  const findProgram = useStoreActions((actions) => actions.findProgram);

  const [selectedWSLDistribution, setSelectedWSLDistribution] = useState<string>(wslDistributions.find(it => it.Current)?.Name || "");

  // Form setup

  const { reset, control, getValues } = useFormContext<ConnectorFormData>();

  useEffect(() => {
    reset({
      programPath: program.path,
      connectionString: api.connectionString
    })
  }, [api, program, reset]);

  const onProgramSelectClick = useCallback(
    async (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
      const result = await Native.getInstance().openFileSelector();
      if (result) {
        const filePath = result?.filePaths[0];
        if (!result.canceled && filePath) {
          try {
            const program = filePath.split(/\\|\//).pop()?.replace(".exe", "") || "";
            const programSettings: any = {};
            const programKey = `${engine}.program.${program}.path`;
            programSettings[programKey] = filePath;
            await setUserPreferences(programSettings);
          } catch (error) {
            console.error("Unable to change CLI path", error);
            Notification.show({ message: t("Unable to change CLI path"), intent: Intent.DANGER });
          }
        }
      } else {
        console.error("Unable to open file dialog");
      }
    },
    [engine, setUserPreferences, t]
  );
  const onWSLDistributionChange = useCallback(
    (event: React.FormEvent<HTMLSelectElement>) => {
      const sender = event.currentTarget;
      setSelectedWSLDistribution(sender.value);
    },
    [setSelectedWSLDistribution]
  );

  const onFindWSLProgramClick = useCallback(async (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
    const result: Program = await findProgram({
      engine,
      wslDistributionName: selectedWSLDistribution,
      program: program.name,
    });
    if (result.path) {
      Notification.show({
        message: t(
          "Found {{program}} CLI in {{distribution}} WLS distribution",
          { program: program.name, path: program.path, distribution: selectedWSLDistribution }
        ),
        intent: Intent.SUCCESS
      });
    } else {
      Notification.show({
        message: t(
          "Unable to find {{program}} CLI in {{distribution}} WSL distribution",
          { program: program.name, distribution: selectedWSLDistribution }
        ),
        intent: Intent.DANGER
      });
    }
    // setProgram(result);
  }, [engine, program, selectedWSLDistribution, findProgram, t]);

  const onProgramPathTestClick = useCallback(async (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
    const values = getValues();
    const result: TestResult = await testProgramReachability({
      ...program,
      path: values.programPath
    });
    if (result.success) {
      Notification.show({ message: t("Program was reached successfully"), intent: Intent.SUCCESS });
    } else {
      Notification.show({ message: t("Program could not be reached"), intent: Intent.DANGER });
    }
  }, [program, testProgramReachability, getValues, t]);

  const onConnectionStringTestClick = useCallback(async (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
    const values = getValues();
    const result: TestResult = await testApiReachability({ ...api, connectionString: values.connectionString });
    if (result.success) {
      Notification.show({ message: t("API was reached successfully"), intent: Intent.SUCCESS });
    } else {
      Notification.show({ message: t("API could not be reached"), intent: Intent.DANGER });
    }
  }, [api, testApiReachability, getValues, t]);

  // locals
  const isLIMA = engine === ContainerEngine.PODMAN_SUBSYSTEM_LIMA;
  const suffix = isLIMA ? <span> - {t("Automatically detected inside LIMA VM")}</span> : "";
  const isWSL = engine === ContainerEngine.PODMAN_SUBSYSTEM_WSL;
  let wslSelector;
  if (isWSL) {
    wslSelector = (
      <div className="WSLSelector">
        <HTMLSelect
          id="wsl_distribution"
          name="wsl_distribution"
          title={t("WSL distribution")}
          value={selectedWSLDistribution}
          onChange={onWSLDistributionChange}
        >
          <option value="">{t("-- select --")}</option>
          {wslDistributions.map((it) => {
            return (
              <option key={it.Name} value={it.Name}>{it.Name}</option>
            );
          })}
        </HTMLSelect>
        <Button
          disabled={!selectedWSLDistribution}
          icon={IconNames.TARGET}
          text={t("Find")}
          intent={Intent.PRIMARY}
          title={t("Click to trigger automatic detection")}
          onClick={onFindWSLProgramClick}
        />
      </div>
    );
  }

  // console.debug("Rendering");

  return (
      <div className="ContainerEngineSettings" data-settings="program.local">
        <FormGroup
          helperText={
            <div className="AppSettingsFieldProgramHelper">
              {program?.version ? (
                <>
                  <span>{t("Detected version {{version}}", program)}</span>
                  {suffix}
                </>
              ) : (
                t("Could not detect current version")
              )}
            </div>
          }
          label={t("Path to {{name}} CLI", program)}
          labelFor="programPath"
        >
          <ControlGroup fill={true} vertical={false}>
            <Controller
              control={control}
              name="programPath"
              defaultValue=""
              rules={{ required: t("Program path must be set") }}
              render={({ field: { onChange, onBlur, value, name, ref, }, fieldState: { error } }) => {
                return (
                  <InputGroup
                    fill
                    id={name}
                    name={name}
                    inputRef={ref}
                    value={value}
                    onChange={onChange}
                    onBlur={onBlur}
                    placeholder={current.program.path}
                    data-invalid={error ? true : false}
                    intent={error ? Intent.DANGER : undefined}
                    title={error ? error.message : ""}
                    rightElement={
                      <Button disabled={!!error} minimal intent={Intent.PRIMARY} text={t("Test")} onClick={onProgramPathTestClick} />
                    }
                  />
                );
              }}
            />
            {isLIMA || isWSL ? null : <Button
              icon={IconNames.LOCATE}
              text={t("Select")}
              title={t("Select program")}
              intent={Intent.PRIMARY}
              onClick={onProgramSelectClick}
            />
            }
            {wslSelector}
          </ControlGroup>
        </FormGroup>
        <FormGroup
          label={t("Connection string")}
          labelFor="connectionString"
        >
          <ControlGroup fill={true} vertical={false}>
            <Controller
              control={control}
              name="connectionString"
              defaultValue=""
              rules={{ required: t("Connection string must be set") }}
              render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { error, invalid } }) => {
                return (
                  <InputGroup
                    fill
                    id={name}
                    name={name}
                    inputRef={ref}
                    value={value}
                    onChange={onChange}
                    onBlur={onBlur}
                    placeholder={current.api.connectionString}
                    data-invalid={error ? true : false}
                    intent={error ? Intent.DANGER : undefined}
                    title={error ? error.message : ""}
                    rightElement={
                      <Button disabled={!!error} minimal intent={Intent.PRIMARY} text={t("Test")} onClick={onConnectionStringTestClick} />
                    }
                  />
                );
              }}
            />
          </ControlGroup>
        </FormGroup>
      </div>
  );
}

export const ContainerEngineSettingsPodmanRemote: React.FC<ContainerEngineSettingsProps> = () => {
  return null;
}

export type ContainerEngineSettingsRegistryStore = { [key in ContainerEngine]: React.FC<ContainerEngineSettingsProps> };
export const ContainerEngineSettingsRegistry: ContainerEngineSettingsRegistryStore = {
  [ContainerEngine.PODMAN_NATIVE]: ContainerEngineSettingsProgramLocal,
  [ContainerEngine.PODMAN_VIRTUALIZED]: ContainerEngineSettingsProgramLocal,
  [ContainerEngine.PODMAN_REMOTE]: ContainerEngineSettingsPodmanRemote,
  [ContainerEngine.PODMAN_SUBSYSTEM_LIMA]: ContainerEngineSettingsProgramLocal,
  [ContainerEngine.PODMAN_SUBSYSTEM_WSL]: ContainerEngineSettingsProgramLocal,
  [ContainerEngine.DOCKER_NATIVE]: ContainerEngineSettingsProgramLocal,
  [ContainerEngine.DOCKER_VIRTUALIZED]: ContainerEngineSettingsProgramLocal,
  [ContainerEngine.DOCKER_REMOTE]: ContainerEngineSettingsPodmanRemote,
  [ContainerEngine.DOCKER_SUBSYSTEM_LIMA]: ContainerEngineSettingsProgramLocal,
  [ContainerEngine.DOCKER_SUBSYSTEM_WSL]: ContainerEngineSettingsProgramLocal,
}

export interface ContainerEngineItem {
  adapter: ContainerAdapter;
  engine: ContainerEngine;
  label: string;
  active: boolean;
  enabled: boolean;
}

export interface ContainerEngineManagerSettingsProps {
  adapter: ContainerAdapter;
  disabled?: boolean;
  connectors: Connector[];
  currentConnector: Connector;
  engines: ContainerEngineItem[];
}
export const ContainerEngineManagerSettings: React.FC<ContainerEngineManagerSettingsProps> = ({ adapter, disabled, connectors, currentConnector, engines }) => {
  const { t } = useTranslation();
  const start = useStoreActions((actions) => actions.start);

  const [selectedConnectorId, setSelectedConnectorId] = useState(currentConnector.id);
  let connector = connectors.find(it => it.id === selectedConnectorId);
  // if no controller found - pick first usable
  if (!connector) {
    connector = connectors.find(({ availability }) => {
      let usable = availability.api;
      if (typeof availability.controller !== "undefined") {
        usable = availability.controller;
      }
      return usable;
    });
  }
  let settingsWidget: any = null;
  if (connector && ContainerEngineSettingsRegistry[connector.engine]) {
    const Settings = ContainerEngineSettingsRegistry[connector.engine];
    settingsWidget = <Settings connector={connector} />;
  }
  const onContainerEngineChange = useCallback((e) => {
    setSelectedConnectorId(e.currentTarget.value);
  }, []);

  const { current } = currentConnector.settings;

  const methods = useForm<ConnectorFormData>({
    mode: "all",
    reValidateMode: 'onChange',
    shouldUseNativeValidation: false,
    defaultValues: {
      programPath: current.program.path,
      connectionString: current.api.connectionString
    },
    criteriaMode: 'firstError'
  });

  const { formState, handleSubmit } = methods;

  const onSaveClick = handleSubmit(data => {
    data.action = 'save';
    console.debug(data.action, data, connector);
    return data;
  });

  const onConnectClick = handleSubmit(async (data) => {
    if (connector) {
      await start({ startApi: true, adapter, connector: connector.id });
    }
    return false;
  });

  const canAct = formState.isValid;
  const canSave = canAct && formState.isDirty;

  return (
    <FormProvider {...methods}>
      <form>
        <div className="AppSettingsFormView" data-form-view="container-engine" data-adapter={adapter}>
          <div className="AppSettingsFormViewBody">
            <div className="AppSettingsForm" data-form="engine">
              <FormGroup>
                <RadioGroup
                  disabled={disabled}
                  className="AppSettingsFormContent"
                  data-form="engine"
                  onChange={onContainerEngineChange}
                  selectedValue={connector?.id}
                >
                  {engines.map((containerEngine) => {
                    const engineConnector = connectors.find(it => it.engine === containerEngine.engine);
                    const label = containerEngine ? containerEngine.label : "Unsupported";
                    const disabled = containerEngine ? !containerEngine.enabled : true;
                    const restrict = <RestrictedTo engine={containerEngine.engine} />;
                    return (
                      <Radio
                        key={containerEngine.engine}
                        data-adapter={containerEngine.adapter}
                        data-engine={containerEngine.engine}
                        className={`AppSettingsField ${connector?.id === engineConnector?.id ? "AppSettingsFieldActive" : ""}`}
                        disabled={disabled}
                        labelElement={<RadioLabel text={label} highlight={currentConnector.id === engineConnector?.id} />}
                        value={engineConnector?.id}
                      >
                        {restrict}
                      </Radio>
                    );
                  })}
                </RadioGroup>
              </FormGroup>
            </div>
            <div className="AppSettingsForm" data-form="engine.settings">
              {settingsWidget}
            </div>
          </div>
          <div className="AppSettingsFormViewFooter">
          <ButtonGroup className="ContainerEngineSettingsActions">
            <Button disabled={!canAct} type="button" value="connect" intent={Intent.SUCCESS} text={t("Connect")} icon={IconNames.DATA_CONNECTION} onClick={onConnectClick} />
            <Button disabled={!canSave} type="button" value="save" intent={Intent.PRIMARY} text={t("Save")} icon={IconNames.FLOPPY_DISK} onClick={onSaveClick} />
          </ButtonGroup>
          </div>
        </div>
      </form>
    </FormProvider>
  );
}

export interface ContainerEngineManagerProps {
  helperText?: string;
  disabled?: boolean;
}

export const ContainerEngineManager: React.FC<ContainerEngineManagerProps> = ({ disabled, helperText }) => {
  const { t } = useTranslation();
  const platform = useStoreState((state) => state.descriptor.platform);
  const currentConnector = useStoreState((state) => state.descriptor.currentConnector);
  const PodmanContainerEngines = useMemo(
    () => {
      const engines = [
        // Podman
        {
          adapter: ContainerAdapter.PODMAN,
          engine: ContainerEngine.PODMAN_NATIVE,
          label: t("Native"),
          active: false,
          enabled: platform === Platforms.Linux
        },
        {
          adapter: ContainerAdapter.PODMAN,
          engine: ContainerEngine.PODMAN_VIRTUALIZED,
          label: t("Machine"),
          active: false,
          enabled: true
        },
        {
          adapter: ContainerAdapter.PODMAN,
          engine: ContainerEngine.PODMAN_REMOTE,
          label: t("Remote"),
          active: false,
          enabled: false
        },
        {
          adapter: ContainerAdapter.PODMAN,
          engine: ContainerEngine.PODMAN_SUBSYSTEM_LIMA,
          label: t("Custom LIMA"),
          active: false,
          enabled: platform === Platforms.Mac
        },
        {
          adapter: ContainerAdapter.PODMAN,
          engine: ContainerEngine.PODMAN_SUBSYSTEM_WSL,
          label: t("Custom WSL"),
          active: false,
          enabled: platform === Platforms.Windows
        },
      ];
      return engines;
    },
    [t, platform]
  );
  const DockerContainerEngines = useMemo(
    () => {
      const engines = [
        // Docker
        {
          adapter: ContainerAdapter.DOCKER,
          engine: ContainerEngine.DOCKER_NATIVE,
          label: t("Native"),
          active: false,
          enabled: platform === Platforms.Linux
        },
        {
          adapter: ContainerAdapter.DOCKER,
          engine: ContainerEngine.DOCKER_VIRTUALIZED,
          label: t("Machine"),
          active: false,
          enabled: platform === Platforms.Windows || platform === Platforms.Mac
        },
        {
          adapter: ContainerAdapter.DOCKER,
          engine: ContainerEngine.DOCKER_REMOTE,
          label: t("Remote"),
          active: false,
          enabled: false
        },
        {
          adapter: ContainerAdapter.DOCKER,
          engine: ContainerEngine.DOCKER_SUBSYSTEM_LIMA,
          label: t("Custom LIMA"),
          active: false,
          enabled: platform === Platforms.Mac
        },
        {
          adapter: ContainerAdapter.DOCKER,
          engine: ContainerEngine.DOCKER_SUBSYSTEM_WSL,
          label: t("Custom WSL"),
          active: false,
          enabled: platform === Platforms.Windows
        },
      ];
      return engines;
    },
    [t, platform]
  );

  const adapter = useStoreState((state) => state.descriptor.currentConnector.adapter);
  const [containerAdapter, setContainerAdapter] = useState(adapter || ContainerAdapter.PODMAN);
  const onContainerAdapterChange = useCallback((e) => {
    setContainerAdapter(e);
  }, []);

  const connectors = useStoreState((state) => state.descriptor.connectors);
  const podmanConnectors = useMemo(() => connectors.filter(it => it.engine.startsWith(containerAdapter)), [connectors, containerAdapter]);
  const dockerConnectors = useMemo(() => connectors.filter(it => it.engine.startsWith(containerAdapter)), [connectors, containerAdapter]);

  useEffect(() => {
    setContainerAdapter(adapter);
  }, [adapter]);

  return (
    <div className="AppSettingsEngineManager">
      <Tabs selectedTabId={containerAdapter} onChange={onContainerAdapterChange} renderActiveTabPanelOnly>
        <Tab id={ContainerAdapter.PODMAN} title={t("Podman")} panelClassName="podman-panel" panel={<ContainerEngineManagerSettings adapter={ContainerAdapter.PODMAN} currentConnector={currentConnector} engines={PodmanContainerEngines} connectors={podmanConnectors} />} />
        <Tab id={ContainerAdapter.DOCKER} title={t("Docker")} panelClassName="docker-panel" panel={<ContainerEngineManagerSettings adapter={ContainerAdapter.DOCKER} currentConnector={currentConnector} engines={DockerContainerEngines} connectors={dockerConnectors} />} />
        <Tabs.Expander />
        <Label>{helperText}</Label>
      </Tabs>
    </div>
  );
};
