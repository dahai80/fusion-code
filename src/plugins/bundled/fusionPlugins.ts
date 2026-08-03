import { logForDebugging } from "../../utils/debug.js";
import { registerBuiltinPlugin } from "../builtinPlugins.js";

const FUSION_PLUGIN_SERVER_CMD = "fusion-plugin-server";

function isFusionPluginServerAvailable(): boolean {
	try {
		const result = Bun.spawnSync(["which", FUSION_PLUGIN_SERVER_CMD], {
			stdout: "pipe",
			stderr: "pipe",
		});
		return result.exitCode === 0;
	} catch {
		return false;
	}
}

export function registerFusionPluginsPlugin(): void {
	const serverAvailable = isFusionPluginServerAvailable();

	if (!serverAvailable) {
		logForDebugging(
			"[Plugin:fusion-plugins] fusion-plugin-server not found in PATH, plugin disabled",
		);
	}

	registerBuiltinPlugin({
		name: "fusion-plugins",
		description:
			"Fusion Plugins Ecosystem — access all registered plugins as MCP tools via fusion-plugin-server. " +
			"Provides tools/list and tools/call for local-first plugin integration.",
		version: "1.0.0",
		mcpServers: serverAvailable
			? {
					"fusion-plugins": {
						type: "stdio",
						command: FUSION_PLUGIN_SERVER_CMD,
						args: ["--transport", "stdio"],
					},
				}
			: undefined,
		isAvailable: () => true,
		defaultEnabled: serverAvailable,
	});

	if (serverAvailable) {
		logForDebugging(
			"[Plugin:fusion-plugins] Registered with stdio transport (fusion-plugin-server found in PATH)",
		);
	}
}
