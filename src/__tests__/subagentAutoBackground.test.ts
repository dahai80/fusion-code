/**
 * item 12: 子代理自动后台化阈值解析单测 (CC 2.1.198/232)
 */
import { describe, expect, it } from "bun:test";
import {
	getSubagentAutoBackgroundMs,
	isSubagentDefaultBackground,
} from "../tools/AgentTool/autoBackground.js";

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

/**
 * 维度5: 子代理默认后台 spawn 开关单测 (P2.1 维度5)
 */
describe("isSubagentDefaultBackground", () => {
	const orig = process.env.FUSION_SUBAGENT_DEFAULT_BACKGROUND;

	it("未设 → false (default off, byte-identical)", () => {
		delete process.env.FUSION_SUBAGENT_DEFAULT_BACKGROUND;
		expect(isSubagentDefaultBackground()).toBe(false);
	});

	it("空串 → false", () => {
		process.env.FUSION_SUBAGENT_DEFAULT_BACKGROUND = "";
		expect(isSubagentDefaultBackground()).toBe(false);
	});

	it("1 → true", () => {
		process.env.FUSION_SUBAGENT_DEFAULT_BACKGROUND = "1";
		expect(isSubagentDefaultBackground()).toBe(true);
	});

	it("true → true", () => {
		process.env.FUSION_SUBAGENT_DEFAULT_BACKGROUND = "true";
		expect(isSubagentDefaultBackground()).toBe(true);
	});

	it("yes → true", () => {
		process.env.FUSION_SUBAGENT_DEFAULT_BACKGROUND = "yes";
		expect(isSubagentDefaultBackground()).toBe(true);
	});

	it("on → true", () => {
		process.env.FUSION_SUBAGENT_DEFAULT_BACKGROUND = "on";
		expect(isSubagentDefaultBackground()).toBe(true);
	});

	it("大写 TRUE → true (normalize)", () => {
		process.env.FUSION_SUBAGENT_DEFAULT_BACKGROUND = "TRUE";
		expect(isSubagentDefaultBackground()).toBe(true);
	});

	it("0 → false (显式 off)", () => {
		process.env.FUSION_SUBAGENT_DEFAULT_BACKGROUND = "0";
		expect(isSubagentDefaultBackground()).toBe(false);
	});

	it("false → false", () => {
		process.env.FUSION_SUBAGENT_DEFAULT_BACKGROUND = "false";
		expect(isSubagentDefaultBackground()).toBe(false);
	});

	it("off → false", () => {
		process.env.FUSION_SUBAGENT_DEFAULT_BACKGROUND = "off";
		expect(isSubagentDefaultBackground()).toBe(false);
	});

	it("随机串 → false (fail-off, 非 truthy 值)", () => {
		process.env.FUSION_SUBAGENT_DEFAULT_BACKGROUND = "maybe";
		expect(isSubagentDefaultBackground()).toBe(false);
	});

	// 还原
	if (orig === undefined) {
		delete process.env.FUSION_SUBAGENT_DEFAULT_BACKGROUND;
	} else {
		process.env.FUSION_SUBAGENT_DEFAULT_BACKGROUND = orig;
	}
});
