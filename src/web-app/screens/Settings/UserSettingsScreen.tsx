import {
  AnchorButton,
  Button,
  ButtonGroup,
  Callout,
  Checkbox,
  ControlGroup,
  Divider,
  FormGroup,
  HTMLSelect,
  HTMLTable,
  Icon,
  Intent,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiEmoticonSad, mdiEmoticonWink } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import { saveAs } from "file-saver";
import { isEmpty } from "lodash-es";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { type Connection, type Connector, type GlobalUserSettingsOptions, OperatingSystem } from "@/env/Types";
import { LOGGING_LEVELS, PROJECT_VERSION } from "@/web-app/Environment";
import { Notification } from "@/web-app/Notification";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { registry } from "@/web-app/domain/registry";
import { useStoreActions, useStoreState } from "@/web-app/domain/types";

import { getDefaultConnectors } from "@/container-client";
import { Application } from "@/container-client/Application";
import { ActionsMenu } from "./ActionsMenu";
import { ManageConnectionDrawer } from "./Connection";
import { ScreenHeader } from "./ScreenHeader";
import "./UserSettingsScreen.css";

// Screen
const isAutoDetectEnabled = false;

interface ScreenProps extends AppScreenProps {}

export const ID = "settings-settings";
export const View = "user-settings";
export const Title = "Settings";

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const [isChecking, setIsChecking] = useState(false);
  const [editedConnection, setEditedConnection] = useState<Connection | undefined>();
  const provisioned = useStoreState((state) => state.provisioned);
  const running = useStoreState((state) => state.running);
  const currentConnector = useStoreState((state) => state.currentConnector);
  const defaultConnector = useStoreState((state) => state.userSettings.connector?.default);
  const userSettings = useStoreState((state) => state.userSettings);
  const setGlobalUserSettings = useStoreActions((actions) => actions.setGlobalUserSettings);
  const pending = useStoreState((state) => state.pending);
  const [withManageDrawer, setWithManagerDrawer] = useState(false);
  const connections = useStoreState((state) => state.settings.connections);
  const osType = useStoreState((state) => state.osType);
  const refreshConnections = useStoreActions((actions) => actions.settings.getConnections);
  const connectors = useMemo(() => {
    return getDefaultConnectors(osType);
  }, [osType]);
  const runtimeEngineLabelsMap = useMemo(() => {
    return connectors.reduce((acc, it) => {
      acc[`${it.engine}:${it.host}`] = it.label;
      return acc;
    }, {});
  }, [connectors]);

  const onAddConnectionClick = useCallback(() => {
    setEditedConnection(undefined);
    setWithManagerDrawer(true);
  }, []);

  const onReloadConnectionsClick = useCallback(async () => {
    refreshConnections();
  }, [refreshConnections]);

  const onConnectionsExportClick = useCallback(async () => {
    const connections = await Application.getInstance().getConnections();
    const data = JSON.stringify(
      {
        version: import.meta.env.PROJECT_VERSION,
        connections: connections.map((it) => {
          delete (it as Connector).scopes;
          return it;
        }),
      },
      null,
      2,
    );
    saveAs(new Blob([data], { type: "application/json" }), "container-desktop-connections.json");
  }, []);
  const onConnectionsImportClick = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
          const data = e.target?.result;
          if (typeof data === "string") {
            try {
              const imported = JSON.parse(data);
              let connections: Connection[] = [];
              if (Array.isArray(imported)) {
                // old version
                connections = imported.map((it) => {
                  const host = it.engine;
                  const engine = it.runtime;
                  it.engine = engine;
                  it.host = host;
                  delete it.runtime;
                  return it;
                });
              } else {
                connections = imported.connections || [];
              }
              if (connections.length === 0) {
                Notification.show({
                  message: t("Unable to import connections - empty list"),
                  intent: Intent.DANGER,
                });
              } else {
                await setGlobalUserSettings({ connections });
                await refreshConnections();
                Notification.show({
                  message: t("Connections have been imported"),
                  intent: Intent.SUCCESS,
                });
              }
            } catch (error: any) {
              Notification.show({
                message: t("Unable to import connections - invalid format"),
                intent: Intent.DANGER,
              });
            }
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  }, [t, setGlobalUserSettings, refreshConnections]);

  const onEditConnection = useCallback((connection: Connection) => {
    setEditedConnection(connection);
    setWithManagerDrawer(true);
  }, []);

  const onConnectionManageDrawerClose = useCallback(() => {
    setEditedConnection(undefined);
    setWithManagerDrawer(false);
  }, []);

  const onMinimizeToSystemTray = useCallback(
    async (e) => {
      await setGlobalUserSettings({
        minimizeToSystemTray: !!e.currentTarget.checked,
      });
    },
    [setGlobalUserSettings],
  );
  const onCheckLatestVersion = useCallback(
    async (e) => {
      await setGlobalUserSettings({
        checkLatestVersion: !!e.currentTarget.checked,
      });
    },
    [setGlobalUserSettings],
  );
  const onLoggingLevelChange = useCallback(
    async (e) => {
      const configuration: Partial<GlobalUserSettingsOptions> = {};
      configuration.logging = {
        level: e.currentTarget.value,
      };
      await setGlobalUserSettings(configuration);
    },
    [setGlobalUserSettings],
  );
  const onToggleInspectorClick = useCallback(async (e) => {
    const instance = Application.getInstance();
    await instance.openDevTools();
  }, []);
  const onVersionCheck = useCallback(async () => {
    setIsChecking(true);
    try {
      const check = await registry.getOnlineApi().checkLatestVersion(osType);
      console.debug("Checking for new version", check);
      if (check.hasUpdate) {
        Notification.show({
          message: t("A newer version {{latest}} has been found", check),
          intent: Intent.PRIMARY,
        });
      } else {
        Notification.show({
          message: t("No new version detected"),
          intent: Intent.SUCCESS,
        });
      }
    } catch (error: any) {
      Notification.show({
        message: t("Unable to check latest version"),
        intent: Intent.DANGER,
      });
    }
    setIsChecking(false);
  }, [t, osType]);

  let title = "";
  let errorMessage = "";
  let icon: any = undefined;

  if (connections.length === 0) {
    title = t("No connections defined");
    errorMessage = t("To be able to continue, at least one connection needs to be defined.");
    icon = mdiEmoticonSad;
  } else {
    title = t("No default connection");
    errorMessage = t("To be able to start automatically, a default connection needs to be set.");
    icon = mdiEmoticonWink;
    if (!currentConnector) {
      title = t("No active connection");
      errorMessage = t("To be able to continue, a connection needs to be established.");
    }
  }

  const contentWidget =
    provisioned && running ? null : (
      <Callout
        className="AppSettingsCallout"
        title={title}
        icon={icon ? <ReactIcon.Icon path={icon} size={3} /> : undefined}
      >
        <p>{errorMessage}</p>
      </Callout>
    );

  useEffect(() => {
    (async () => {
      await refreshConnections();
    })();
  }, [refreshConnections]);

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader currentScreen={ID}>
        <div className="AppScreenHeaderText">{PROJECT_VERSION}</div>
      </ScreenHeader>
      <div className="AppScreenContent">
        {contentWidget}
        <div className="AppSettingsEngineManager">
          <div className="AppSettingsEngineManagerConnections">
            <HTMLTable compact striped interactive className="AppDataTable" data-table="host.connections">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t("Connection")}</th>
                  <th>{t("Engine")}</th>
                  <th>{t("Platform")}</th>
                  <th>{t("Autostart")}</th>
                  <th>{t("Rootful")}</th>
                  <th>{t("Default")}</th>
                  <th>&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {connections.map((connection, index) => {
                  const scopeLabel =
                    runtimeEngineLabelsMap[`${connection.engine}:${connection.host}`] || connection.host;
                  const isCurrent = currentConnector?.connectionId === connection?.id;
                  const isConnected = isCurrent && currentConnector.availability.api;
                  const isAutomatic = connection.settings.mode === "mode.automatic";
                  const descriptions = [connection.settings?.api?.connection?.uri || "", connection.description || ""];
                  const description = descriptions.filter((it) => !isEmpty(it)).join(". ");
                  return (
                    <tr
                      key={connection.id}
                      data-connection-id={connection.id}
                      data-connection-engine={connection.engine}
                      data-connection-host={connection.host}
                      data-connection-is-rootfull={connection.settings?.rootfull ? "yes" : "no"}
                      data-connection-is-default={defaultConnector === connection.id ? "yes" : "no"}
                      data-connection-is-current={isCurrent ? "yes" : "no"}
                      data-connection-is-connected={isConnected ? "yes" : "no"}
                      data-connection-is-system={connection.readonly ? "yes" : "no"}
                    >
                      <td>{index + 1}.</td>
                      <td>
                        <p className="PlatformConnectionName">{connection.name}</p>
                        {description ? <p className="PlatformConnectionDescription">{description}</p> : null}
                      </td>
                      <td>{connection.engine}</td>
                      <td>
                        <p className="PlatformScopeName">
                          {isAutomatic ? t("Auto") : connection.settings?.controller?.scope || ""}
                        </p>
                        <p className="PlatformScopeLabel">{scopeLabel}</p>
                      </td>
                      <td>{connection.settings.api.autoStart ? t("Yes") : t("No")}</td>
                      <td>{isAutomatic ? t("Detect") : connection.settings.rootfull ? t("Yes") : t("No")}</td>
                      <td data-flag="default">
                        {defaultConnector === connection.id ? <strong>{t("Yes")}</strong> : t("No")}
                      </td>
                      <td>
                        <ActionsMenu onEdit={onEditConnection} connection={connection} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </HTMLTable>
            {withManageDrawer ? (
              <ManageConnectionDrawer
                mode={editedConnection ? "edit" : "create"}
                connection={editedConnection}
                onClose={onConnectionManageDrawerClose}
              />
            ) : null}
          </div>
          <div className="AppSettingsEngineManagerConnectionsController">
            <ButtonGroup>
              <Button
                text={t("Create connection")}
                title={t("Define a new container host connection")}
                icon={IconNames.PLUS}
                intent={Intent.PRIMARY}
                onClick={onAddConnectionClick}
              />
              <Button
                title={t("Reload connections")}
                icon={IconNames.REFRESH}
                intent={Intent.NONE}
                disabled={pending}
                loading={pending}
                onClick={onReloadConnectionsClick}
              />
              {isAutoDetectEnabled ? (
                <>
                  <Divider />
                  <Button text={t("Auto detect")} icon={IconNames.SEARCH} intent={Intent.NONE} />
                </>
              ) : null}
            </ButtonGroup>

            <ButtonGroup minimal className="ConnectionsExportImport">
              <Button
                disabled={connections.length === 0}
                text={t("Export")}
                title={
                  connections.length === 0
                    ? t("No connections defined - nothing to export")
                    : t("Exports the current list of connections")
                }
                icon={IconNames.EXPORT}
                intent={Intent.NONE}
                onClick={onConnectionsExportClick}
              />
              <Button
                text={t("Import")}
                title={t("Imports and replaces the current list of connections")}
                icon={IconNames.IMPORT}
                intent={Intent.NONE}
                onClick={onConnectionsImportClick}
              />
            </ButtonGroup>
          </div>
        </div>

        <div className="AppSettingsForm" data-form="flags">
          <FormGroup className="AppSettingsFeaturesToggles">
            <ControlGroup>
              <Checkbox
                id="minimizeToSystemTray"
                label={t("Minimize to System Tray when closing")}
                checked={!!userSettings.minimizeToSystemTray}
                onChange={onMinimizeToSystemTray}
              />
            </ControlGroup>
            <ControlGroup>
              <Checkbox
                id="checkLatestVersion"
                label={t("Automatically check for new version at startup")}
                checked={!!userSettings.checkLatestVersion}
                onChange={onCheckLatestVersion}
              />
            </ControlGroup>
          </FormGroup>
          {import.meta.env.TARGET === OperatingSystem.Windows ? (
            <FormGroup
              label={t("Check for new versions")}
              data-target={import.meta.env.TARGET}
              className="AppSettingsFormVersionCheck"
              labelFor="checkLatestVersion"
            >
              <ButtonGroup className="AppSettingsFormVersionCheckActions">
                <Button
                  fill
                  loading={isChecking}
                  disabled={isChecking}
                  intent={Intent.PRIMARY}
                  small
                  text={t("Check now")}
                  icon={IconNames.UPDATED}
                  onClick={onVersionCheck}
                />
                <AnchorButton
                  id="checkLatestVersion"
                  className="AppSettingsFormVersionCheckStore"
                  title={t("Check latest version")}
                  href="https://apps.microsoft.com/detail/9mtg4qx6d3ks?mode=direct"
                  target="_blank"
                />
              </ButtonGroup>
            </FormGroup>
          ) : (
            <FormGroup
              label={t("Check for new versions")}
              data-target={import.meta.env.TARGET}
              className="AppSettingsFormVersionCheck"
              labelFor="checkLatestVersion"
            >
              <ButtonGroup fill className="AppSettingsFormVersionCheckActions">
                <Button
                  loading={isChecking}
                  disabled={isChecking}
                  intent={Intent.PRIMARY}
                  small
                  text={t("Check now")}
                  icon={IconNames.UPDATED}
                  onClick={onVersionCheck}
                />
                <AnchorButton
                  icon={IconNames.DOWNLOAD}
                  text={t("Versions")}
                  href="https://github.com/iongion/container-desktop/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                />
              </ButtonGroup>
            </FormGroup>
          )}
        </div>
        <div className="AppSettingsForm" data-form="logging">
          <FormGroup label={t("Configuration and logging")} labelFor="userSettingsPath">
            <div className="AppSettingUserConfigurationPath">
              <Icon icon={IconNames.INFO_SIGN} />
              <strong>{t("Storage path")}</strong>
              <input id="userSettingsPath" name="userSettingsPath" type="text" value={userSettings.path} readOnly />
            </div>
          </FormGroup>
          <div className="AppSettingsFormLoggingLevel">
            <FormGroup label={t("Level")} labelFor="loggingLevel">
              <ControlGroup>
                <HTMLSelect
                  id="loggingLevel"
                  value={userSettings.logging.level || "error"}
                  onChange={onLoggingLevelChange}
                >
                  {LOGGING_LEVELS.map((level) => {
                    const key = `logging.${level}`;
                    return (
                      <option key={key} value={level}>
                        {level}
                      </option>
                    );
                  })}
                </HTMLSelect>
              </ControlGroup>
            </FormGroup>
            <FormGroup label={t("Debugging")} labelFor="loggingLevel">
              <ControlGroup>
                <Button icon={IconNames.PANEL_TABLE} text={t("Toggle inspector")} onClick={onToggleInspectorClick} />
              </ControlGroup>
            </FormGroup>
          </div>
        </div>
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: `/screens/settings/${View}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.COG,
  ExcludeFromSidebar: true,
};
