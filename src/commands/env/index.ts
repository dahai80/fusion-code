import type { Command, LocalCommandCall } from "../../types/command.js";
import { getMainLoopModel } from "../../utils/model/model.js";
import {
	getAPIProvider,
	isFusionMlxProvider,
} from "../../utils/model/providers.js";

const call: LocalCommandCall = async () => {
	const lines: string[] = ["=== Fusion-Code Environment ===", ""];

	const provider = getAPIProvider();
	lines.push(`Provider: ${provider}`);
	lines.push(`Model: ${getMainLoopModel() ?? "(default)"}`);
	lines.push(`MLX: ${isFusionMlxProvider() ? "active" : "inactive"}`);

	if (isFusionMlxProvider()) {
		lines.push(
			`MLX Base URL: ${process.env.FUSION_GATEWAY_URL || process.env.FUSION_MLX_BASE_URL || process.env.MLX_BASE_URL || "http://127.0.0.1:11432"}`,
		);
		lines.push(
			`MLX API Key: ${process.env.FUSION_MLX_API_KEY || process.env.MLX_API_KEY ? "***set***" : "(none)"}`,
		);
		lines.push(`MLX Model: ${process.env.FUSION_MLX_MODEL || "(auto-detect)"}`);
	}

	lines.push("");
	lines.push("=== Key Environment Variables ===");
	lines.push("");

	const envVars = [
		"FUSION_API_KEY",
		"ANTHROPIC_API_KEY",
		"FUSION_BASE_URL",
		"ANTHROPIC_BASE_URL",
		"FUSION_MODEL",
		"FUSION_CODE_USE_OPENAI",
		"FUSION_CODE_USE_FOUNDRY",
		"FUSION_GATEWAY_ENABLED",
		"FUSION_GATEWAY_URL",
		"FUSION_MLX_ENABLED",
		"FUSION_MLX_BASE_URL",
		"FUSION_MLX_MODEL",
		"FUSION_MLX_API_KEY",
		"NO_COLOR",
		"NODE_ENV",
	];

	for (const v of envVars) {
		const val = process.env[v];
		if (v.includes("KEY") || v.includes("TOKEN")) {
			lines.push(`  ${v}: ${val ? "***set***" : "(unset)"}`);
		} else {
			lines.push(`  ${v}: ${val ?? "(unset)"}`);
		}
	}

	return { type: "text", value: lines.join("\n") };
};

const env = {
	type: "local",
	name: "env",
	description:
		"Display current environment configuration: provider, model, and key environment variables",
	isEnabled: () => true,
	isHidden: false,
	supportsNonInteractive: true,
	load: () => Promise.resolve({ call }),
} satisfies Command;

export default env;
