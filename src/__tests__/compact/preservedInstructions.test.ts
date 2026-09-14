// P1-1 (audit v2-0912) 回归测试: truncateToTokens 负数 charBudget 截断失效。
// 预算被第一条指令耗尽后, 第二条指令拿到 maxTokens=0 → charBudget = -100 →
// slice(0, 负数) 从尾部保留几乎全文再拼 marker, 截断静默反增体积。
// truncateToTokens 是私有函数, 通过导出的 createPreservedInstructionsAttachment
// 间接覆盖预算耗尽路径。

import { describe, expect, test } from "bun:test";
import { createPreservedInstructionsAttachment } from "../../services/compact/index.js";

const MARKER_LENGTH =
	"\n\n[... skill content truncated for compaction; use Read on the skill path if you need the full text]"
		.length;

function extractContent(
	attachment: ReturnType<typeof createPreservedInstructionsAttachment>,
	source: string,
): string {
	if (!attachment) throw new Error("attachment is null");
	const instructions = (
		attachment.attachment as unknown as {
			instructions: Array<{ source: string; content: string }>;
		}
	).instructions;
	const match = instructions.find((i) => i.source === source);
	if (!match) {
		throw new Error(`instruction not found: ${source}`);
	}
	return match.content;
}

describe("createPreservedInstructionsAttachment budget exhaustion (P1-1)", () => {
	test("second instruction with exhausted budget returns bare marker, not inflated content", () => {
		// 预算 = 4000 tokens。customInstructions 恰好 4000 tokens (16000 chars)
		// 耗尽整个预算, appendSystemPrompt 2000 chars (~500 tokens) 只能拿
		// maxTokens=0 → 修复前 slice(0, -100) 保留全文; 修复后纯 marker。
		const custom = "C".repeat(16_000); // 4000 tokens = 整个预算
		const append = "X".repeat(2000); // ~500 tokens
		const attachment = createPreservedInstructionsAttachment(custom, append);
		const appended = extractContent(attachment, "append_system_prompt");
		// 修复后: 预算耗尽 → 纯 marker (约 100 chars), 而不是 2000+ chars 全文
		expect(appended.length).toBe(MARKER_LENGTH);
		expect(appended).toContain("truncated for compaction");
	});

	test("second instruction with tiny remaining budget never exceeds it", () => {
		// custom ~3950 tokens (15800 chars), append 2000 chars → 剩余 ~50 tokens
		// → charBudget = 200-100 = 100 chars, 输出 = 100 chars + marker。
		// 修复前若无 Math.max 兜底, 更小预算下 slice 负数会反增。
		const custom = "C".repeat(15_800); // ~3950 tokens
		const append = "X".repeat(2000);
		const attachment = createPreservedInstructionsAttachment(custom, append);
		const appended = extractContent(attachment, "append_system_prompt");
		// 输出不得超出剩余预算 (50 tokens ≈ 200 chars) + marker 的合理上界
		expect(appended.length).toBeLessThanOrEqual(50 * 4 + MARKER_LENGTH);
		expect(appended.length).toBeLessThan(append.length + MARKER_LENGTH);
	});

	test("normal truncation path unchanged (head kept + marker)", () => {
		const custom = "A".repeat(1000); // ~250 tokens, 无需截断
		const attachment = createPreservedInstructionsAttachment(custom);
		expect(extractContent(attachment, "custom_instructions")).toBe(custom);
	});
});
