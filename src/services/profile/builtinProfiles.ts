// ar-plan PR #9 (S3): 4 内置 profile。
//
// local — MLX 本地场景: 核心 + executor 相关, 禁云端大 quota (WebSearch)。
// cloud — 云端场景: 全套 + WebSearch, 禁 executor 专属 (Layer B 云端不需)。
// safe — 只读 + 无 Shell + 无网络 (≈ --safe-mode, 但 profile 化可组合)。
// minimal — 5 core tools (复用现 CORE_TOOLS 分层: Read/Write/Edit/Glob/Grep/Bash/MultiEdit)。
import type { Profile } from "./profile.js";

// minimal: 复用 tools.ts CORE_TOOLS (7: Bash/Read/Write/Edit/MultiEdit/Glob/Grep)。
const MINIMAL_TOOLS = [
	"Bash",
	"Read",
	"Write",
	"Edit",
	"MultiEdit",
	"Glob",
	"Grep",
];

// local: MLX 本地 — 核心 + Agent/Skill/Todo, 禁 WebSearch (大 quota 云端专属)。
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

// cloud: 云端全套 — 加 WebSearch, 禁 executor 专属工具 (CtxInspect = Layer B 调试)。
const CLOUD_DISABLED = ["CtxInspect"];

// safe: 只读, 无 Shell 无网络。enabledTools 白名单 = 只读核心。
const SAFE_TOOLS = ["Read", "Glob", "Grep", "WebFetch"];

export const BUILTIN_PROFILES: Record<string, Profile> = {
	local: {
		name: "local",
		enabledTools: LOCAL_TOOLS,
		description:
			"MLX 本地场景: 核心工具 + Agent/Skill/Todo, 禁 WebSearch (大 quota)",
	},
	cloud: {
		name: "cloud",
		disabledTools: CLOUD_DISABLED,
		description:
			"云端场景: 全套 + WebSearch, 禁 executor 专属 (Layer B 云端不需)",
	},
	safe: {
		name: "safe",
		enabledTools: SAFE_TOOLS,
		description: "只读 + 无 Shell + 无网络 (≈ --safe-mode, profile 化可组合)",
	},
	minimal: {
		name: "minimal",
		enabledTools: MINIMAL_TOOLS,
		description:
			"核心工具集 (复用 MLX compact 分层: Bash/Read/Write/Edit/MultiEdit/Glob/Grep)",
	},
};

export function getBuiltinProfile(name: string): Profile | undefined {
	return BUILTIN_PROFILES[name];
}
