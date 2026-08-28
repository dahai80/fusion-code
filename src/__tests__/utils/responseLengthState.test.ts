import { describe, expect, it, mock } from "bun:test";
import {
	applySetResponseLength,
	type ResponseLengthStateSetters,
} from "../../utils/responseLengthState.js";

// audit 1.1.1: applySetResponseLength 单元测试。行为等价 REPL.tsx:1681-1696
// setResponseLength useCallback 体。三动作:
//   (1) responseLengthRef.current = f(prev) (始终);
//   (2) 仅当新值 > prev 时刷 metrics 末条;
//   (3) 末条 lastTokenTime = now + endResponseLength = 新累积值。
// 空 metrics 数组 = 安全跳过 (length 守卫)。

function makeSetters(opts?: {
	prevLen?: number;
	entries?: Array<{
		lastTokenTime: number;
		endResponseLength: number;
	}>;
}): {
	setters: ResponseLengthStateSetters;
	responseLengthRef: { current: number };
	apiMetricsRef: {
		current: Array<{ lastTokenTime: number; endResponseLength: number }>;
	};
} {
	const responseLengthRef = { current: opts?.prevLen ?? 0 };
	const apiMetricsRef = {
		current: opts?.entries ?? [],
	};
	return {
		setters: { responseLengthRef, apiMetricsRef },
		responseLengthRef,
		apiMetricsRef,
	};
}

describe("applySetResponseLength", () => {
	it("applies f(prev) to ref regardless of metrics", () => {
		const { setters, responseLengthRef } = makeSetters({ prevLen: 10 });
		applySetResponseLength((prev) => prev + 5, setters);
		expect(responseLengthRef.current).toBe(15);
	});

	it("growth (> prev) updates last metrics entry: lastTokenTime + endResponseLength", () => {
		const fixedNow = 1_000_000;
		const dateNow = mock(() => fixedNow);
		const realDateNow = Date.now;
		globalThis.Date.now = dateNow as never;
		try {
			const { setters, responseLengthRef, apiMetricsRef } = makeSetters({
				prevLen: 50,
				entries: [{ lastTokenTime: 0, endResponseLength: 50 }],
			});
			applySetResponseLength((prev) => prev + 20, setters);
			expect(responseLengthRef.current).toBe(70);
			expect(apiMetricsRef.current[0].endResponseLength).toBe(70);
			expect(apiMetricsRef.current[0].lastTokenTime).toBe(fixedNow);
			expect(dateNow).toHaveBeenCalledTimes(1);
		} finally {
			globalThis.Date.now = realDateNow;
		}
	});

	it("flat (new === prev) does NOT touch metrics", () => {
		const { setters, apiMetricsRef } = makeSetters({
			prevLen: 30,
			entries: [{ lastTokenTime: 123, endResponseLength: 30 }],
		});
		applySetResponseLength((prev) => prev, setters);
		expect(apiMetricsRef.current[0].lastTokenTime).toBe(123);
		expect(apiMetricsRef.current[0].endResponseLength).toBe(30);
	});

	it("shrink (new < prev) does NOT touch metrics (only growth fires)", () => {
		const { setters, apiMetricsRef } = makeSetters({
			prevLen: 40,
			entries: [{ lastTokenTime: 999, endResponseLength: 40 }],
		});
		applySetResponseLength((prev) => prev - 10, setters);
		expect(apiMetricsRef.current[0].lastTokenTime).toBe(999);
		expect(apiMetricsRef.current[0].endResponseLength).toBe(40);
	});

	it("growth but empty metrics array: safe no-op (length guard)", () => {
		const { setters, responseLengthRef, apiMetricsRef } = makeSetters({
			prevLen: 5,
			entries: [],
		});
		applySetResponseLength((prev) => prev + 1, setters);
		expect(responseLengthRef.current).toBe(6);
		expect(apiMetricsRef.current).toHaveLength(0);
	});

	it("updates only the LAST entry when multiple exist", () => {
		const fixedNow = 2_000_000;
		const dateNow = mock(() => fixedNow);
		const realDateNow = Date.now;
		globalThis.Date.now = dateNow as never;
		try {
			const entries = [
				{ lastTokenTime: 1, endResponseLength: 10 },
				{ lastTokenTime: 2, endResponseLength: 20 },
				{ lastTokenTime: 3, endResponseLength: 30 },
			];
			const { setters, apiMetricsRef } = makeSetters({
				prevLen: 30,
				entries,
			});
			applySetResponseLength((prev) => prev + 5, setters);
			expect(apiMetricsRef.current[0].lastTokenTime).toBe(1);
			expect(apiMetricsRef.current[1].lastTokenTime).toBe(2);
			expect(apiMetricsRef.current[2].lastTokenTime).toBe(fixedNow);
			expect(apiMetricsRef.current[2].endResponseLength).toBe(35);
		} finally {
			globalThis.Date.now = realDateNow;
		}
	});
});
