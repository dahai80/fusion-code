import type { Command } from "../../commands.js";

const rewind = {
	description: `Restore the code and/or conversation to a previous point. Use /rewind N to undo N turns, or /rewind to open interactive selector.`,
	name: "rewind",
	aliases: ["undo", "checkpoint"],
	argumentHint: "[N]",
	type: "local-jsx",
	load: () => import("./rewind.js"),
} satisfies Command;

export default rewind;
