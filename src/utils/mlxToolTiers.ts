/**
 * MLX 本地模式工具集分档 (#222)
 *
 * 按模型参数规模分三档: CORE (≤2B) / MEDIUM (≤9B) / FULL。
 * 规模解析必须走数值, 不能子串匹配 — "14b" 含 "1b" 子串, 旧实现把
 * 14B 模型误降档进 ≤2B 核心工具集, 大模型能力被白砍。
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

// #222: 数值正则 — 提取 "<n>b" 后缀中的 n (支持小数如 0.6b)。
// \b 保证 "4bit" 里的 4 不被当成规模 ("4b" 后跟 "it" 无词边界)。
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
		// 规模解析不出 (云模型名/无后缀): 保持旧行为给全量工具集
		logForDebugging(
			`mlx tool filter: model id "${id}" has no parseable size, full toolset`,
		);
		return FULL_TOOLS;
	}
	if (sizeB <= 2) return CORE_TOOLS;
	if (sizeB <= 9) return MEDIUM_TOOLS;
	return FULL_TOOLS;
}
