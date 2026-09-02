import type { Command } from "../../commands.js";

// insight-0902 E3: /diff-compaction — 展示最近一次影子价压缩的候选评分表。
// fusion-code 独有: shadow-price selective truncation 的可审计性。
export default {
	type: "local",
	name: "diff-compaction",
	description: "Audit the last shadow-price compaction candidate table",
	supportsNonInteractive: true,
	load: () => import("./diffCompaction.js"),
} satisfies Command;
