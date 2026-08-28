import { describe, expect, it, mock } from "bun:test";
import type { AppState } from "../../state/AppStateStore.js";
import { applyNestedStateUpdater } from "../../utils/nestedStateUpdater.js";

// audit 1.1.1: applyNestedStateUpdater 单元测试。行为等价 REPL.tsx getToolUseContext
// updateFileHistoryState / updateAttributionState 两方法体。同-ref 跳过 = perf 优化
// (updater 返回同 ref → setAppState 收 prev 不触发 listener)。泛型 K = "fileHistory"|"attribution"。

type SliceUpdater<K extends "fileHistory" | "attribution"> = (
	prev: AppState[K],
) => AppState[K];

function makeSetAppState<K extends "fileHistory" | "attribution">(
	key: K,
	initialSlice: AppState[K],
): {
	setAppState: (updater: (prev: AppState) => AppState) => void;
	calls: AppState[];
	replace: (slice: AppState[K]) => void;
} {
	let slice = initialSlice;
	const calls: AppState[] = [];
	const setAppState = (updater: (prev: AppState) => AppState) => {
		const fakePrev = { [key]: slice } as unknown as AppState;
		const next = updater(fakePrev);
		calls.push(next);
		if (next !== fakePrev) {
			slice = next[key];
		}
	};
	const replace = (newSlice: AppState[K]) => {
		slice = newSlice;
	};
	return { setAppState, calls, replace };
}

describe("applyNestedStateUpdater", () => {
	it("fileHistory: updater returns NEW ref → setAppState receives spread w/ updated slice", () => {
		const base = { trackedFiles: {} } as unknown as AppState["fileHistory"];
		const { setAppState, calls } = makeSetAppState("fileHistory", base);
		const next: AppState["fileHistory"] = {
			trackedFiles: { "/x": true },
		} as unknown as AppState["fileHistory"];
		applyNestedStateUpdater(setAppState, "fileHistory", () => next);
		expect(calls).toHaveLength(1);
		expect(calls[0]).not.toBe(base);
		expect(
			(calls[0] as unknown as { fileHistory: AppState["fileHistory"] })
				.fileHistory,
		).toBe(next);
	});

	it("fileHistory: updater returns SAME ref → setAppState receives prev unchanged (same-ref skip)", () => {
		const base = { trackedFiles: {} } as unknown as AppState["fileHistory"];
		const { setAppState, calls } = makeSetAppState("fileHistory", base);
		const updater: SliceUpdater<"fileHistory"> = (prev) => prev;
		applyNestedStateUpdater(setAppState, "fileHistory", updater);
		expect(calls).toHaveLength(1);
		// 关键: updater 返回 prev 同 ref → setAppState 收到的就是 prev 本身 (无 spread, 无通知)
		const returnedSlice = (
			calls[0] as unknown as { fileHistory: AppState["fileHistory"] }
		).fileHistory;
		expect(returnedSlice).toBe(base);
		// 验证返回值 === 传入的 fakePrev (同-ref 跳过路径): setAppState 回调返回 prev
		// makeSetAppState 里 fakePrev = { [key]: slice }, updater 返回 prev → next = fakePrev
		expect(calls[0]).toEqual({ fileHistory: base } as unknown as AppState);
	});

	it("attribution: updater returns NEW ref → setAppState receives updated slice", () => {
		const base = { commits: [] } as unknown as AppState["attribution"];
		const { setAppState, calls } = makeSetAppState("attribution", base);
		const next: AppState["attribution"] = {
			commits: [{ id: "c1" }],
		} as unknown as AppState["attribution"];
		applyNestedStateUpdater(setAppState, "attribution", () => next);
		expect(calls).toHaveLength(1);
		const returnedSlice = (
			calls[0] as unknown as { attribution: AppState["attribution"] }
		).attribution;
		expect(returnedSlice).toBe(next);
	});

	it("attribution: updater returns SAME ref → same-ref skip (prev unchanged)", () => {
		const base = { commits: [] } as unknown as AppState["attribution"];
		const { setAppState, calls } = makeSetAppState("attribution", base);
		applyNestedStateUpdater(setAppState, "attribution", (prev) => prev);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toEqual({ attribution: base } as unknown as AppState);
	});

	it("updater receives the CURRENT slice value as prev (not stale)", () => {
		const base = {
			trackedFiles: { "/a": true },
		} as unknown as AppState["fileHistory"];
		const { setAppState, replace } = makeSetAppState("fileHistory", base);
		const seen: AppState["fileHistory"][] = [];
		// 第一次: 返回新 ref, makeSetAppState 更新 slice
		const updated1 = {
			trackedFiles: { "/a": true, "/b": true },
		} as unknown as AppState["fileHistory"];
		applyNestedStateUpdater(setAppState, "fileHistory", (prev) => {
			seen.push(prev);
			return updated1;
		});
		// 第二次: makeSetAppState 已 replace slice = updated1, updater 应见 updated1
		const updated2 = { trackedFiles: {} } as unknown as AppState["fileHistory"];
		applyNestedStateUpdater(setAppState, "fileHistory", (prev) => {
			seen.push(prev);
			return updated2;
		});
		expect(seen[0]).toBe(base);
		expect(seen[1]).toBe(updated1);
		replace(updated2);
	});

	it("setAppState called exactly once per invocation", () => {
		const setMock = mock((_updater: (prev: AppState) => AppState) => {});
		applyNestedStateUpdater(setMock, "attribution", (prev) => prev);
		expect(setMock).toHaveBeenCalledTimes(1);
	});
});
