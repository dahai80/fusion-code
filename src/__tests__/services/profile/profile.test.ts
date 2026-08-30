// ar-plan PR #9 (S3): profile 分层 + --dump-config 测试。
// spec line 413: 4 内置 profile 过滤正确、用户 profile 加载、profile=null 全集 byte-identical、requiresFlags 校验。
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	BUILTIN_PROFILES,
	filterToolsByProfile,
	getSessionProfile,
	loadProfile,
	setSessionProfile,
	validateProfileRequiresFlags,
} from "../../../services/profile/index.js";
import type { Tool } from "../../../Tool.js";

// 轻量假 tool: filterToolsByProfile 只读 tool.name。
function fakeTool(name: string): Tool {
	return { name } as unknown as Tool;
}

const FULL = [
	"Bash",
	"Read",
	"Write",
	"Edit",
	"MultiEdit",
	"Glob",
	"Grep",
	"WebSearch",
	"Agent",
	"CtxInspect",
	"TodoWrite",
	"WebFetch",
	"Skill",
].map(fakeTool);

describe("profile: builtin profiles filter", () => {
	it("minimal: 只留 7 core tools (复用 CORE_TOOLS)", () => {
		const profile = loadProfile("minimal");
		expect(profile).not.toBeNull();
		const filtered = filterToolsByProfile(FULL, profile).map((t) => t.name);
		expect(filtered.sort()).toEqual(
			["Bash", "Read", "Write", "Edit", "MultiEdit", "Glob", "Grep"].sort(),
		);
	});

	it("local: 禁 WebSearch (大 quota), 留 Agent/Skill/Todo", () => {
		const profile = loadProfile("local");
		const filtered = filterToolsByProfile(FULL, profile).map((t) => t.name);
		expect(filtered).not.toContain("WebSearch");
		expect(filtered).toContain("Agent");
		expect(filtered).toContain("Skill");
		expect(filtered).toContain("TodoWrite");
	});

	it("safe: 只读 4 tools, 无 Bash 无网络写", () => {
		const profile = loadProfile("safe");
		const filtered = filterToolsByProfile(FULL, profile).map((t) => t.name);
		expect(filtered.sort()).toEqual(
			["Read", "Glob", "Grep", "WebFetch"].sort(),
		);
		expect(filtered).not.toContain("Bash");
	});

	it("cloud: 黑名单 disabledTools (CtxInspect), 留其余", () => {
		const profile = loadProfile("cloud");
		const filtered = filterToolsByProfile(FULL, profile).map((t) => t.name);
		expect(filtered).not.toContain("CtxInspect");
		// 黑名单只去 1 个, 其余全留。
		expect(filtered.length).toBe(FULL.length - 1);
	});

	it("4 内置 profile 全可加载", () => {
		const names = Object.keys(BUILTIN_PROFILES);
		expect(names.sort()).toEqual(["cloud", "local", "minimal", "safe"]);
		for (const n of names) {
			expect(loadProfile(n)).not.toBeNull();
		}
	});
});

describe("profile: null = 全集 byte-identical", () => {
	it("profile=null → 原数组引用不变 (早 return)", () => {
		const filtered = filterToolsByProfile(FULL, null);
		expect(filtered).toBe(FULL);
	});

	it("loadProfile(undefined) → null", () => {
		expect(loadProfile(undefined)).toBeNull();
	});

	it("loadProfile 不存在名 → null (fail-open)", () => {
		expect(loadProfile("nonexistent-xyz-abc")).toBeNull();
	});
});

describe("profile: user profile 加载 (FUSION_CODE_PROFILE_DIR)", () => {
	const tmpDir = join(tmpdir(), `profile-test-${process.pid}`);
	let savedDir: string | undefined;

	beforeEach(() => {
		savedDir = process.env.FUSION_CODE_PROFILE_DIR;
		process.env.FUSION_CODE_PROFILE_DIR = tmpDir;
		mkdirSync(tmpDir, { recursive: true });
	});

	afterEach(() => {
		if (savedDir === undefined) {
			delete process.env.FUSION_CODE_PROFILE_DIR;
		} else {
			process.env.FUSION_CODE_PROFILE_DIR = savedDir;
		}
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("用户 json: enabledTools 白名单生效", () => {
		writeFileSync(
			join(tmpDir, "custom.json"),
			JSON.stringify({
				name: "custom",
				enabledTools: ["Read", "Grep"],
				description: "test",
			}),
		);
		const profile = loadProfile("custom");
		expect(profile?.name).toBe("custom");
		const filtered = filterToolsByProfile(FULL, profile).map((t) => t.name);
		expect(filtered.sort()).toEqual(["Grep", "Read"].sort());
	});

	it("用户 json name 字段不匹配 → fail-open null", () => {
		writeFileSync(
			join(tmpDir, "mismatch.json"),
			JSON.stringify({ name: "wrong-name", enabledTools: ["Read"] }),
		);
		expect(loadProfile("mismatch")).toBeNull();
	});

	it("用户 json 损坏 → fail-open null", () => {
		writeFileSync(join(tmpDir, "broken.json"), "{ not valid json");
		expect(loadProfile("broken")).toBeNull();
	});

	it("内置名优先于用户 json", () => {
		// 即便有 local.json, 内置 local 命中先返。
		writeFileSync(
			join(tmpDir, "local.json"),
			JSON.stringify({ name: "local", enabledTools: ["Bash"] }),
		);
		const profile = loadProfile("local");
		expect(profile?.enabledTools?.length).toBeGreaterThan(1);
	});
});

describe("profile: requiresFlags 校验", () => {
	it("无 requiresFlags → pass (no throw)", () => {
		expect(() =>
			validateProfileRequiresFlags(BUILTIN_PROFILES.minimal, () => false),
		).not.toThrow();
	});

	it("requiresFlags 全满足 → pass", () => {
		const profile = {
			name: "flagged",
			requiresFlags: ["FOO", "BAR"],
		};
		expect(() =>
			validateProfileRequiresFlags(profile, (f) => f === "FOO" || f === "BAR"),
		).not.toThrow();
	});

	it("requiresFlags 缺失 → throw (fail-visible)", () => {
		const profile = {
			name: "flagged",
			requiresFlags: ["ULTRAPLAN", "MISSING"],
		};
		expect(() =>
			validateProfileRequiresFlags(profile, (f) => f === "ULTRAPLAN"),
		).toThrow(/requires build flag\(s\) not satisfied: MISSING/);
	});

	it("profile=null → no-op", () => {
		expect(() => validateProfileRequiresFlags(null, () => false)).not.toThrow();
	});
});

describe("profile: session holder", () => {
	afterEach(() => {
		setSessionProfile(null);
	});

	it("setSessionProfile / getSessionProfile 往返", () => {
		setSessionProfile(BUILTIN_PROFILES.safe);
		expect(getSessionProfile()?.name).toBe("safe");
	});

	it("getSessionProfile 默认 null (byte-identical off)", () => {
		setSessionProfile(null);
		expect(getSessionProfile()).toBeNull();
	});
});
