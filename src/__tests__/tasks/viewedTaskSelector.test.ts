import { describe, expect, it } from "bun:test";
import type { TaskState } from "../../tasks/types.js";
import {
	getViewedAgentTask,
	getViewedTask,
	getViewedTeammateTask,
} from "../../tasks/viewedTaskSelector.js";

// audit 1.1.1: 选择器单元测试。guards 只看 type 判别符, 最小 fake 对象即可。
// 行为等价 REPL 内联推导, 字节无关 — 验证 narrowing 分支正确。

const teammateTask = { type: "in_process_teammate" } as unknown as TaskState;
const localAgentTask = { type: "local_agent" } as unknown as TaskState;
const remoteAgentTask = { type: "remote_agent" } as unknown as TaskState;

describe("viewedTaskSelector", () => {
	describe("getViewedTask", () => {
		it("returns undefined when viewingAgentTaskId undefined", () => {
			expect(getViewedTask({ a: teammateTask }, undefined)).toBeUndefined();
		});
		it("looks up by id", () => {
			expect(getViewedTask({ a: teammateTask }, "a")).toBe(teammateTask);
		});
		it("returns undefined when id absent from record", () => {
			expect(getViewedTask({ a: teammateTask }, "missing")).toBeUndefined();
		});
	});

	describe("getViewedTeammateTask", () => {
		it("narrows teammate task", () => {
			expect(getViewedTeammateTask(teammateTask)).toBe(teammateTask);
		});
		it("returns undefined for non-teammate", () => {
			expect(getViewedTeammateTask(localAgentTask)).toBeUndefined();
			expect(getViewedTeammateTask(remoteAgentTask)).toBeUndefined();
		});
		it("returns undefined for undefined input", () => {
			expect(getViewedTeammateTask(undefined)).toBeUndefined();
		});
	});

	describe("getViewedAgentTask", () => {
		it("prefers teammate task when present", () => {
			expect(getViewedAgentTask(localAgentTask, teammateTask)).toBe(
				teammateTask,
			);
		});
		it("falls back to local_agent when no teammate", () => {
			expect(getViewedAgentTask(localAgentTask, undefined)).toBe(
				localAgentTask,
			);
		});
		it("returns undefined for non-agent viewedTask and no teammate", () => {
			expect(getViewedAgentTask(remoteAgentTask, undefined)).toBeUndefined();
		});
		it("returns undefined for undefined viewedTask and no teammate", () => {
			expect(getViewedAgentTask(undefined, undefined)).toBeUndefined();
		});
	});
});
