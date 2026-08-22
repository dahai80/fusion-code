import { isEnvTruthy } from "../../utils/envUtils.js";

// item 12 (CC 2.1.198/232): 子代理自动后台化阈值解析。
// 并行 item 4 FUSION_MCP_AUTO_BACKGROUND_MS (src/services/mcp/client.ts)。
// FUSION_SUBAGENT_AUTO_BACKGROUND_MS 设正值 → subagent 运行该毫秒后转后台,
// 复用 registerAgentForeground 定时器→backgroundSignal→mid-run 后台化解阻塞 turn。
// default 0=off, byte-identical 旧行为。
export function getSubagentAutoBackgroundMs(): number {
	const raw = process.env.FUSION_SUBAGENT_AUTO_BACKGROUND_MS;
	if (raw === undefined || raw === "") {
		return 0;
	}
	const parsed = parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return 0;
	}
	return parsed;
}

// 维度5 (P2.1): 子代理默认后台 spawn 开关。
// 与 item 12 FUSION_SUBAGENT_AUTO_BACKGROUND_MS 正交: item 12 是 foreground
// else 分支 mid-run 后台化定时器; 本开关是 async-from-start (spawn 即后台)。
// shouldRunAsync 加第 6 || 项, !isInProcessTeammate() guard (in-process 队友
// 生命周期绑 leader 进程不可后台, 同 line 455 既有 throw 模式)。
// default off (isEnvTruthy 未设/空/false/0 → false), byte-identical 旧行为。
export function isSubagentDefaultBackground(): boolean {
	return isEnvTruthy(process.env.FUSION_SUBAGENT_DEFAULT_BACKGROUND);
}
