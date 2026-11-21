/**
 * MLX local-mode toolset tiers (#222)
 *
 * Three tiers by model parameter size: CORE (≤2B) / MEDIUM (≤9B) / FULL.
 * Size resolution must be numeric, never substring matching — "14b" contains
 * the substring "1b", and the old implementation downgraded 14B models into
 * the ≤2B core toolset, needlessly crippling large-model capability.
 */

import { logForDebugging } from "./debug.js";

export const CORE_TOOLS = new Set([
	"Bash",
	"Read",
	"Write",
	"Edit",
	"MultiEdit",
	"Glob",
	"Grep",
]);

export const MEDIUM_TOOLS = new Set([
	...CORE_TOOLS,
	"AskUserQuestion",
	"TodoWrite",
	"WebFetch",
	"WebSearch",
]);

export const FULL_TOOLS = new Set([
	...MEDIUM_TOOLS,
	"Agent",
	"TaskCreate",
	"TaskGet",
	"TaskUpdate",
	"TaskList",
	"NotebookEdit",
	"Skill",
	"EnterPlanMode",
	"ExitPlanMode",
	"Sleep",
	"TeamCreate",
	"TeamDelete",
	"CtxInspect",
	"CreateArtifact",
	"UpdateArtifact",
	"LoadArtifact",
	"PatchArtifact",
	"CreateGoal",
	"GetGoal",
	"SetGoalBudget",
	"UpdateGoal",
	"SendDMail",
]);

// #222: numeric regex — extract n from the "<n>b" suffix (supports decimals like 0.6b).
// \b ensures the 4 in "4bit" is not taken as a size ("4b" followed by "it" has no word boundary).
const MODEL_SIZE_B_RE = /(\d+(?:\.\d+)?)b\b/i;

export function parseModelSizeB(modelId: string): number | null {
	const m = MODEL_SIZE_B_RE.exec(modelId);
	if (!m) return null;
	const size = Number.parseFloat(m[1]);
	return Number.isFinite(size) ? size : null;
}

export function getMlxToolFilterForModel(modelId: string): Set<string> {
	const id = modelId.toLowerCase();
	const sizeB = parseModelSizeB(id);
	if (sizeB === null) {
		// Size unresolvable (cloud model name / no suffix): keep old behavior, full toolset
		logForDebugging(
			`mlx tool filter: model id "${id}" has no parseable size, full toolset`,
		);
		return FULL_TOOLS;
	}
	if (sizeB <= 2) return CORE_TOOLS;
	if (sizeB <= 9) return MEDIUM_TOOLS;
	return FULL_TOOLS;
}
