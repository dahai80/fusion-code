// ar-plan PR #9 (S3): profile tiering + --dump-config.
//
// DSH-style plugin-tree filtering: --profile <name> trims the tool set to the profile's allow/deny lists.
// default-off: no profile specified = null = full set byte-identical (filterToolsByProfile early-returns).
// The profile layer stacks **after** MLX tiering (MLX trims by model size, profile trims further by scenario; the two are orthogonal).
// Reuses the Tool.isEnabled seam + the filterToolsByDenyRules pattern; does not rewrite tools.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Tool, Tools } from "../../Tool.js";
import { logForDebugging } from "../../utils/debug.js";
import { isEnvTruthy } from "../../utils/envUtils.js";
import { BUILTIN_PROFILES, getBuiltinProfile } from "./builtinProfiles.js";

export interface Profile {
	name: string;
	enabledTools?: string[]; // allowlist (unlisted = denied)
	disabledTools?: string[]; // denylist
	requiresFlags?: string[]; // build-flag requirements (profile needs ULTRAPLAN etc.)
	description?: string;
}

// FUSION_CODE_PROFILE_DIR override (test isolation); default ~/.fusion-code/profiles/
function profileDir(): string {
	return (
		process.env.FUSION_CODE_PROFILE_DIR ??
		join(homedir(), ".fusion-code", "profiles")
	);
}

// Load a profile: built-ins first, then the user directory. null = full set (no --profile).
// Builtin name hit → return the builtin; otherwise look up the user json; neither → null (fail-open, full set byte-identical).
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
		// P2-11: schema-validate that enabledTools/disabledTools/requiresFlags are string[].
		// A bare JSON.parse as Profile does no cast checking — non-string entries make new Set +
		// set.has behave unexpectedly. A malicious/hand-edited profile injecting non-strings → rejected
		// (fail-open full set byte-identical).
		const strArrayFields: (keyof Profile)[] = [
			"enabledTools",
			"disabledTools",
			"requiresFlags",
		];
		for (const field of strArrayFields) {
			const val = parsed[field];
			if (val === undefined) continue;
			if (!Array.isArray(val) || val.some((e) => typeof e !== "string")) {
				logForDebugging(
					`[profile] user "${name}" schema mismatch (${String(field)} not string[]); fail-open full set`,
				);
				return null;
			}
		}
		return parsed;
	} catch (err) {
		logForDebugging(
			`[profile] user "${name}" load failed: ${err instanceof Error ? err.message : String(err)}; fail-open full set`,
		);
		return null;
	}
}

// Profile validation: unmet requiresFlags → throws (fail-visible). The caller decides when to validate.
// Build flags are decided at compile time by feature() — at runtime you cannot query feature(dynamicName)
// (the bun compiler requires feature() arguments to be string literals, otherwise DCE fails + the build errors).
// So runtime validation relies on FUSION_CODE_ENABLED_FLAGS (comma-separated) or fail-open (unset = all satisfied).
// No requiresFlags → pass.
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

// Runtime featureChecker: consults FUSION_CODE_ENABLED_FLAGS (comma-separated).
// Unset → fail-open (all satisfied), avoiding the feature() compile-time limitation blocking runtime.
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

// Filter the tool set by profile. profile=null → returned as-is (byte-identical).
// The enabledTools allowlist (tool name not listed → filtered out) takes precedence over the disabledTools denylist.
// Reuses the Tool.name seam; does not touch Tool.isEnabled (that is the feature-gate layer).
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

// Whether profiles are enabled (env-gated, default-off byte-identical).
export function isProfileEnabled(): boolean {
	return isEnvTruthy(process.env.FUSION_CODE_PROFILE_ENABLED);
}

// Session-level profile holder: cli.tsx calls setSessionProfile after parsing --profile,
// getTools reads it (stacked after MLX tiering). globalThis unset = null = byte-identical.
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
