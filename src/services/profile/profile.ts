// ar-plan PR #9 (S3): profile 分层 + --dump-config。
//
// DSH 风格插件树过滤: --profile <name> 裁工具集到 profile 白/黑名单。
// default-off: profile 未指定 = null = 全集 byte-identical (filterToolsByProfile 早 return)。
// profile 层在 MLX 分层**之后**叠加 (MLX 按 model size 裁, profile 按场景再裁, 两正交)。
// 复用 Tool.isEnabled 缝 + filterToolsByDenyRules 模式, 不重写工具。

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Tool, Tools } from "../../Tool.js";
import { logForDebugging } from "../../utils/debug.js";
import { isEnvTruthy } from "../../utils/envUtils.js";
import { BUILTIN_PROFILES, getBuiltinProfile } from "./builtinProfiles.js";

export interface Profile {
	name: string;
	enabledTools?: string[]; // 白名单 (未列 = 禁)
	disabledTools?: string[]; // 黑名单
	requiresFlags?: string[]; // build flag 要求 (profile 需 ULTRAPLAN 等)
	description?: string;
}

// FUSION_CODE_PROFILE_DIR 覆盖 (测试隔离); 默认 ~/.fusion-code/profiles/
function profileDir(): string {
	return (
		process.env.FUSION_CODE_PROFILE_DIR ??
		join(homedir(), ".fusion-code", "profiles")
	);
}

// 加载 profile: 先内置再用户目录。null = 全集 (无 --profile)。
// 内置名命中 → 返回内置; 否则查用户 json; 都无 → null (fail-open, 全集 byte-identical)。
export function loadProfile(name?: string): Profile | null {
	if (!name) return null;
	const builtin = getBuiltinProfile(name);
	if (builtin) return builtin;
	const userPath = join(profileDir(), `${name}.json`);
	if (!existsSync(userPath)) {
		logForDebugging(
			`[profile] "${name}" not found (builtin nor ${userPath}); using full set (fail-open)`,
		);
		return null;
	}
	try {
		const raw = readFileSync(userPath, "utf8");
		const parsed = JSON.parse(raw) as Profile;
		if (typeof parsed.name !== "string" || parsed.name !== name) {
			logForDebugging(
				`[profile] user "${name}" schema mismatch (name field); fail-open full set`,
			);
			return null;
		}
		return parsed;
	} catch (err) {
		logForDebugging(
			`[profile] user "${name}" load failed: ${err instanceof Error ? err.message : String(err)}; fail-open full set`,
		);
		return null;
	}
}

// profile 校验: requiresFlags 未满足 → 抛 (fail-visible)。调用方决定何时校验。
// build flag 在编译期由 feature() 决定 — 运行期无法用 feature(动态名) 查
// (bun 编译器要求 feature() 参数为字符串字面量, 否则 DCE 失败 + build 报错)。
// 故运行期校验靠 FUSION_CODE_ENABLED_FLAGS (逗号分隔) 或 fail-open (未设=全满足)。
// 无 requiresFlags → pass。
export function validateProfileRequiresFlags(
	profile: Profile | null,
	featureChecker: (flag: string) => boolean,
): void {
	if (!profile?.requiresFlags?.length) return;
	const missing = profile.requiresFlags.filter((f) => !featureChecker(f));
	if (missing.length > 0) {
		throw new Error(
			`profile "${profile.name}" requires build flag(s) not satisfied: ${missing.join(", ")}`,
		);
	}
}

// 运行期 featureChecker: 查 FUSION_CODE_ENABLED_FLAGS (逗号分隔)。
// 未设 → fail-open (全满足), 避免 feature() 编译期限制阻塞运行期。
export function enabledFlagsChecker(): (flag: string) => boolean {
	const raw = process.env.FUSION_CODE_ENABLED_FLAGS;
	if (!raw) return () => true;
	const set = new Set(
		raw
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	);
	return (flag: string) => set.has(flag);
}

// 过滤工具集 by profile。profile=null → 原样返回 (byte-identical)。
// enabledTools 白名单 (tool 名不在 → 滤) 优先于 disabledTools 黑名单。
// 复用 Tool.name 缝, 不改 Tool.isEnabled (那是 feature-gate 层)。
export function filterToolsByProfile(
	tools: Tools,
	profile: Profile | null,
): Tools {
	if (!profile) return tools;
	const enabledSet = profile.enabledTools
		? new Set(profile.enabledTools)
		: null;
	const disabledSet = profile.disabledTools
		? new Set(profile.disabledTools)
		: null;
	return tools.filter((tool: Tool) => {
		if (enabledSet && !enabledSet.has(tool.name)) return false;
		if (disabledSet?.has(tool.name)) return false;
		return true;
	});
}

// profile 是否启用 (env 门控, default-off byte-identical)。
export function isProfileEnabled(): boolean {
	return isEnvTruthy(process.env.FUSION_CODE_PROFILE_ENABLED);
}

// Session 级 profile holder: cli.tsx --profile 解析后 setSessionProfile,
// getTools 读取 (MLX 分层之后叠加)。globalThis 未设 = null = byte-identical。
declare global {
	// eslint-disable-next-line no-var
	var __fusionSessionProfile: Profile | null | undefined;
}

export function setSessionProfile(profile: Profile | null): void {
	globalThis.__fusionSessionProfile = profile;
}

export function getSessionProfile(): Profile | null {
	return globalThis.__fusionSessionProfile ?? null;
}

export { BUILTIN_PROFILES };
