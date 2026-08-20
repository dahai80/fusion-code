import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	checkWebSearchGuardrail,
	DEFAULT_MAX_WEB_SEARCHES_PER_SESSION,
	getMaxWebSearchesPerSession,
} from "../../src/tools/WebSearchTool/webSearchGuardrail.js";

// WebSearch per-session guardrail tests (CC 2.1.217 item 13 alignment).
// Covers env parsing (fail-open), gate pass/reject, boundary at the limit.

const ENV_KEY = "FUSION_MAX_WEB_SEARCHES_PER_SESSION" as const;

describe("webSearchGuardrail", () => {
	beforeEach(() => {
		delete process.env[ENV_KEY];
	});
	afterEach(() => {
		delete process.env[ENV_KEY];
	});

	describe("env default + parsing", () => {
		it("returns default cap when env unset", () => {
			expect(getMaxWebSearchesPerSession()).toBe(
				DEFAULT_MAX_WEB_SEARCHES_PER_SESSION,
			);
		});

		it("honors env override", () => {
			process.env[ENV_KEY] = "50";
			expect(getMaxWebSearchesPerSession()).toBe(50);
		});

		it("falls back to default on non-numeric env (fail open)", () => {
			process.env[ENV_KEY] = "nope";
			expect(getMaxWebSearchesPerSession()).toBe(
				DEFAULT_MAX_WEB_SEARCHES_PER_SESSION,
			);
		});

		it("falls back to default on empty env string", () => {
			process.env[ENV_KEY] = "";
			expect(getMaxWebSearchesPerSession()).toBe(
				DEFAULT_MAX_WEB_SEARCHES_PER_SESSION,
			);
		});

		it("falls back to default on 0 (fail open, not silent block-all)", () => {
			process.env[ENV_KEY] = "0";
			expect(getMaxWebSearchesPerSession()).toBe(
				DEFAULT_MAX_WEB_SEARCHES_PER_SESSION,
			);
		});

		it("falls back to default on negative value", () => {
			process.env[ENV_KEY] = "-3";
			expect(getMaxWebSearchesPerSession()).toBe(
				DEFAULT_MAX_WEB_SEARCHES_PER_SESSION,
			);
		});

		it("truncates decimal to integer (parseInt)", () => {
			process.env[ENV_KEY] = "5.9";
			expect(getMaxWebSearchesPerSession()).toBe(5);
		});
	});

	describe("checkWebSearchGuardrail", () => {
		it("passes (null) when count below default limit", () => {
			expect(
				checkWebSearchGuardrail({
					sessionSearchCount: DEFAULT_MAX_WEB_SEARCHES_PER_SESSION - 1,
				}),
			).toBeNull();
		});

		it("passes (null) when count is 0", () => {
			expect(checkWebSearchGuardrail({ sessionSearchCount: 0 })).toBeNull();
		});

		it("rejects when count reaches the default limit", () => {
			const result = checkWebSearchGuardrail({
				sessionSearchCount: DEFAULT_MAX_WEB_SEARCHES_PER_SESSION,
			});
			expect(result).not.toBeNull();
			expect(result).toContain("Web search rejected");
			expect(result).toContain("FUSION_MAX_WEB_SEARCHES_PER_SESSION");
		});

		it("rejects when count exceeds the default limit", () => {
			const result = checkWebSearchGuardrail({
				sessionSearchCount: DEFAULT_MAX_WEB_SEARCHES_PER_SESSION + 100,
			});
			expect(result).not.toBeNull();
			expect(result).toContain("Web search rejected");
		});

		it("respects a lowered env limit at runtime", () => {
			process.env[ENV_KEY] = "3";
			// 2 is below 3 → passes
			expect(checkWebSearchGuardrail({ sessionSearchCount: 2 })).toBeNull();
			// 3 reaches 3 → rejected
			const result = checkWebSearchGuardrail({ sessionSearchCount: 3 });
			expect(result).not.toBeNull();
			expect(result).toContain("limit of 3");
		});

		it("rejection message includes the current count + limit", () => {
			process.env[ENV_KEY] = "10";
			const result = checkWebSearchGuardrail({ sessionSearchCount: 10 });
			expect(result).toContain("10");
			expect(result).toContain("10");
		});
	});
});
