import type { Command } from "../../commands.js";

const audit = {
	type: "local",
	name: "audit",
	description:
		"View AI operation audit log (file changes, commands, denied tools)",
	aliases: ["audit-log"],
	argumentHint: "[--last N] [--tool NAME] [--op read|write|execute|denied]",
	supportsNonInteractive: true,
	load: () => import("./audit.js"),
} satisfies Command;
export default audit;
