/**
 * item 12: 子代理自动后台化阈值解析单测 (CC 2.1.198/232)
 */
import { describe, expect, it } from "bun:test";
import { getSubagentAutoBackgroundMs } from "../tools/AgentTool/autoBackground.js";

describe("getSubagentAutoBackgroundMs", () => {
	const orig = process.env.FUSION_SUBAGENT_AUTO_BACKGROUND_MS;

	it("未设 → 0 (default off, byte-identical 旧行为)", () => {
		delete process.env.FUSION_SUBAGENT_AUTO_BACKGROUND_MS;
		expect(getSubagentAutoBackgroundMs()).toBe(0);
	});

	it("空串 → 0", () => {
		process.env.FUSION_SUBAGENT_AUTO_BACKGROUND_MS = "";
		expect(getSubagentAutoBackgroundMs()).toBe(0);
	});

	it("正值 60000 → 60000", () => {
		process.env.FUSION_SUBAGENT_AUTO_BACKGROUND_MS = "60000";
		expect(getSubagentAutoBackgroundMs()).toBe(60000);
	});

	it("120000 (对齐 CC 默认) → 120000", () => {
		process.env.FUSION_SUBAGENT_AUTO_BACKGROUND_MS = "120000";
		expect(getSubagentAutoBackgroundMs()).toBe(120000);
	});

	it("0 → 0 (显式 off)", () => {
		process.env.FUSION_SUBAGENT_AUTO_BACKGROUND_MS = "0";
		expect(getSubagentAutoBackgroundMs()).toBe(0);
	});

	it("负数 → 0 (fail-off)", () => {
		process.env.FUSION_SUBAGENT_AUTO_BACKGROUND_MS = "-5";
		expect(getSubagentAutoBackgroundMs()).toBe(0);
	});

	it("非数 → 0 (fail-off)", () => {
		process.env.FUSION_SUBAGENT_AUTO_BACKGROUND_MS = "abc";
		expect(getSubagentAutoBackgroundMs()).toBe(0);
	});

	// 还原
	if (orig === undefined) {
		delete process.env.FUSION_SUBAGENT_AUTO_BACKGROUND_MS;
	} else {
		process.env.FUSION_SUBAGENT_AUTO_BACKGROUND_MS = orig;
	}
});
