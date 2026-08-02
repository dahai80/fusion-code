import type { Command } from "../../types/command.js";

const sessionPack = {
	type: "local",
	name: "session-pack",
	description: "Export/import full session assets: memory, templates, rules",
	aliases: ["sp"],
	isEnabled: () => true,
	load: () => import("./session-pack.js"),
} satisfies Command;

export default sessionPack;
