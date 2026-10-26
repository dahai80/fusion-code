/**
 * #224 MLX preflight budget clamp regression.
 *
 * Old behavior: safeBudget reserved the full COMPACT_MAX_OUTPUT_TOKENS
 * (20000) against a 32k window -> budget 8937 -> a FULL-tier tool set
 * (~8200 tokens) was silently reduced to the 5-tool core set on every
 * query, even though (32768 - 8192) * 0.7 = 17203 tokens easily fit.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installProviderEnvIsolation } from "../../src/__tests__/helpers/providerEnv.js";
import type { Tool } from "../../src/Tool.js";
import { preflightMlxQueryCheck } from "../../src/utils/model/mlxPreflight.js";

const EXTRA_ENV_KEYS = ["FUSION_MLX_MODEL", "FUSION_MODEL"] as const;

function makeTool(name: string, schemaChars = 1100): Tool {
	return {
		name,
		description: `tool ${name}`,
		inputSchema: {
			type: "object",
			properties: {
				p: {
					type: "string",
					description: "x".repeat(schemaChars),
				},
			},
			required: ["p"],
		},
	} as unknown as Tool;
}

describe("#224 mlxPreflight budget clamp", () => {
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
		homeSnap = process.env.HOME;
		tempHome = mkdtempSync(join(tmpdir(), "mlxpreflight-home-"));
		process.env.HOME = tempHome;
		process.env.FUSION_MLX_ENABLED = "1";
		process.env.FUSION_MLX_MODEL = "qwen2.5-32b-instruct-4bit";
	});

	afterEach(() => {
		if (envSnap.FUSION_MLX_MODEL === undefined) {
			delete process.env.FUSION_MLX_MODEL;
		} else {
			process.env.FUSION_MLX_MODEL = envSnap.FUSION_MLX_MODEL;
		}
		if (homeSnap === undefined) delete process.env.HOME;
		else process.env.HOME = homeSnap;
		rmSync(tempHome, { recursive: true, force: true });
	});

	it("FULL-tier tool set fits a 32k window without reduction (was: reduced to 5 core tools)", () => {
		const tools = Array.from({ length: 29 }, (_, i) => makeTool(`Tool${i}`));
		const messages = [
			{ role: "user", content: "Read notes.txt and count lines" },
		] as unknown as Parameters<typeof preflightMlxQueryCheck>[2];
		const result = preflightMlxQueryCheck("system prompt", tools, messages);

		// clamped reserve: (32768 - 8192) * 0.7 = 17203
		expect(result.safeBudget).toBe(17203);
		expect(result.fits).toBe(true);
		expect(result.reducedTools).toBeUndefined();
	});

	it("genuinely over-budget request still reduces tools", () => {
		const tools = Array.from({ length: 29 }, (_, i) => makeTool(`Tool${i}`));
		// huge system prompt (~50k estimated tokens) — no tool reduction can save it
		const system = "x".repeat(200_000);
		const result = preflightMlxQueryCheck(system, tools, []);

		expect(result.fits).toBe(false);
		expect(result.reducedTools).toBeDefined();
	});
});
