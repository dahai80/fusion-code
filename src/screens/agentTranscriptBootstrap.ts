// audit 1.1.1 slice #36: agent-transcript disk bootstrap useEffect body extracted (PURE-ASYNC-HELPER, 2nd — like slice #23 applyOnInit / #31 processInitialMessage).
// REPL() retained local_agent not yet loaded from disk → read sidechain JSONL, UUID-merge with messages already appended by the stream.
// Stream appends as soon as messages enter retain (no defer), bootstrap prepends the prefix; disk-write-before-yield → live is always a suffix of disk.
// guard (!viewingAgentTaskId || !needsBootstrap) stays in the REPL thin shell (needsBootstrap derived from the outer viewedLocalAgent, kept as a dep).
// ctx carries viewingAgentTaskId (guarded truthy) + setAppState. getAgentTranscript/asAgentId/isLocalAgentTask are standalone module imports.
// No JSX / no hook / no cleanup (useEffect body returns undefined), void .then as a single side effect, low replay risk.

import type { SetAppState } from "../Task.js";
import { isLocalAgentTask } from "../tasks/LocalAgentTask/LocalAgentTask.js";
import { asAgentId } from "../types/ids.js";
import { getAgentTranscript } from "../utils/sessionStorage.js";

type AgentTranscriptBootstrapCtx = {
	// guarded truthy (REPL thin shell early-returns via if (!viewingAgentTaskId || !needsBootstrap) return)
	viewingAgentTaskId: string;
	setAppState: SetAppState;
};

// REPL keeps the useEffect thin shell:
//   useEffect(() => {
//     if (!viewingAgentTaskId || !needsBootstrap) return;
//     applyAgentTranscriptBootstrap({ viewingAgentTaskId, setAppState });
//   }, [viewingAgentTaskId, needsBootstrap, setAppState]);
// taskId alias captured inside the helper (value at effect-run time, for the async .then closure), equivalent to the original const taskId = viewingAgentTaskId.
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
