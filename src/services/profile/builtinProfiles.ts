// ar-plan PR #9 (S3): 4 builtin profiles.
//
// local — MLX local scenario: core + executor-related, blocks cloud-heavy quota (WebSearch).
// cloud — cloud scenario: full set + WebSearch, blocks executor-specific (Layer B not needed on cloud).
// safe — read-only + no Shell + no network (≈ --safe-mode, but composable as a profile).
// minimal — 5 core tools (reuses existing CORE_TOOLS tiering: Read/Write/Edit/Glob/Grep/Bash/MultiEdit).
import type { Profile } from "./profile.js";

// minimal: reuses tools.ts CORE_TOOLS (7: Bash/Read/Write/Edit/MultiEdit/Glob/Grep).
const MINIMAL_TOOLS = [
	"Bash",
	"Read",
	"Write",
	"Edit",
	"MultiEdit",
	"Glob",
	"Grep",
];

// local: MLX local — core + Agent/Skill/Todo, blocks WebSearch (heavy quota, cloud-only).
const LOCAL_TOOLS = [
	"Bash",
	"Read",
	"Write",
	"Edit",
	"MultiEdit",
	"Glob",
	"Grep",
	"AskUserQuestion",
	"TodoWrite",
	"WebFetch",
	"Agent",
	"TaskCreate",
	"TaskGet",
	"TaskUpdate",
	"TaskList",
	"Skill",
	"EnterPlanMode",
	"ExitPlanMode",
];

// cloud: full cloud set — adds WebSearch, blocks executor-specific tools (CtxInspect = Layer B debugging).
const CLOUD_DISABLED = ["CtxInspect"];

// safe: read-only, no Shell no network. enabledTools allowlist = read-only core.
const SAFE_TOOLS = ["Read", "Glob", "Grep", "WebFetch"];

export const BUILTIN_PROFILES: Record<string, Profile> = {
	local: {
		name: "local",
		enabledTools: LOCAL_TOOLS,
		description:
			"MLX local scenario: core tools + Agent/Skill/Todo, WebSearch blocked (heavy quota)",
	},
	cloud: {
		name: "cloud",
		disabledTools: CLOUD_DISABLED,
		description:
			"Cloud scenario: full set + WebSearch, executor-specific blocked (not needed on cloud Layer B)",
	},
	safe: {
		name: "safe",
		enabledTools: SAFE_TOOLS,
		description:
			"Read-only + no Shell + no network (≈ --safe-mode, composable as a profile)",
	},
	minimal: {
		name: "minimal",
		enabledTools: MINIMAL_TOOLS,
		description:
			"Core tool set (reuses MLX compact tiering: Bash/Read/Write/Edit/MultiEdit/Glob/Grep)",
	},
};

export function getBuiltinProfile(name: string): Profile | undefined {
	return BUILTIN_PROFILES[name];
}
