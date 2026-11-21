import type { Command } from "../../commands.js";

// insight-0902 E3: /diff-compaction — displays the candidate score table of the last shadow-price compaction.
// fusion-code specific: auditability of shadow-price selective truncation.
export default {
	type: "local",
	name: "diff-compaction",
	description: "Audit the last shadow-price compaction candidate table",
	supportsNonInteractive: true,
	load: () => import("./diffCompaction.js"),
} satisfies Command;
