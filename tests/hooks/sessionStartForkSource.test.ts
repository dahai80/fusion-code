/**
 * SessionStart source "fork" (issue #79, CC 2.1.214, P2.2)
 *
 * --fork-session / /fork 会话应在 SessionStart hook 报告 source "fork",
 * 而非 "resume", 让用户 hook 能区分 fork 与普通 resume。验证 4 处类型/schema/
 * 可选值对齐 + zod 运行时接受 "fork"。
 */
import { describe, expect, it } from "bun:test";
import { SessionStartHookInputSchema } from "../../src/entrypoints/sdk/coreSchemas.js";
import { getMatcherMetadata } from "../../src/utils/hooks/hooksConfigManager.js";

describe('SessionStart source "fork" (issue #79)', () => {
	// BaseHookInputSchema 必填 session_id/transcript_path/cwd
	const baseInput = {
		hook_event_name: "SessionStart" as const,
		session_id: "test-session",
		transcript_path: "/tmp/transcript.jsonl",
		cwd: "/tmp",
	};

	it('zod schema 接受 source "fork"', () => {
		const parsed = SessionStartHookInputSchema().safeParse({
			...baseInput,
			source: "fork",
		});
		expect(parsed.success).toBe(true);
	});

	it("zod schema 仍接受既有 source (startup/resume/clear/compact)", () => {
		for (const src of ["startup", "resume", "clear", "compact"]) {
			const parsed = SessionStartHookInputSchema().safeParse({
				...baseInput,
				source: src,
			});
			expect(parsed.success).toBe(true);
		}
	});

	it("zod schema 拒绝未知 source", () => {
		const parsed = SessionStartHookInputSchema().safeParse({
			...baseInput,
			source: "unknown-source",
		});
		expect(parsed.success).toBe(false);
	});

	it('hook 配置可选值列表含 "fork" (fieldToMatch=source)', () => {
		const meta = getMatcherMetadata("SessionStart", []);
		expect(meta?.fieldToMatch).toBe("source");
		const values = meta?.values ?? [];
		expect(values).toContain("fork");
		// 既有值不丢
		for (const src of ["startup", "resume", "clear", "compact"]) {
			expect(values).toContain(src);
		}
	});
});
