import { logForDebugging } from "../../utils/debug.js";

let offlineMode = false;
let savedFusionMlxEnabled: string | undefined;

export function isOfflineMode(): boolean {
	return offlineMode || process.env.FUSION_CODE_OFFLINE === "1";
}

export function setOfflineMode(enabled: boolean): void {
	offlineMode = enabled;
	process.env.FUSION_CODE_OFFLINE = enabled ? "1" : "";
	if (enabled) {
		savedFusionMlxEnabled = process.env.FUSION_MLX_ENABLED;
		process.env.FUSION_MLX_ENABLED = "1";
	} else {
		if (savedFusionMlxEnabled !== undefined) {
			process.env.FUSION_MLX_ENABLED = savedFusionMlxEnabled;
		} else {
			delete process.env.FUSION_MLX_ENABLED;
		}
	}
	logForDebugging(`offline: mode ${enabled ? "ON" : "OFF"}`);
}

export async function execute(_args: string): Promise<string> {
	const newState = !offlineMode;
	setOfflineMode(newState);
	if (newState) {
		return [
			"✈️ Offline mode ON",
			"",
			"• Provider forced to local MLX (port 11434)",
			"• WebSearch and WebFetch tools blocked",
			"• No network requests will be made",
			"",
			"Run /offline again to re-enable cloud mode.",
		].join("\n");
	}
	return [
		"☁️ Offline mode OFF",
		"",
		"• Cloud provider restored (FUSION_API_KEY / ANTHROPIC_API_KEY)",
		"• Network tools re-enabled",
	].join("\n");
}
