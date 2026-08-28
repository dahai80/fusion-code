// audit 1.4.2 (CRITICAL): workflow kill 是 no-op 的根因之一 —— abortController
// 在 WorkflowTool.execute 创建后无处存放, kill 路径拿不到它, 永不 .abort()。
// 此注册表把 runId → controller 存进模块级 Map, 供 LocalWorkflowTask.kill / ESC kill
// / reaper 通过 runId 反查并触发 .abort()。runtime.ts 已在 328/390 行检查
// signal.aborted 并抛 "Workflow aborted", 故只需触发 abort, 无需重建机制。
//
// 独立模块避免循环依赖: 不导入 tasks.ts / Task.ts (它们反过来被 WorkflowTool 用)。

import { logForDebugging } from "../../utils/debug.js";

// runId → AbortController。workflow 启动时 register, kill/完成时 clear。
const controllers = new Map<string, AbortController>();

export function registerWorkflowAbort(runId: string, controller: AbortController): void {
	controllers.set(runId, controller);
}

export function getWorkflowAbortController(runId: string): AbortController | undefined {
	return controllers.get(runId);
}

// 触发 abort 并移除。返回是否真的中止了一个未中止的 controller。
// 幂等: 已中止/未注册 → false, 不抛。
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

// 统计当前在飞 (已注册未中止) 的 workflow 数。供准入 cap (1.4.1/2.1.3) 判定。
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
