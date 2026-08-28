import { afterEach, describe, expect, it } from "bun:test";
import { getFocusedInputDialog } from "../../utils/focusedDialogSelector.js";

// audit 1.1.1: focusedInputDialog 优先级级联单元测试。行为等价 REPL.tsx:2450-2541 内联函数。
// 优先级: exit > message-selector > typing-suppress > sandbox-permission >
// (allowDialogsWithAnimation 门控) tool-permission > prompt > worker-sandbox > elicitation >
// cost > idle-return > ultraplan-choice > ultraplan-launch > ide-onboarding >
// model-switch(ant) > undercover(ant) > effort > remote > lsp-rec > plugin-hint > desktop-upsell。
// isInternalBuild() 读 USER_TYPE env (buildConstants.ts), 真值=ant build。每用例显式设/清。

const savedUserType = process.env.USER_TYPE;

afterEach(() => {
	if (savedUserType === undefined) delete process.env.USER_TYPE;
	else process.env.USER_TYPE = savedUserType;
});

const setAnt = (on: boolean) => {
	process.env.USER_TYPE = on ? "ant" : "external";
};

// 基线: 无对话框激活, 无 toolJSX。
const base = {
	isExiting: false,
	exitFlow: null,
	isMessageSelectorVisible: false,
	isPromptInputActive: false,
	sandboxPermissionRequestQueue: [],
	toolJSX: null,
	toolUseConfirmQueue: [],
	promptQueue: [],
	workerSandboxPermissionsQueue: [],
	elicitationQueue: [],
	showingCostDialog: false,
	idleReturnPending: null,
	isLoading: false,
	ultraplanPendingChoice: null,
	ultraplanLaunchPending: null,
	showIdeOnboarding: false,
	showModelSwitchCallout: false,
	showUndercoverCallout: false,
	showEffortCallout: false,
	showRemoteCallout: false,
	lspRecommendation: null,
	hintRecommendation: null,
	showDesktopUpsellStartup: false,
} as const;

describe("getFocusedInputDialog — exit/typing gates", () => {
	it("returns undefined when exiting", () => {
		expect(getFocusedInputDialog({ ...base, isExiting: true })).toBeUndefined();
	});

	it("returns undefined when exitFlow truthy (ReactNode)", () => {
		expect(
			getFocusedInputDialog({ ...base, exitFlow: "exiting" }),
		).toBeUndefined();
	});

	it("exit takes precedence over message-selector", () => {
		expect(
			getFocusedInputDialog({
				...base,
				isExiting: true,
				isMessageSelectorVisible: true,
			}),
		).toBeUndefined();
	});

	it("returns message-selector when visible (high priority, bypasses typing)", () => {
		expect(
			getFocusedInputDialog({
				...base,
				isMessageSelectorVisible: true,
				isPromptInputActive: true,
			}),
		).toBe("message-selector");
	});

	it("returns undefined when user actively typing", () => {
		expect(
			getFocusedInputDialog({
				...base,
				isPromptInputActive: true,
				toolUseConfirmQueue: [{}],
			}),
		).toBeUndefined();
	});
});

describe("getFocusedInputDialog — always-on dialogs (not blocked by toolJSX)", () => {
	it("returns sandbox-permission when queue non-empty", () => {
		expect(
			getFocusedInputDialog({
				...base,
				sandboxPermissionRequestQueue: [{}],
			}),
		).toBe("sandbox-permission");
	});

	it("sandbox-permission fires even when toolJSX blocks animation", () => {
		expect(
			getFocusedInputDialog({
				...base,
				sandboxPermissionRequestQueue: [{}],
				toolJSX: {},
			}),
		).toBe("sandbox-permission");
	});
});

describe("getFocusedInputDialog — animation-gated dialogs", () => {
	it("returns tool-permission when queue non-empty", () => {
		expect(getFocusedInputDialog({ ...base, toolUseConfirmQueue: [{}] })).toBe(
			"tool-permission",
		);
	});

	it("returns prompt when queue non-empty", () => {
		expect(getFocusedInputDialog({ ...base, promptQueue: [{}] })).toBe(
			"prompt",
		);
	});

	it("returns worker-sandbox-permission when queue non-empty", () => {
		expect(
			getFocusedInputDialog({
				...base,
				workerSandboxPermissionsQueue: [{}],
			}),
		).toBe("worker-sandbox-permission");
	});

	it("returns elicitation when queue non-empty", () => {
		expect(getFocusedInputDialog({ ...base, elicitationQueue: [{}] })).toBe(
			"elicitation",
		);
	});

	it("returns cost when showing", () => {
		expect(getFocusedInputDialog({ ...base, showingCostDialog: true })).toBe(
			"cost",
		);
	});

	it("returns idle-return when pending", () => {
		expect(
			getFocusedInputDialog({ ...base, idleReturnPending: { input: "x" } }),
		).toBe("idle-return");
	});

	it("returns ide-onboarding when showing", () => {
		expect(getFocusedInputDialog({ ...base, showIdeOnboarding: true })).toBe(
			"ide-onboarding",
		);
	});

	it("returns effort-callout when showing", () => {
		expect(getFocusedInputDialog({ ...base, showEffortCallout: true })).toBe(
			"effort-callout",
		);
	});

	it("returns remote-callout when showing", () => {
		expect(getFocusedInputDialog({ ...base, showRemoteCallout: true })).toBe(
			"remote-callout",
		);
	});

	it("returns lsp-recommendation when present", () => {
		expect(
			getFocusedInputDialog({
				...base,
				lspRecommendation: { pluginId: "x" },
			}),
		).toBe("lsp-recommendation");
	});

	it("returns plugin-hint when present", () => {
		expect(
			getFocusedInputDialog({ ...base, hintRecommendation: { pluginId: "x" } }),
		).toBe("plugin-hint");
	});

	it("returns desktop-upsell when showing", () => {
		expect(
			getFocusedInputDialog({ ...base, showDesktopUpsellStartup: true }),
		).toBe("desktop-upsell");
	});
});

// NOTE: ultraplan-choice / ultraplan-launch arms 包裹在 feature("ULTRAPLAN") 编译期宏内。
// 测试构建 (bun test) 中 ULTRAPLAN 默认 OFF → DCE 死代码, 不可达 (同 REPL 非 full build)。
// 无法对编译期死分支写单测 (Rule 9: 为错误原因通过的测试比无测试更糟)。跳过 ultraplan 断言,
// 优先级排序测试也不含 ultraplan (见下方 idle-return beats ultraplan — 该断言在 feature off
// 时 ultraplan 本就 undefined, idle-return 仍 win, 行为正确且不依赖 feature 状态)。

describe("getFocusedInputDialog — ant-only branches (isInternalBuild)", () => {
	it("returns model-switch when ant + showing", () => {
		setAnt(true);
		expect(
			getFocusedInputDialog({ ...base, showModelSwitchCallout: true }),
		).toBe("model-switch");
	});

	it("returns undercover-callout when ant + showing", () => {
		setAnt(true);
		expect(
			getFocusedInputDialog({ ...base, showUndercoverCallout: true }),
		).toBe("undercover-callout");
	});

	it("model-switch suppressed in external build", () => {
		setAnt(false);
		expect(
			getFocusedInputDialog({ ...base, showModelSwitchCallout: true }),
		).toBeUndefined();
	});

	it("undercover-callout suppressed in external build", () => {
		setAnt(false);
		expect(
			getFocusedInputDialog({ ...base, showUndercoverCallout: true }),
		).toBeUndefined();
	});
});

describe("getFocusedInputDialog — toolJSX animation gate", () => {
	it("toolJSX null allows animation dialogs", () => {
		expect(
			getFocusedInputDialog({
				...base,
				toolJSX: null,
				toolUseConfirmQueue: [{}],
			}),
		).toBe("tool-permission");
	});

	it("toolJSX with shouldContinueAnimation allows dialogs", () => {
		expect(
			getFocusedInputDialog({
				...base,
				toolJSX: { shouldContinueAnimation: true },
				toolUseConfirmQueue: [{}],
			}),
		).toBe("tool-permission");
	});

	it("toolJSX without shouldContinueAnimation blocks animation-gated dialogs", () => {
		expect(
			getFocusedInputDialog({
				...base,
				toolJSX: {},
				toolUseConfirmQueue: [{}],
			}),
		).toBeUndefined();
	});

	it("toolJSX animation gate does NOT affect sandbox-permission", () => {
		expect(
			getFocusedInputDialog({
				...base,
				toolJSX: {},
				sandboxPermissionRequestQueue: [{}],
			}),
		).toBe("sandbox-permission");
	});

	it("toolJSX animation gate does NOT affect message-selector", () => {
		expect(
			getFocusedInputDialog({
				...base,
				toolJSX: {},
				isMessageSelectorVisible: true,
			}),
		).toBe("message-selector");
	});
});

describe("getFocusedInputDialog — priority ordering", () => {
	it("message-selector beats sandbox-permission", () => {
		expect(
			getFocusedInputDialog({
				...base,
				isMessageSelectorVisible: true,
				sandboxPermissionRequestQueue: [{}],
			}),
		).toBe("message-selector");
	});

	it("tool-permission beats prompt (higher queue priority)", () => {
		expect(
			getFocusedInputDialog({
				...base,
				toolUseConfirmQueue: [{}],
				promptQueue: [{}],
			}),
		).toBe("tool-permission");
	});

	it("ultraplan-choice beats ultraplan-launch", () => {
		// feature("ULTRAPLAN") 编译期 OFF → 两 arm 不可达, 均返回 undefined (见文件 NOTE)。
		// 行为等价 REPL 非 full build: ultraplan 对话框从不显示。断言 feature-off 语义。
		expect(
			getFocusedInputDialog({
				...base,
				ultraplanPendingChoice: { x: 1 },
				ultraplanLaunchPending: { x: 1 },
			}),
		).toBeUndefined();
	});

	it("lsp-recommendation beats plugin-hint", () => {
		expect(
			getFocusedInputDialog({
				...base,
				lspRecommendation: { x: 1 },
				hintRecommendation: { x: 1 },
			}),
		).toBe("lsp-recommendation");
	});

	it("plugin-hint beats desktop-upsell (lowest band)", () => {
		expect(
			getFocusedInputDialog({
				...base,
				hintRecommendation: { x: 1 },
				showDesktopUpsellStartup: true,
			}),
		).toBe("plugin-hint");
	});

	it("idle-return beats ultraplan-choice", () => {
		expect(
			getFocusedInputDialog({
				...base,
				idleReturnPending: { input: "x" },
				ultraplanPendingChoice: { x: 1 },
			}),
		).toBe("idle-return");
	});

	it("returns undefined when nothing active", () => {
		expect(getFocusedInputDialog({ ...base })).toBeUndefined();
	});

	it("empty queue arrays ([0] undefined) do not fire", () => {
		expect(
			getFocusedInputDialog({
				...base,
				toolUseConfirmQueue: [],
				promptQueue: [],
				workerSandboxPermissionsQueue: [],
				elicitationQueue: [],
			}),
		).toBeUndefined();
	});
});
