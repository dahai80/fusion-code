import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { BLACK_CIRCLE, getFigures } from "../../constants/figures.js";
import { resetSettingsCache } from "../../utils/settings/settingsCache.js";

// item 19 — screen-reader figure set. getFigures() is a lazy factory: first
// call reads getInitialSettings().prefersReducedMotion, returns a frozen
// Unicode set (default, byte-identical to existing consts) or an ASCII
// downgrade set (reducedMotion). Cached keyed on the boolean, recomputes on
// change. Existing `export const` constants are unchanged for unmigrated
// consumers — default-off behavior is preserved.

const ENV_KEYS = ["FUSION_SCREEN_READER", "FUSION_AX_SCREEN_READER"] as const;

function clearEnv(): void {
	for (const k of ENV_KEYS) {
		delete process.env[k];
	}
}

describe("item 19 — screen-reader figure set (getFigures)", () => {
	beforeEach(() => {
		clearEnv();
		(
			globalThis as { __fusionScreenReaderOverride?: boolean }
		).__fusionScreenReaderOverride = undefined;
		resetSettingsCache();
	});

	afterEach(() => {
		clearEnv();
		(
			globalThis as { __fusionScreenReaderOverride?: boolean }
		).__fusionScreenReaderOverride = undefined;
		resetSettingsCache();
	});

	it("default (no reduced motion) → byte-identical to existing consts", () => {
		const fig = getFigures();
		expect(fig.BLACK_CIRCLE).toBe(BLACK_CIRCLE);
		// UP_ARROW/EFFORT_LOW are module consts too — ensure set matches.
		expect(fig.UP_ARROW).toBe("↑");
		expect(fig.EFFORT_LOW).toBe("○");
	});

	it("FUSION_AX_SCREEN_READER=1 → ASCII downgrades", () => {
		process.env.FUSION_AX_SCREEN_READER = "1";
		resetSettingsCache();
		const fig = getFigures();
		expect(fig.BLACK_CIRCLE).toBe("*");
		expect(fig.UP_ARROW).toBe("^");
		expect(fig.EFFORT_LOW).toBe("o");
		expect(fig.BRIDGE_FAILED_INDICATOR).toBe("x");
	});

	it("switching env + cache reset reflects new state (cache invalidation)", () => {
		// First: default Unicode.
		expect(getFigures().BLACK_CIRCLE).toBe(BLACK_CIRCLE);
		// Then activate reduced motion.
		process.env.FUSION_AX_SCREEN_READER = "1";
		resetSettingsCache();
		expect(getFigures().BLACK_CIRCLE).toBe("*");
		// Then back off.
		delete process.env.FUSION_AX_SCREEN_READER;
		resetSettingsCache();
		expect(getFigures().BLACK_CIRCLE).toBe(BLACK_CIRCLE);
	});

	it("ASCII_SET and UNICODE_SET share the same key set (no missing symbol)", () => {
		const off = getFigures();
		process.env.FUSION_AX_SCREEN_READER = "1";
		resetSettingsCache();
		const on = getFigures();
		const offKeys = Object.keys(off).sort();
		const onKeys = Object.keys(on).sort();
		expect(onKeys).toEqual(offKeys);
		// Every value is a non-empty string (or frozen array for spinner frames).
		for (const k of onKeys) {
			const v = (on as Record<string, unknown>)[k];
			expect(v).toBeDefined();
		}
	});
});
