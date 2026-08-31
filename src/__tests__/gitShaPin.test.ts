/**
 * P0-3 (audit R2): git-family 源 sha pin gate — 缺 sha 行为单测。
 *
 * - 缺 sha + 默认 (LENIENT 未设) → throw (fail-closed, 企业级供应链基线)
 * - 缺 sha + LENIENT=1 → 不抛 (fail-open, 放行到 clone)
 * - 有 sha → 不抛 (放行)
 *
 * requireGitShaPin 是纯同步守卫 (无网络/无 settings 加载), 直接单测。
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

const { requireGitShaPin } = await import("../utils/plugins/gitShaPin.js");

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
	savedEnv.FUSION_CODE_PLUGIN_SHA256_LENIENT =
		process.env.FUSION_CODE_PLUGIN_SHA256_LENIENT;
	delete process.env.FUSION_CODE_PLUGIN_SHA256_LENIENT;
});

afterEach(() => {
	if (savedEnv.FUSION_CODE_PLUGIN_SHA256_LENIENT !== undefined) {
		process.env.FUSION_CODE_PLUGIN_SHA256_LENIENT =
			savedEnv.FUSION_CODE_PLUGIN_SHA256_LENIENT;
	} else {
		delete process.env.FUSION_CODE_PLUGIN_SHA256_LENIENT;
	}
});

describe("requireGitShaPin — git-family sha gate (P0-3 audit R2)", () => {
	it("github 源缺 sha + 默认 → throw (fail-closed)", () => {
		expect(() => requireGitShaPin("github", "owner/repo", undefined)).toThrow(
			/github.*missing commit sha pin/,
		);
	});

	it("url 源缺 sha + 默认 → throw (fail-closed)", () => {
		expect(() =>
			requireGitShaPin("url", "https://example.com/repo.git", undefined),
		).toThrow(/url.*missing commit sha pin/);
	});

	it("git-subdir 源缺 sha + 默认 → throw (fail-closed)", () => {
		expect(() =>
			requireGitShaPin("git-subdir", "owner/repo", undefined),
		).toThrow(/git-subdir.*missing commit sha pin/);
	});

	it("缺 sha + LENIENT=1 → 不抛 (fail-open 兼容期)", () => {
		process.env.FUSION_CODE_PLUGIN_SHA256_LENIENT = "1";
		expect(() =>
			requireGitShaPin("github", "owner/repo", undefined),
		).not.toThrow();
	});

	it("有 sha + 默认 → 不抛 (放行到 clone)", () => {
		expect(() =>
			requireGitShaPin("github", "owner/repo", "abc123def456"),
		).not.toThrow();
	});

	it("缺 sha + LENIENT=0 → throw (falsy 不触发 fail-open)", () => {
		process.env.FUSION_CODE_PLUGIN_SHA256_LENIENT = "0";
		expect(() => requireGitShaPin("github", "owner/repo", undefined)).toThrow(
			/github.*missing commit sha pin/,
		);
	});
});
