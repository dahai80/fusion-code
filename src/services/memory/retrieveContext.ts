/**
 * Turn-start memory retrieve — 在 query loop 开始 (processUserInput) 时
 * 从 fusion-memory 长期记忆召回相关上下文, 注入到本轮对话。
 *
 * 与 commitTurn 对称: commit 在 turn 结束写入, retrieve 在 turn 开始召回。
 * 仿 extractMemories 模式: 仅主 agent (非 subagent), 失败 logForDebugging
 * 不抛, 不阻断主流程。
 *
 * 检索结果经 formatContextToPrompt 格式化为 <fusion_memory_context> 段,
 * 由调用方作为 attachment message 注入 (与 UserPromptSubmit hook
 * additionalContext 同一路径)。
 *
 * env (operator):
 *   FUSION_MEMORY_API_KEY 未配置 → retrieveContext 内部跳过返 null
 *   FUSION_MEMORY_RETRIEVE_TOP_K (默认 10) / FUSION_MEMORY_RETRIEVE_BUDGET (默认 4096)
 */

import { logForDebugging } from "src/utils/debug.js";
import {
	formatContextToPrompt,
	retrieveContext,
} from "./fusionMemoryClient.js";

function getRetrieveTopK(): number {
	const raw = process.env.FUSION_MEMORY_RETRIEVE_TOP_K;
	const parsed = raw ? Number.parseInt(raw, 10) : 10;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

function getRetrieveBudget(): number {
	const raw = process.env.FUSION_MEMORY_RETRIEVE_BUDGET;
	const parsed = raw ? Number.parseInt(raw, 10) : 4096;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 4096;
}

export interface RetrieveMemoryContext {
	inputText: string;
	agentId?: string;
}

/**
 * 召回与本轮用户输入相关的长期记忆, 返回可注入的 <fusion_memory_context> 段。
 * 空字符串表示跳过 (主 agent 守卫不满足 / 无输入 / 检索失败 / 无命中)。
 * 永不抛异常。
 *
 * @returns 记忆段字符串 (非空才注入) / "" (跳过)
 */
export async function retrieveMemorySection(
	ctx: RetrieveMemoryContext,
): Promise<string> {
	// 仅主 agent, 与 commitLastTurn 守卫一致
	if (ctx.agentId) return "";
	const query = ctx.inputText?.trim();
	if (!query) return "";

	try {
		const formatted = await retrieveContext(
			query,
			getRetrieveTopK(),
			getRetrieveBudget(),
		);
		const section = formatContextToPrompt(formatted);
		if (section) {
			const n = formatted?.blocks?.length ?? 0;
			logForDebugging(
				`[Fusion-Memory] retrieved ${n} memory block(s) for turn-start inject`,
			);
		}
		return section;
	} catch (error) {
		logForDebugging(
			`[Fusion-Memory] retrieveMemorySection error: ${(error as Error).message}`,
		);
		return "";
	}
}
