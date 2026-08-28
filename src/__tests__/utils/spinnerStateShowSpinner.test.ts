import { describe, expect, it } from "bun:test";
import { deriveShowSpinner } from "../../utils/spinnerState.js";

// audit 1.1.1: deriveShowSpinner 单元测试。行为等价 REPL.tsx:2034-2053 内联块。
// 11 入参 → 1 bool。逐门控条件覆盖: toolJSX showSpinner / 队列清零 /
// busy 条件 (isLoading|userInputOnProcessing|hasRunningTeammates|queue) /
// pendingWorkerRequest 抑制 / onlySleepToolActive 抑制 / 流式文本抑制 + isBriefOnly 豁免。

const base = {
	toolJSX: null,
	toolUseConfirmQueueLength: 0,
	promptQueueLength: 0,
	isLoading: false,
	userInputOnProcessing: undefined,
	hasRunningTeammates: false,
	commandQueueLength: 0,
	pendingWorkerRequest: null,
	onlySleepToolActive: false,
	visibleStreamingText: null,
	isBriefOnly: false,
} as const;

describe("deriveShowSpinner", () => {
	it("hidden when nothing active (all idle)", () => {
		expect(deriveShowSpinner({ ...base })).toBe(false);
	});

	it("shown when isLoading", () => {
		expect(deriveShowSpinner({ ...base, isLoading: true })).toBe(true);
	});

	it("shown when userInputOnProcessing truthy (string, not bool)", () => {
		expect(deriveShowSpinner({ ...base, userInputOnProcessing: "x" })).toBe(
			true,
		);
	});

	it("shown when hasRunningTeammates", () => {
		expect(deriveShowSpinner({ ...base, hasRunningTeammates: true })).toBe(
			true,
		);
	});

	it("shown when commandQueueLength > 0", () => {
		expect(deriveShowSpinner({ ...base, commandQueueLength: 3 })).toBe(true);
	});

	it("hidden when commandQueueLength === 0 and nothing else active", () => {
		expect(deriveShowSpinner({ ...base, commandQueueLength: 0 })).toBe(false);
	});

	it("toolJSX showSpinner=false hides even if loading", () => {
		expect(
			deriveShowSpinner({
				...base,
				isLoading: true,
				toolJSX: { showSpinner: false },
			}),
		).toBe(false);
	});

	it("toolJSX showSpinner=true keeps visible while loading", () => {
		expect(
			deriveShowSpinner({
				...base,
				isLoading: true,
				toolJSX: { showSpinner: true },
			}),
		).toBe(true);
	});

	it("toolUseConfirmQueue non-empty hides (gate before busy)", () => {
		expect(
			deriveShowSpinner({ ...base, isLoading: true, toolUseConfirmQueueLength: 1 }),
		).toBe(false);
	});

	it("promptQueue non-empty hides (gate before busy)", () => {
		expect(
			deriveShowSpinner({ ...base, isLoading: true, promptQueueLength: 1 }),
		).toBe(false);
	});

	it("pendingWorkerRequest hides even while loading", () => {
		expect(
			deriveShowSpinner({
				...base,
				isLoading: true,
				pendingWorkerRequest: { toolName: "Bash" },
			}),
		).toBe(false);
	});

	it("onlySleepToolActive hides even while loading", () => {
		expect(
			deriveShowSpinner({
				...base,
				isLoading: true,
				onlySleepToolActive: true,
			}),
		).toBe(false);
	});

	it("visibleStreamingText hides while loading (text is feedback)", () => {
		expect(
			deriveShowSpinner({
				...base,
				isLoading: true,
				visibleStreamingText: "partial output",
			}),
		).toBe(false);
	});

	it("visibleStreamingText + isBriefOnly keeps visible (brief suppresses stream)", () => {
		expect(
			deriveShowSpinner({
				...base,
				isLoading: true,
				visibleStreamingText: "partial output",
				isBriefOnly: true,
			}),
		).toBe(true);
	});

	it("all suppressors together hide while loading", () => {
		expect(
			deriveShowSpinner({
				...base,
				isLoading: true,
				pendingWorkerRequest: { toolName: "Bash" },
				onlySleepToolActive: true,
				visibleStreamingText: "x",
			}),
		).toBe(false);
	});
});
