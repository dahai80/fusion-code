import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getInitialSettings } from "../../../utils/settings/settings.js";
import { resetSettingsCache } from "../../../utils/settings/settingsCache.js";
import { SettingsSchema } from "../../../utils/settings/types.js";

// P4.1 — --ax-screen-reader entry-point alignment.
// spec (CC 2.1.208) defines 3 entry points: --ax-screen-reader CLI flag,
// FUSION_AX_SCREEN_READER=1 env, "axScreenReader":true settings key.
// Audit found env + settings-key silently no-op'd (code only honored
// FUSION_SCREEN_READER + prefersReducedMotion). These tests lock the fix.

const ENV_KEYS = ["FUSION_SCREEN_READER", "FUSION_AX_SCREEN_READER"] as const;

function clearEnv(): void {
	for (const k of ENV_KEYS) {
		delete process.env[k];
	}
}

describe("P4.1 — axScreenReader entry-point alignment", () => {
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

	describe("env alias", () => {
		it("FUSION_AX_SCREEN_READER=1 activates screen reader (spec name)", () => {
			process.env.FUSION_AX_SCREEN_READER = "1";
			const settings = getInitialSettings();
			expect(settings.prefersReducedMotion).toBe(true);
		});

		it("FUSION_SCREEN_READER=1 still works (legacy, backward compat)", () => {
			process.env.FUSION_SCREEN_READER = "1";
			const settings = getInitialSettings();
			expect(settings.prefersReducedMotion).toBe(true);
		});

		it("neither env set → prefersReducedMotion not forced true", () => {
			const settings = getInitialSettings();
			// Without env/settings/override, getInitialSettings does not set
			// prefersReducedMotion (left to whatever disk settings parsed, or undefined).
			expect(settings.prefersReducedMotion ?? false).toBe(false);
		});

		it("FUSION_AX_SCREEN_READER=0 does NOT activate (only '1' honored)", () => {
			process.env.FUSION_AX_SCREEN_READER = "0";
			const settings = getInitialSettings();
			expect(settings.prefersReducedMotion ?? false).toBe(false);
		});
	});

	describe("runtime override (/screen-reader command)", () => {
		it("__fusionScreenReaderOverride=true activates without env", () => {
			(
				globalThis as { __fusionScreenReaderOverride?: boolean }
			).__fusionScreenReaderOverride = true;
			const settings = getInitialSettings();
			expect(settings.prefersReducedMotion).toBe(true);
		});
	});

	describe("settings.json schema — axScreenReader key", () => {
		it("SettingsSchema accepts axScreenReader: true", () => {
			const parsed = SettingsSchema().safeParse({
				axScreenReader: true,
			});
			expect(parsed.success).toBe(true);
			if (parsed.success) {
				expect(parsed.data.axScreenReader).toBe(true);
			}
		});

		it("SettingsSchema accepts axScreenReader: false", () => {
			const parsed = SettingsSchema().safeParse({
				axScreenReader: false,
			});
			expect(parsed.success).toBe(true);
			if (parsed.success) {
				expect(parsed.data.axScreenReader).toBe(false);
			}
		});

		it("SettingsSchema accepts omitted axScreenReader (optional)", () => {
			const parsed = SettingsSchema().safeParse({});
			expect(parsed.success).toBe(true);
			if (parsed.success) {
				expect(parsed.data.axScreenReader).toBeUndefined();
			}
		});

		it("SettingsSchema rejects non-boolean axScreenReader", () => {
			const parsed = SettingsSchema().safeParse({
				axScreenReader: "yes",
			});
			expect(parsed.success).toBe(false);
		});
	});
});
