// audit 1.1.1 slice #36: agent-transcript disk bootstrap useEffect body 外移 (PURE-ASYNC-HELPER, 2nd — 像 slice #23 applyOnInit / #31 processInitialMessage)。
// REPL() retained local_agent 未加载 disk → 读 sidechain JSONL, UUID-merge 与 stream 已 append 的 messages。
// Stream 进 retain 即 append (无 defer), bootstrap 补 prefix; disk-write-before-yield → live 恒为 disk 后缀。
// guard (!viewingAgentTaskId || !needsBootstrap) 留 REPL 薄壳 (needsBootstrap 由外层 viewedLocalAgent 派生, 作 dep)。
// ctx 携带 viewingAgentTaskId (guard 保证 truthy) + setAppState。getAgentTranscript/asAgentId/isLocalAgentTask 为独立 module import。
// 无 JSX/无 hook/无 cleanup (useEffect body 返 undefined), void .then 单副作用, replay 风险低。

import type { SetAppState } from "../Task.js";
import { isLocalAgentTask } from "../tasks/LocalAgentTask/LocalAgentTask.js";
import { asAgentId } from "../types/ids.js";
import { getAgentTranscript } from "../utils/sessionStorage.js";

type AgentTranscriptBootstrapCtx = {
	// guard 保证 truthy (REPL 薄壳 if (!viewingAgentTaskId || !needsBootstrap) return 早退)
	viewingAgentTaskId: string;
	setAppState: SetAppState;
};

// REPL 保留 useEffect 薄壳:
//   useEffect(() => {
//     if (!viewingAgentTaskId || !needsBootstrap) return;
//     applyAgentTranscriptBootstrap({ viewingAgentTaskId, setAppState });
//   }, [viewingAgentTaskId, needsBootstrap, setAppState]);
// taskId 别名在 helper 内捕获 (effect-run 时值, 供 async .then 闭包), 与原 const taskId = viewingAgentTaskId 等价。
export function applyAgentTranscriptBootstrap(
	ctx: AgentTranscriptBootstrapCtx,
): void {
	const taskId = ctx.viewingAgentTaskId;
	void getAgentTranscript(asAgentId(taskId)).then((result) => {
		ctx.setAppState((prev) => {
			const t = prev.tasks[taskId];
			if (!isLocalAgentTask(t) || t.diskLoaded || !t.retain) return prev;
			const live = t.messages ?? [];
			const liveUuids = new Set(live.map((m) => m.uuid));
			const diskOnly = result
				? result.messages.filter((m) => !liveUuids.has(m.uuid))
				: [];
			return {
				...prev,
				tasks: {
					...prev.tasks,
					[taskId]: {
						...t,
						messages: [...diskOnly, ...live],
						diskLoaded: true,
					},
				},
			};
		});
	});
}
