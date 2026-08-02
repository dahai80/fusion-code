import type { Command } from "../../types/command.js";

const kb = {
	type: "local",
	name: "kb",
	description:
		"Local knowledge base: build, query, and manage project vector index",
	aliases: ["knowledge"],
	isEnabled: () => true,
	load: () => import("./kb.js"),
} satisfies Command;

export default kb;
