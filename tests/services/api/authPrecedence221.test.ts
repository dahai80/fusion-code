/**
 * #221 auth precedence truth table
 *
 * 1. Topology: explicit local opt-in (FUSION_MLX_ENABLED etc.) is a
 *    deployment fact — key presence selects credentials, never topology.
 * 2. Credentials: in local mode ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY
 *    (cloud proxy tokens) must NOT precede local gateway/engine keys —
 *    live 401 repro from the eval.
 * 3. Deprecated key aliases warn exactly once per session.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	installProviderEnvIsolation,
	PROVIDER_ENV_KEYS,
} from "../../../src/__tests__/helpers/providerEnv.js";
import {
	_deprecatedAliasWarningCountForTest,
	_resetAuthDeprecationWarningsForTest,
	_resetMlxBaseUrl,
	resolveMlxCredential,
} from "../../../src/services/api/fusion-mlx-adapter.js";
import { getAPIProvider } from "../../../src/utils/model/providers.js";

// #221 extra credential env keys beyond provider routing keys
const EXTRA_ENV_KEYS = [
	"ANTHROPIC_AUTH_TOKEN",
	"FUSION_AUTH_TOKEN",
	"FUSION_GATEWAY_API_KEY",
	"GATEWAY_API_KEY",
	"FUSION_MLX_API_KEY",
	"MLX_API_KEY",
	"FUSION_ALLOW_ANTHROPIC_TOKEN_LOCAL",
] as const;

const ALL_ENV_KEYS = [...PROVIDER_ENV_KEYS, ...EXTRA_ENV_KEYS];

describe("#221 auth precedence", () => {
	let envSnap: Record<string, string | undefined>;
	let homeSnap: string | undefined;
	let tempHome: string;

	installProviderEnvIsolation();

	beforeEach(() => {
		envSnap = {};
		for (const k of EXTRA_ENV_KEYS) {
			envSnap[k] = process.env[k];
			delete process.env[k];
		}
		// settings.json fallback isolation: real ~/.fusion-mlx/settings.json
		// carries a live api_key that must not leak into "no credential" rows
		homeSnap = process.env.HOME;
		tempHome = mkdtempSync(join(tmpdir(), "auth221-home-"));
		process.env.HOME = tempHome;
		_resetAuthDeprecationWarningsForTest();
		_resetMlxBaseUrl();
	});

	afterEach(() => {
		for (const k of EXTRA_ENV_KEYS) {
			if (envSnap[k] === undefined) delete process.env[k];
			else process.env[k] = envSnap[k];
		}
		if (homeSnap === undefined) delete process.env.HOME;
		else process.env.HOME = homeSnap;
		rmSync(tempHome, { recursive: true, force: true });
		_resetAuthDeprecationWarningsForTest();
		_resetMlxBaseUrl();
	});

	describe("provider topology truth table (getAPIProvider)", () => {
		const rows: Array<{
			label: string;
			env: Record<string, string>;
			expected: string;
		}> = [
			{
				label: "no config -> firstParty",
				env: {},
				expected: "firstParty",
			},
			{
				label: "FUSION_CLIENT_KEY -> firstParty",
				env: { FUSION_CLIENT_KEY: "sk-x" },
				expected: "firstParty",
			},
			{
				label: "valid ANTHROPIC_API_KEY -> firstParty",
				env: { ANTHROPIC_API_KEY: "sk-ant-api03-abcdef" },
				expected: "firstParty",
			},
			{
				label: "ANTHROPIC_AUTH_TOKEN alone -> firstParty default",
				env: { ANTHROPIC_AUTH_TOKEN: "cloud-tok" },
				expected: "firstParty",
			},
			{
				label: "FUSION_MLX_ENABLED=1 -> fusionMlx",
				env: { FUSION_MLX_ENABLED: "1" },
				expected: "fusionMlx",
			},
			{
				label:
					"FUSION_MLX_ENABLED=1 + FUSION_CLIENT_KEY -> fusionMlx (#221: key is credentials, not topology)",
				env: { FUSION_MLX_ENABLED: "1", FUSION_CLIENT_KEY: "sk-x" },
				expected: "fusionMlx",
			},
			{
				label: "FUSION_MLX_ENABLED=1 + ANTHROPIC_AUTH_TOKEN -> fusionMlx",
				env: { FUSION_MLX_ENABLED: "1", ANTHROPIC_AUTH_TOKEN: "cloud" },
				expected: "fusionMlx",
			},
			{
				label: "FUSION_GATEWAY_ENABLED=1 -> fusionMlx",
				env: { FUSION_GATEWAY_ENABLED: "1" },
				expected: "fusionMlx",
			},
			{
				label: "FUSION_MLX_BASE_URL set -> fusionMlx",
				env: { FUSION_MLX_BASE_URL: "http://127.0.0.1:11434" },
				expected: "fusionMlx",
			},
			{
				label:
					"FUSION_MLX_ENABLED=1 beats third-party proxy inference -> fusionMlx",
				env: {
					FUSION_MLX_ENABLED: "1",
					FUSION_BASE_URL: "https://api.someproxy.com",
				},
				expected: "fusionMlx",
			},
			{
				label: "third-party proxy base URL (no key) -> firstParty",
				env: { FUSION_BASE_URL: "https://api.someproxy.com" },
				expected: "firstParty",
			},
			{
				label: "FUSION_MLX_DISABLED=1 beats FUSION_MLX_ENABLED -> firstParty",
				env: { FUSION_MLX_DISABLED: "1", FUSION_MLX_ENABLED: "1" },
				expected: "firstParty",
			},
		];

		for (const { label, env, expected } of rows) {
			it(label, () => {
				for (const [k, v] of Object.entries(env)) {
					process.env[k] = v;
				}
				expect(getAPIProvider()).toBe(expected);
			});
		}
	});

	describe("local credential chain (resolveMlxCredential)", () => {
		it("live 401 repro: cloud ANTHROPIC_AUTH_TOKEN must not preempt local gateway key", () => {
			process.env.ANTHROPIC_AUTH_TOKEN = "cloud-proxy-token";
			process.env.FUSION_MLX_ENABLED = "1";
			process.env.FUSION_GATEWAY_API_KEY = "valid-gw-key";
			const cred = resolveMlxCredential();
			expect(cred.value).toBe("valid-gw-key");
			expect(cred.name).toContain("FUSION_GATEWAY_API_KEY");
		});

		it("FUSION_CLIENT_KEY is canonical and wins over everything", () => {
			process.env.FUSION_CLIENT_KEY = "canonical";
			process.env.ANTHROPIC_AUTH_TOKEN = "cloud";
			process.env.FUSION_GATEWAY_API_KEY = "gw";
			const cred = resolveMlxCredential();
			expect(cred.value).toBe("canonical");
			expect(cred.name).toBe("FUSION_CLIENT_KEY");
		});

		it("FUSION_AUTH_TOKEN accepted as canonical alias", () => {
			process.env.FUSION_AUTH_TOKEN = "tok";
			const cred = resolveMlxCredential();
			expect(cred.value).toBe("tok");
			expect(cred.name).toBe("FUSION_AUTH_TOKEN");
		});

		it("ANTHROPIC_* ignored in local mode without explicit opt-in", () => {
			process.env.ANTHROPIC_AUTH_TOKEN = "cloud";
			process.env.ANTHROPIC_API_KEY = "sk-ant-api03-xyz";
			const cred = resolveMlxCredential();
			expect(cred.value).toBeUndefined();
			expect(cred.name).toBe("none");
		});

		it("FUSION_ALLOW_ANTHROPIC_TOKEN_LOCAL=1 opts cloud token back in", () => {
			process.env.ANTHROPIC_AUTH_TOKEN = "cloud";
			process.env.FUSION_ALLOW_ANTHROPIC_TOKEN_LOCAL = "1";
			const cred = resolveMlxCredential();
			expect(cred.value).toBe("cloud");
			expect(cred.name).toContain("ANTHROPIC_AUTH_TOKEN");
		});

		it("FUSION_CLIENT_KEY works for engine-direct base URL too (#226)", () => {
			process.env.FUSION_MLX_BASE_URL = "http://127.0.0.1:11434";
			process.env.FUSION_CLIENT_KEY = "engine-key";
			const cred = resolveMlxCredential();
			expect(cred.value).toBe("engine-key");
			expect(cred.name).toBe("FUSION_CLIENT_KEY");
		});

		it("legacy mlx env aliases are no longer read (#226)", () => {
			process.env.FUSION_MLX_API_KEY = "legacy-engine-key";
			process.env.MLX_API_KEY = "legacy-engine-key";
			const cred = resolveMlxCredential();
			// no settings.json in tempHome -> no credential from removed alias chain
			expect(cred.value).toBeUndefined();
			expect(_deprecatedAliasWarningCountForTest()).toBe(0);
		});

		it("deprecated gateway aliases warn exactly once per session", () => {
			process.env.FUSION_GATEWAY_API_KEY = "gw";
			resolveMlxCredential();
			resolveMlxCredential();
			resolveMlxCredential();
			// one alias name seen -> deduped to a single warning
			expect(_deprecatedAliasWarningCountForTest()).toBe(1);
			// a second distinct alias adds exactly one more
			delete process.env.FUSION_GATEWAY_API_KEY;
			process.env.GATEWAY_API_KEY = "gw2";
			resolveMlxCredential();
			expect(_deprecatedAliasWarningCountForTest()).toBe(2);
		});
	});
});
