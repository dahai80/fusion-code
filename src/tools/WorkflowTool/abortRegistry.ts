// audit 1.4.2 (CRITICAL): one of the root causes of workflow kill being a no-op — the abortController
// created in WorkflowTool.execute had nowhere to be stored, so the kill path could not reach it and never called .abort().
// This registry stores runId → controller in a module-level Map so LocalWorkflowTask.kill / ESC kill
// / the reaper can look up by runId and trigger .abort(). runtime.ts already checks
// signal.aborted at lines 328/390 and throws "Workflow aborted", so triggering abort is all that is needed — no rebuild mechanism required.
//
// Standalone module to avoid circular dependencies: does not import tasks.ts / Task.ts (which use WorkflowTool in reverse).

import { logForDebugging } from "../../utils/debug.js";

// runId → AbortController. Register on workflow start, clear on kill/completion.
const controllers = new Map<string, AbortController>();

export function registerWorkflowAbort(
	runId: string,
	controller: AbortController,
): void {
	controllers.set(runId, controller);
}

export function getWorkflowAbortController(
	runId: string,
): AbortController | undefined {
	return controllers.get(runId);
}

// Triggers abort and removes. Returns whether an un-aborted controller was actually aborted.
// Idempotent: already aborted / not registered → false, no throw.
export function abortWorkflowRun(runId: string): boolean {
	const controller = controllers.get(runId);
	if (!controller) {
		logForDebugging(`[Workflow] abortWorkflowRun: no controller for ${runId}`);
		return false;
	}
	if (controller.signal.aborted) {
		return false;
	}
	controller.abort();
	logForDebugging(`[Workflow] aborted run ${runId}`);
	return true;
}

export function clearWorkflowAbort(runId: string): void {
	controllers.delete(runId);
}

// Counts currently in-flight (registered and not aborted) workflows. Used for the admission cap decision (1.4.1/2.1.3).
export function countActiveWorkflowRuns(): number {
	let n = 0;
	for (const controller of controllers.values()) {
		if (!controller.signal.aborted) n++;
	}
	return n;
}

export function listActiveWorkflowRunIds(): string[] {
	const ids: string[] = [];
	for (const [runId, controller] of controllers.entries()) {
		if (!controller.signal.aborted) ids.push(runId);
	}
	return ids;
}
