import { describe, expect, it, mock } from "bun:test";
import {
	applySetInputValue,
	type InputValueStateSetters,
} from "../../utils/inputValueState.js";

// audit 1.1.1: applySetInputValue 单元测试。行为等价 REPL.tsx:1558-1585 setInputValue
// useCallback 体。三动作:
//   (1) trySuggestBgPRIntercept(prev, value) 命中 → 提前 return (无后续副作用);
//   (2) 空输入→非空 且 距上次滚动 ≥ windowMs → repinScroll();
//   (3) 同步 inputValueRef.current + setInputValueRaw(value) + setIsPromptInputActive(非空)。
// lastUserScrollTsRef.current=0 → 首次按键 (无滚动记录) 总是满足 ≥ windowMs → repin。

function makeSetters(opts?: {
	prevInput?: string;
	lastScroll?: number;
	intercept?: (prev: string, next: string) => boolean;
	windowMs?: number;
}): {
	setters: InputValueStateSetters;
	trySuggestBgPRIntercept: ReturnType<typeof mock>;
	repinScroll: ReturnType<typeof mock>;
	setInputValueRaw: ReturnType<typeof mock>;
	setIsPromptInputActive: ReturnType<typeof mock>;
	inputValueRef: { current: string };
	lastUserScrollTsRef: { current: number };
	rawCalls: string[];
	activeCalls: boolean[];
} {
	const intercept = mock(opts?.intercept ?? (() => false));
	const repinScroll = mock(() => {});
	const rawCalls: string[] = [];
	const setInputValueRaw = mock((v: string) => {
		rawCalls.push(v);
	});
	const activeCalls: boolean[] = [];
	const setIsPromptInputActive = mock((a: boolean) => {
		activeCalls.push(a);
	});
	const inputValueRef = { current: opts?.prevInput ?? "" };
	const lastUserScrollTsRef = { current: opts?.lastScroll ?? 0 };
	return {
		setters: {
			trySuggestBgPRIntercept: intercept as never,
			repinScroll,
			setInputValueRaw: setInputValueRaw as never,
			setIsPromptInputActive: setIsPromptInputActive as never,
			inputValueRef,
			lastUserScrollTsRef,
			recentScrollRepinWindowMs: opts?.windowMs ?? 3000,
		},
		trySuggestBgPRIntercept: intercept,
		repinScroll,
		setInputValueRaw,
		setIsPromptInputActive,
		inputValueRef,
		lastUserScrollTsRef,
		rawCalls,
		activeCalls,
	};
}

describe("applySetInputValue", () => {
	it("empty→non-empty with no prior scroll (ts=0) repins + writes value + activates", () => {
		const { setters, repinScroll, inputValueRef, rawCalls, activeCalls } =
			makeSetters();
		applySetInputValue("hello", setters);
		expect(repinScroll).toHaveBeenCalledTimes(1);
		expect(inputValueRef.current).toBe("hello");
		expect(rawCalls).toEqual(["hello"]);
		expect(activeCalls).toEqual([true]);
	});

	it("intercept hit returns early: no repin, no ref write, no setters", () => {
		const { setters, repinScroll, inputValueRef, rawCalls, activeCalls } =
			makeSetters({
				intercept: () => true,
				prevInput: "old",
			});
		applySetInputValue("new", setters);
		expect(repinScroll).not.toHaveBeenCalled();
		expect(inputValueRef.current).toBe("old");
		expect(rawCalls).toHaveLength(0);
		expect(activeCalls).toHaveLength(0);
	});

	it("non-empty→non-empty does NOT repin (only empty→non-empty triggers)", () => {
		const { setters, repinScroll } = makeSetters({ prevInput: "abc" });
		applySetInputValue("abcd", setters);
		expect(repinScroll).not.toHaveBeenCalled();
	});

	it("scrolled within window: no repin (user actively reading)", () => {
		const now = Date.now();
		const { setters, repinScroll } = makeSetters({
			lastScroll: now,
			windowMs: 3000,
		});
		applySetInputValue("x", setters);
		// now - lastScroll = 0 < 3000 → no repin
		expect(repinScroll).not.toHaveBeenCalled();
	});

	it("scrolled exactly at window boundary: repins (>= window)", () => {
		const now = Date.now();
		const { setters, repinScroll } = makeSetters({
			lastScroll: now - 3000,
			windowMs: 3000,
		});
		applySetInputValue("x", setters);
		expect(repinScroll).toHaveBeenCalledTimes(1);
	});

	it("empty value: no repin (non-empty guard), deactivates, ref syncs", () => {
		const { setters, repinScroll, inputValueRef, rawCalls, activeCalls } =
			makeSetters({ prevInput: "abc" });
		applySetInputValue("", setters);
		expect(repinScroll).not.toHaveBeenCalled();
		expect(inputValueRef.current).toBe("");
		expect(rawCalls).toEqual([""]);
		expect(activeCalls).toEqual([false]);
	});

	it("whitespace-only value: active=false (trim().length > 0)", () => {
		const { setters, activeCalls } = makeSetters({ prevInput: "abc" });
		applySetInputValue("   ", setters);
		expect(activeCalls).toEqual([false]);
	});

	it("ref syncs BEFORE setters fire (callers read fresh value pre-commit)", () => {
		const seen: string[] = [];
		const setInputValueRaw = mock((v: string) => {
			seen.push(v);
		});
		const setters = {
			trySuggestBgPRIntercept: mock(() => false) as never,
			repinScroll: mock(() => {}) as never,
			setInputValueRaw: setInputValueRaw as never,
			setIsPromptInputActive: mock(() => {}) as never,
			inputValueRef: { current: "" },
			lastUserScrollTsRef: { current: 0 },
			recentScrollRepinWindowMs: 3000,
		} as InputValueStateSetters;
		applySetInputValue("fresh", setters);
		// setter fires with the new value; ref already updated by the time it runs
		expect(setters.inputValueRef.current).toBe("fresh");
		expect(seen).toEqual(["fresh"]);
	});
});
