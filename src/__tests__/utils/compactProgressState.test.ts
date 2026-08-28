import { describe, expect, it } from "bun:test";
import type { CompactProgressEvent } from "../../Tool.js";
import {
	applyOnCompactProgress,
	type CompactProgressSetters,
} from "../../utils/compactProgressState.js";

// audit 1.1.1: applyOnCompactProgress 单元测试。行为等价 REPL.tsx:2848-2884
// getToolUseContext.onCompactProgress switch。5 event type 各自路由 spinner setter。

type RecordedSetters = {
	colors: (keyof import("src/utils/theme.js").Theme | null)[];
	shimmers: (keyof import("src/utils/theme.js").Theme | null)[];
	messages: (string | null)[];
};

function makeSetters(stallHintMs = 30_000): {
	setters: CompactProgressSetters;
	rec: RecordedSetters;
} {
	const rec: RecordedSetters = { colors: [], shimmers: [], messages: [] };
	const setters: CompactProgressSetters = {
		compactStallHintMs: stallHintMs,
		setSpinnerColor: (v) => rec.colors.push(v),
		setSpinnerShimmerColor: (v) => rec.shimmers.push(v),
		setSpinnerMessage: (v) => rec.messages.push(v),
	};
	return { setters, rec };
}

describe("applyOnCompactProgress", () => {
	it("hooks_start pre_compact: blue spinner + PreCompact text", () => {
		const { setters, rec } = makeSetters();
		applyOnCompactProgress(
			{ type: "hooks_start", hookType: "pre_compact" },
			setters,
		);
		expect(rec.colors).toEqual(["claudeBlue_FOR_SYSTEM_SPINNER"]);
		expect(rec.shimmers).toEqual(["claudeBlueShimmer_FOR_SYSTEM_SPINNER"]);
		expect(rec.messages).toEqual(["Running PreCompact hooks…"]);
	});

	it("hooks_start post_compact: PostCompact text", () => {
		const { setters, rec } = makeSetters();
		applyOnCompactProgress(
			{ type: "hooks_start", hookType: "post_compact" },
			setters,
		);
		expect(rec.messages).toEqual(["Running PostCompact hooks…"]);
		expect(rec.colors).toEqual(["claudeBlue_FOR_SYSTEM_SPINNER"]);
	});

	it("hooks_start session_start: SessionStart text", () => {
		const { setters, rec } = makeSetters();
		applyOnCompactProgress(
			{ type: "hooks_start", hookType: "session_start" },
			setters,
		);
		expect(rec.messages).toEqual(["Running SessionStart hooks…"]);
	});

	it("compact_start: Compacting conversation text, no color change", () => {
		const { setters, rec } = makeSetters();
		applyOnCompactProgress({ type: "compact_start" }, setters);
		expect(rec.messages).toEqual(["Compacting conversation"]);
		expect(rec.colors).toEqual([]);
		expect(rec.shimmers).toEqual([]);
	});

	it("compact_retry: retry N/M: <reason> text", () => {
		const { setters, rec } = makeSetters();
		const evt: CompactProgressEvent = {
			type: "compact_retry",
			attempt: 2,
			maxRetries: 5,
			reason: "mlx_memory",
		};
		applyOnCompactProgress(evt, setters);
		expect(rec.messages).toEqual(["Compacting (retry 2/5: mlx_memory)"]);
	});

	it("compact_stall below hint: no spinner update", () => {
		const { setters, rec } = makeSetters(30_000);
		applyOnCompactProgress(
			{ type: "compact_stall", elapsedMs: 29_000 },
			setters,
		);
		expect(rec.messages).toEqual([]);
	});

	it("compact_stall at/above hint: duration text", () => {
		const { setters, rec } = makeSetters(30_000);
		applyOnCompactProgress(
			{ type: "compact_stall", elapsedMs: 30_000 },
			setters,
		);
		expect(rec.messages).toHaveLength(1);
		expect(rec.messages[0]).toContain("Compacting conversation — running");
		expect(rec.messages[0]).toContain(
			"large context summaries can take a while",
		);
	});

	it("compact_stall uses configured hint threshold, not hardcoded 30s", () => {
		const { setters, rec } = makeSetters(10_000);
		applyOnCompactProgress(
			{ type: "compact_stall", elapsedMs: 15_000 },
			setters,
		);
		expect(rec.messages).toHaveLength(1);
		const { setters: setters2, rec: rec2 } = makeSetters(10_000);
		applyOnCompactProgress(
			{ type: "compact_stall", elapsedMs: 9_000 },
			setters2,
		);
		expect(rec2.messages).toEqual([]);
	});

	it("compact_end: clears all 3 spinner states to null", () => {
		const { setters, rec } = makeSetters();
		applyOnCompactProgress({ type: "compact_end" }, setters);
		expect(rec.messages).toEqual([null]);
		expect(rec.colors).toEqual([null]);
		expect(rec.shimmers).toEqual([null]);
	});
});
