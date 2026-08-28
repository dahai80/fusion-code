import { describe, expect, it } from "bun:test";
import {
	deriveIsShowingLocalJSXCommand,
	deriveIsWaitingForApproval,
	deriveTerminalApprovalState,
} from "../../utils/terminalApprovalState.js";
import type { ToolUseConfirm } from "../../components/permissions/PermissionRequest.js";

// audit 1.1.1: terminal/approval 状态推导单元测试。纯函数, 只读入参。
// fake 队列元素按最小 shape (只用到 .length 与 [0].tool.name)。

const confirm = (name: string) =>
	({ tool: { name } }) as unknown as ToolUseConfirm;
const emptyInput = {
	toolUseConfirmQueue: [],
	promptQueue: [],
	pendingWorkerRequest: null,
	pendingSandboxRequest: null,
	toolJSX: null,
	isLoading: false,
};

describe("deriveIsWaitingForApproval", () => {
	it("false when all queues empty + no pending", () => {
		expect(deriveIsWaitingForApproval(emptyInput)).toBe(false);
	});
	it("true when toolUseConfirmQueue non-empty", () => {
		expect(
			deriveIsWaitingForApproval({
				...emptyInput,
				toolUseConfirmQueue: [confirm("Bash")],
			}),
		).toBe(true);
	});
	it("true when promptQueue non-empty", () => {
		expect(
			deriveIsWaitingForApproval({
				...emptyInput,
				promptQueue: [{}],
			}),
		).toBe(true);
	});
	it("true when pendingWorkerRequest truthy", () => {
		expect(
			deriveIsWaitingForApproval({
				...emptyInput,
				pendingWorkerRequest: { host: "x" },
			}),
		).toBe(true);
	});
	it("true when pendingSandboxRequest truthy", () => {
		expect(
			deriveIsWaitingForApproval({
				...emptyInput,
				pendingSandboxRequest: { host: "y" },
			}),
		).toBe(true);
	});
});

describe("deriveIsShowingLocalJSXCommand", () => {
	it("false for null toolJSX", () => {
		expect(deriveIsShowingLocalJSXCommand(null)).toBe(false);
	});
	it("false when isLocalJSXCommand undefined", () => {
		expect(deriveIsShowingLocalJSXCommand({ jsx: "x" })).toBe(false);
	});
	it("false when isLocalJSXCommand true but jsx null (phantom overlay guard)", () => {
		expect(
			deriveIsShowingLocalJSXCommand({
				isLocalJSXCommand: true,
				jsx: null,
			}),
		).toBe(false);
	});
	it("true when isLocalJSXCommand true and jsx non-null", () => {
		expect(
			deriveIsShowingLocalJSXCommand({
				isLocalJSXCommand: true,
				jsx: "x",
			}),
		).toBe(true);
	});
});

describe("deriveTerminalApprovalState", () => {
	it("idle when nothing pending + not loading", () => {
		const s = deriveTerminalApprovalState(emptyInput);
		expect(s.sessionStatus).toBe("idle");
		expect(s.isWaitingForApproval).toBe(false);
		expect(s.isShowingLocalJSXCommand).toBe(false);
		expect(s.titleIsAnimating).toBe(false);
		expect(s.waitingFor).toBeUndefined();
	});
	it("busy when loading + nothing pending (title animates)", () => {
		const s = deriveTerminalApprovalState({ ...emptyInput, isLoading: true });
		expect(s.sessionStatus).toBe("busy");
		expect(s.titleIsAnimating).toBe(true);
		expect(s.waitingFor).toBeUndefined();
	});
	it("waiting when approval queued (title does not animate)", () => {
		const s = deriveTerminalApprovalState({
			...emptyInput,
			isLoading: true,
			toolUseConfirmQueue: [confirm("Bash")],
		});
		expect(s.sessionStatus).toBe("waiting");
		expect(s.isWaitingForApproval).toBe(true);
		expect(s.titleIsAnimating).toBe(false);
		expect(s.waitingFor).toBe("approve Bash");
	});
	it("waitingFor falls through worker then sandbox then dialog then input", () => {
		const worker = deriveTerminalApprovalState({
			...emptyInput,
			pendingWorkerRequest: { h: 1 },
		});
		expect(worker.waitingFor).toBe("worker request");
		const sandbox = deriveTerminalApprovalState({
			...emptyInput,
			pendingSandboxRequest: { h: 2 },
		});
		expect(sandbox.waitingFor).toBe("sandbox request");
		const dialog = deriveTerminalApprovalState({
			...emptyInput,
			toolJSX: { isLocalJSXCommand: true, jsx: "x" },
		});
		expect(dialog.waitingFor).toBe("dialog open");
		const inputNeeded = deriveTerminalApprovalState({
			...emptyInput,
			promptQueue: [{}],
		});
		expect(inputNeeded.waitingFor).toBe("input needed");
	});
	it("local JSX command suppresses title animation even when loading", () => {
		const s = deriveTerminalApprovalState({
			...emptyInput,
			isLoading: true,
			toolJSX: { isLocalJSXCommand: true, jsx: "x" },
		});
		expect(s.isShowingLocalJSXCommand).toBe(true);
		expect(s.titleIsAnimating).toBe(false);
		expect(s.sessionStatus).toBe("waiting");
	});
});
