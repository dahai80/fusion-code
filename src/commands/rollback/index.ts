import type { Command } from "../../commands.js";

const rollback = {
	description:
		"Revert the working tree to before the current/previous turn via fusion-executor git snapshot. Requires FUSION_CODE_EXECUTOR_ENABLED=1 + FUSION_CODE_EXECUTOR_TURN_SNAPSHOT=1. Use /rollback to revert the most recent turn, or /rollback <turnId> for a specific turn.",
	name: "rollback",
	aliases: ["rb"],
	argumentHint: "[turnId]",
	type: "local-jsx",
	load: () => import("./rollback.js"),
} satisfies Command;

export default rollback;
