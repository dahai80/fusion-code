// insight-0902 E3 tests: lastCompactionSnapshot side-channel + /diff-compaction render.

import { beforeEach, describe, expect, it } from "bun:test";
import { call as diffCompactionCall } from "../../commands/diff-compaction/diffCompaction.js";
import {
	type CompactionSnapshot,
	clearCompactionSnapshot,
	getLastCompactionSnapshot,
	recordCompactionSnapshot,
} from "../../services/compact/index.js";

function makeSnapshot(
	over: Partial<CompactionSnapshot> = {},
): CompactionSnapshot {
	return {
		timestamp: 1234567890,
		provider: "shadow-price",
		candidates: [
			{
				roundIndex: 0,
				messageIndex: 0,
				toolUseId: "tool_abc1234567890",
				shadowPrice: 3.5,
				sizeTokens: 4200,
			},
			{
				roundIndex: 1,
				messageIndex: 1,
				toolUseId: "tool_def4567890123",
				shadowPrice: 1.2,
				sizeTokens: 800,
			},
		],
		priceThreshold: 2.0,
		truncatedToolResults: 1,
		truncatedAssistantTexts: 0,
		roundsKeptIntact: 3,
		roundsProcessed: 2,
		preCompactTokens: 12000,
		postCompactTokens: 7800,
		prunedCandidateCount: 1,
		...over,
	};
}

describe("lastCompactionSnapshot", () => {
	beforeEach(() => clearCompactionSnapshot());

	it("returns undefined before any record", () => {
		expect(getLastCompactionSnapshot()).toBeUndefined();
	});

	it("records and returns the latest snapshot", () => {
		const snap = makeSnapshot();
		recordCompactionSnapshot(snap);
		expect(getLastCompactionSnapshot()).toEqual(snap);
	});

	it("overwrites with the latest on repeated records", () => {
		recordCompactionSnapshot(makeSnapshot({ preCompactTokens: 100 }));
		recordCompactionSnapshot(makeSnapshot({ preCompactTokens: 200 }));
		expect(getLastCompactionSnapshot()?.preCompactTokens).toBe(200);
	});

	it("clear() empties the store", () => {
		recordCompactionSnapshot(makeSnapshot());
		clearCompactionSnapshot();
		expect(getLastCompactionSnapshot()).toBeUndefined();
	});
});

describe("/diff-compaction render", () => {
	beforeEach(() => clearCompactionSnapshot());

	it("returns no-snapshot message when store empty", async () => {
		const res = await diffCompactionCall("", {} as never);
		expect(res.type).toBe("text");
		if (res.type === "text") {
			expect(res.value).toContain("No compaction snapshot");
		}
	});

	it("renders summary block + candidate table for shadow-price", async () => {
		recordCompactionSnapshot(makeSnapshot());
		const res = await diffCompactionCall("", {} as never);
		expect(res.type).toBe("text");
		if (res.type === "text") {
			const v = res.value;
			expect(v).toContain("provider: shadow-price");
			expect(v).toContain("threshold: 2.00");
			expect(v).toContain("12000 → 7800");
			expect(v).toContain("tool_abc12345678");
			expect(v).toContain("✂️");
			expect(v).toContain("total candidates: 2, pruned: 1");
		}
	});

	it("marks only ≥threshold candidates as pruned", async () => {
		recordCompactionSnapshot(makeSnapshot());
		const res = await diffCompactionCall("", {} as never);
		if (res.type !== "text") throw new Error("expected text");
		const rows = res.value.split("\n").filter((l) => l.includes("price="));
		expect(rows.length).toBe(2);
		// high-price (3.5) row pruned, low-price (1.2) not
		expect(rows[0]).toContain("✂️");
		expect(rows[1]).not.toContain("✂️");
	});

	it("notes no-candidates path for hard-tail provider", async () => {
		recordCompactionSnapshot(
			makeSnapshot({
				provider: "hard-tail",
				candidates: [],
				priceThreshold: undefined,
			}),
		);
		const res = await diffCompactionCall("", {} as never);
		if (res.type !== "text") throw new Error("expected text");
		expect(res.value).toContain("no shadow-price candidates");
	});
});
