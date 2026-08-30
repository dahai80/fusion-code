// #203 Phase B (audit 1.1.3): plugins public barrel. Consumers outside
// src/services/ must import from here, not deep files (enforced by
// bun run lint:layers:reverse). All 3 files public surface.
// pluginOperations.js owns VALID_INSTALLABLE_SCOPES/VALID_UPDATE_SCOPES;
// pluginCliCommands.js re-exports them — to avoid export * TS2308 collision,
// re-export only pluginCliCommands's OWN functions here (not the re-exported
// consts, which arrive via pluginOperations export *).
export * from "./pluginOperations.js";
export * from "./PluginInstallationManager.js";
export {
    installPlugin,
    uninstallPlugin,
    enablePlugin,
    disablePlugin,
    disableAllPlugins,
    updatePluginCli,
} from "./pluginCliCommands.js";
