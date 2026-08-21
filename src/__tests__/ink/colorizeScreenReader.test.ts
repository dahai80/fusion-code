import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import chalk, { type ColorSupportLevel } from "chalk";
import {
	applyColor,
	applyScreenReaderAnsiGate,
	applyTextStyles,
	colorize,
} from "../../ink/colorize.js";
import { getInitialSettings } from "../../utils/settings/settings.js";
import { resetSettingsCache } from "../../utils/settings/settingsCache.js";

// item 19 — screen-reader ANSI gate. When active, colorize()/applyTextStyles()
// return raw strings (no ANSI escape sequences), reusing NO_COLOR semantics
// locally to the Ink render path. Default off = byte-identical current behavior.
//
// The test env runs with NO_COLOR=1 → chalk.level===0, so chalk emits raw
// strings regardless of the gate. To exercise the gate deterministically we
// force chalk.level=3 (truecolor) for the "color applied" assertions and
// restore it after. The gate itself is toggled via the explicit
// applyScreenReaderAnsiGate() API (the module-load capture can't be
// retriggered by env alone without a fresh import).

const ENV_KEYS = ["FUSION_SCREEN_READER", "FUSION_AX_SCREEN_READER"] as const;

function clearEnv(): void {
	for (const k of ENV_KEYS) {
		delete process.env[k];
	}
}

describe("item 19 — screen-reader ANSI gate (colorize)", () => {
	let savedLevel: ColorSupportLevel;

	beforeEach(() => {
		clearEnv();
		applyScreenReaderAnsiGate(false);
		savedLevel = chalk.level;
	});

	afterEach(() => {
		clearEnv();
		applyScreenReaderAnsiGate(false);
		chalk.level = savedLevel;
	});

	describe("gate OFF (default) — color applied when chalk emits", () => {
		it("colorize('x','ansi:red','foreground') wraps with ANSI at chalk.level 3", () => {
			chalk.level = 3 as ColorSupportLevel;
			// NOTE: bare "red" (no ansi: prefix) is a colorize no-op that falls
			// through every prefix branch and returns raw str — pre-existing
			// behavior, not gate-related. The colored path is "ansi:red".
			const out = colorize("x", "ansi:red", "foreground");
			expect(out.length).toBeGreaterThan("x".length);
			expect(out).toContain("x");
		});

		it("colorize handles hex/ansi256/rgb/ansi: formats at chalk.level 3", () => {
			chalk.level = 3 as ColorSupportLevel;
			expect(colorize("x", "#ff0000", "foreground").length).toBeGreaterThan(1);
			expect(
				colorize("x", "ansi256(196)", "foreground").length,
			).toBeGreaterThan(1);
			expect(
				colorize("x", "rgb(255,0,0)", "foreground").length,
			).toBeGreaterThan(1);
			expect(colorize("x", "ansi:red", "foreground").length).toBeGreaterThan(1);
		});

		it("applyTextStyles('x',{bold:true}) wraps with ANSI at chalk.level 3", () => {
			chalk.level = 3 as ColorSupportLevel;
			const out = applyTextStyles("x", { bold: true });
			expect(out.length).toBeGreaterThan("x".length);
		});
	});

	describe("gate ON — raw strings, zero ANSI (even at chalk.level 3)", () => {
		it("colorize returns raw string for every color format", () => {
			chalk.level = 3 as ColorSupportLevel;
			applyScreenReaderAnsiGate(true);
			// Use the colored paths (ansi:/hex/ansi256/rgb); bare "red" is a
			// colorize no-op regardless of gate, so it's excluded here.
			expect(colorize("x", "ansi:red", "foreground")).toBe("x");
			expect(colorize("x", "#ff0000", "foreground")).toBe("x");
			expect(colorize("x", "ansi256(196)", "foreground")).toBe("x");
			expect(colorize("x", "rgb(255,0,0)", "foreground")).toBe("x");
		});

		it("applyTextStyles returns raw text for full style set", () => {
			chalk.level = 3 as ColorSupportLevel;
			applyScreenReaderAnsiGate(true);
			const out = applyTextStyles("x", {
				bold: true,
				italic: true,
				underline: true,
				color: "red" as never,
				inverse: true,
			});
			expect(out).toBe("x");
		});

		it("applyColor inherits the gate (routes through colorize)", () => {
			chalk.level = 3 as ColorSupportLevel;
			applyScreenReaderAnsiGate(true);
			expect(applyColor("x", "ansi:red")).toBe("x");
			expect(applyColor("x", "#ff0000")).toBe("x");
		});
	});

	describe("early-return not broken by gate", () => {
		it("colorize(x, undefined) returns raw in both states", () => {
			expect(colorize("x", undefined, "foreground")).toBe("x");
			applyScreenReaderAnsiGate(true);
			expect(colorize("x", undefined, "foreground")).toBe("x");
		});

		it("applyColor(x, undefined) returns raw in both states", () => {
			expect(applyColor("x", undefined)).toBe("x");
			applyScreenReaderAnsiGate(true);
			expect(applyColor("x", undefined)).toBe("x");
		});
	});

	describe("env entry-point chain locks the gate source", () => {
		beforeEach(() => {
			(
				globalThis as { __fusionScreenReaderOverride?: boolean }
			).__fusionScreenReaderOverride = undefined;
		});
		afterEach(() => {
			(
				globalThis as { __fusionScreenReaderOverride?: boolean }
			).__fusionScreenReaderOverride = undefined;
			resetSettingsCache();
		});

		it("FUSION_AX_SCREEN_READER=1 → getInitialSettings().prefersReducedMotion === true", () => {
			process.env.FUSION_AX_SCREEN_READER = "1";
			resetSettingsCache();
			expect(getInitialSettings().prefersReducedMotion).toBe(true);
		});

		it("no env → prefersReducedMotion not forced true", () => {
			resetSettingsCache();
			expect(getInitialSettings().prefersReducedMotion ?? false).toBe(false);
		});
	});
});
