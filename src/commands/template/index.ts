import type { Command } from "../../types/command.js";

const template = {
	type: "local",
	name: "template",
	description: "Manage workflow templates: list, save, load, export, import",
	aliases: ["tpl"],
	isEnabled: () => true,
	load: () => import("./template.js"),
} satisfies Command;

export default template;
