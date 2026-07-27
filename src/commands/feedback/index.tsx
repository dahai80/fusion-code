import type { Command } from "../../types/command.js";
import { isEnvTruthy } from "../../utils/envUtils.js";

const feedback: Command = {
	aliases: ["bug"],
	type: "local-jsx",
	name: "feedback",
	description: "Submit feedback about Fusion-Code",
	argumentHint: "[report]",
	isEnabled: () =>
		!(
			isEnvTruthy(process.env.FUSION_CODE_USE_BEDROCK) ||
			isEnvTruthy(process.env.FUSION_CODE_USE_VERTEX) ||
			isEnvTruthy(process.env.FUSION_CODE_USE_FOUNDRY) ||
			isEnvTruthy(process.env.DISABLE_FEEDBACK_COMMAND) ||
			isEnvTruthy(process.env.DISABLE_BUG_COMMAND) ||
			process.env.USER_TYPE === "ant"
		),
	load: () => import("./feedback.js"), // log: moved call to module via load()
};

export default feedback;
