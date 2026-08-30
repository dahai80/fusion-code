import { afterEach, describe, expect, it } from "bun:test";
import { startCompactStallTimer } from "../services/compact/index.js";
import type { CompactProgressEvent } from "../Tool.js";

// item 16 (CC 2.1.228): compact retry/stall 可见性测试。
// startCompactStallTimer 接受 injectable intervalMs (default 10s) — 测试传短 interval
// 避免真等 10s。compact_retry emit = compactConversation 内联, 复用已算判定 —
// 由 typecheck (union 窄化) + 手工验证覆盖, 不造假 mock (Rule 9)。

type StallEvent = Extract<CompactProgressEvent, { type: "compact_stall" }>;

const SHORT = 5; // 测试用短 interval ms

function makeCtx(events: StallEvent[]) {
	return {
		onCompactProgress: (e: CompactProgressEvent) => {
			if (e.type === "compact_stall") events.push(e);
		},
	} as never;
}

describe("item 16: startCompactStallTimer", () => {
	afterEach(() => {
		const g = globalThis as { __realDateNow?: () => number };
		if (g.__realDateNow) {
			Date.now = g.__realDateNow;
			delete g.__realDateNow;
		}
	});

	it("emit compact_stall every interval with increasing elapsedMs", async () => {
		let now = 1000;
		const g = globalThis as { __realDateNow?: () => number };
		g.__realDateNow = Date.now;
		Date.now = () => now;

		const events: StallEvent[] = [];
		const clear = startCompactStallTimer(makeCtx(events), now, SHORT);

		// 真 timer SHORT ms。等够 3 个 interval, 每次 advance Date.now 模拟墙钟。
		for (let i = 1; i <= 3; i++) {
			now += SHORT;
			await new Promise((r) => setTimeout(r, SHORT + 2));
		}

		expect(events.length).toBeGreaterThanOrEqual(3);
		for (const e of events) {
			expect(e.type).toBe("compact_stall");
			expect(e.elapsedMs).toBeGreaterThan(0);
		}
		expect(events[events.length - 1].elapsedMs).toBeGreaterThan(
			events[0].elapsedMs,
		);

		clear();
	});

	it("clear() stops emitting (防泄漏)", async () => {
		const events: StallEvent[] = [];
		const clear = startCompactStallTimer(makeCtx(events), Date.now(), SHORT);
		clear();

		await new Promise((r) => setTimeout(r, SHORT * 4));
		expect(events.length).toBe(0);
	});

	it("no onCompactProgress callback → no-op clear fn (不报错)", () => {
		const context = {} as never;
		const clear = startCompactStallTimer(context, Date.now(), SHORT);
		expect(() => clear()).not.toThrow();
	});

	it("interval boundary: first emit at ~interval not earlier", async () => {
		let now = 5000;
		const g = globalThis as { __realDateNow?: () => number };
		g.__realDateNow = Date.now;
		Date.now = () => now;

		const events: StallEvent[] = [];
		const clear = startCompactStallTimer(makeCtx(events), now, SHORT);

		// 等半 interval — 不应 emit
		await new Promise((r) => setTimeout(r, Math.floor(SHORT / 2)));
		expect(events.length).toBe(0);

		// 再等到超 1 interval — 应 emit
		now += SHORT;
		await new Promise((r) => setTimeout(r, SHORT + 2));
		expect(events.length).toBeGreaterThanOrEqual(1);
		expect(events[0].elapsedMs).toBeGreaterThan(0);

		clear();
	});
});
