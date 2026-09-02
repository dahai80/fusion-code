// audit-0902 P1-1: isFirstPartyAnthropicBaseUrl must read the same env source
// as resolveFirstPartyBaseUrl (seam.ts): FUSION_BASE_URL || ANTHROPIC_BASE_URL.
// Previously read ONLY FUSION_BASE_URL, so a user setting only
// ANTHROPIC_BASE_URL=https://attacker kept firstParty=true while the request
// went to attacker — leaking x-api-key + OAuth Bearer.

import { afterEach, describe, expect, test } from "bun:test";
import { isFirstPartyAnthropicBaseUrl } from "../../../utils/model/providers.js";

const KEYS = ["FUSION_BASE_URL", "ANTHROPIC_BASE_URL", "USER_TYPE"] as const;

const saved: Record<string, string | undefined> = {};

afterEach(() => {
	for (const k of KEYS) {
		const key: string = k;
		if (saved[key] === undefined) delete process.env[key];
		else process.env[key] = saved[key];
		delete saved[key];
	}
});

function setEnv(key: string, val: string): void {
	if (!(key in saved)) saved[key] = process.env[key];
	process.env[key] = val;
}

describe("isFirstPartyAnthropicBaseUrl (audit-0902 P1-1)", () => {
	test("both unset -> true (canonical Anthropic)", () => {
		delete process.env.FUSION_BASE_URL;
		delete process.env.ANTHROPIC_BASE_URL;
		expect(isFirstPartyAnthropicBaseUrl()).toBe(true);
	});

	test("FUSION_BASE_URL=api.anthropic.com -> true", () => {
		setEnv("FUSION_BASE_URL", "https://api.anthropic.com");
		expect(isFirstPartyAnthropicBaseUrl()).toBe(true);
	});

	test("ANTHROPIC_BASE_URL=api.anthropic.com (FUSION unset) -> true", () => {
		setEnv("ANTHROPIC_BASE_URL", "https://api.anthropic.com");
		expect(isFirstPartyAnthropicBaseUrl()).toBe(true);
	});

	test("ANTHROPIC_BASE_URL=attacker (FUSION unset) -> false [regression]", () => {
		// The bug: only ANTHROPIC_BASE_URL set to attacker left firstParty=true.
		setEnv("ANTHROPIC_BASE_URL", "https://attacker.example.com");
		expect(isFirstPartyAnthropicBaseUrl()).toBe(false);
	});

	test("FUSION_BASE_URL takes precedence over ANTHROPIC_BASE_URL", () => {
		setEnv("FUSION_BASE_URL", "https://api.anthropic.com");
		setEnv("ANTHROPIC_BASE_URL", "https://attacker.example.com");
		expect(isFirstPartyAnthropicBaseUrl()).toBe(true);
	});

	test("FUSION_BASE_URL=attacker overrides ANTHROPIC=anthropic -> false", () => {
		setEnv("FUSION_BASE_URL", "https://attacker.example.com");
		setEnv("ANTHROPIC_BASE_URL", "https://api.anthropic.com");
		expect(isFirstPartyAnthropicBaseUrl()).toBe(false);
	});

	test("invalid URL -> false (fail-closed)", () => {
		setEnv("ANTHROPIC_BASE_URL", "not-a-url");
		expect(isFirstPartyAnthropicBaseUrl()).toBe(false);
	});

	test("ant staging host allowed only when USER_TYPE=ant", () => {
		setEnv("ANTHROPIC_BASE_URL", "https://api-staging.anthropic.com");
		setEnv("USER_TYPE", "ant");
		expect(isFirstPartyAnthropicBaseUrl()).toBe(true);
		delete process.env.USER_TYPE;
		setEnv("USER_TYPE", "external");
		expect(isFirstPartyAnthropicBaseUrl()).toBe(false);
	});
});
