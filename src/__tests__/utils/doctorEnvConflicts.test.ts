import { afterEach, describe, expect, it } from "bun:test";
import { detectFusionEnvConflicts } from "../../utils/doctorDiagnostic.js";

// The 6 FUSION_* -> ANTHROPIC_* mapping pairs from cli.tsx:30-49. detectFusionEnvConflicts
// must flag a pair only when BOTH are set (the silent-shadow trap). process.env is
// process-global, so each case snapshots + restores the pairs it touches.

const PAIRS: Array<[fusion: string, anthropic: string]> = [
	["FUSION_API_KEY", "ANTHROPIC_API_KEY"],
	["FUSION_BASE_URL", "ANTHROPIC_BASE_URL"],
	["FUSION_AUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN"],
	["FUSION_BETAS", "ANTHROPIC_BETAS"],
	["FUSION_MODEL", "ANTHROPIC_MODEL"],
	["FUSION_LOG", "ANTHROPIC_LOG"],
];

function snapshotEnv(): Record<string, string | undefined> {
	const snap: Record<string, string | undefined> = {};
	for (const [fusion, anthropic] of PAIRS) {
		snap[fusion] = process.env[fusion];
		snap[anthropic] = process.env[anthropic];
	}
	return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
	for (const [fusion, anthropic] of PAIRS) {
		if (snap[fusion] === undefined) delete process.env[fusion];
		else process.env[fusion] = snap[fusion];
		if (snap[anthropic] === undefined) delete process.env[anthropic];
		else process.env[anthropic] = snap[anthropic];
	}
}

function clearAllPairs(): void {
	for (const [fusion, anthropic] of PAIRS) {
		delete process.env[fusion];
		delete process.env[anthropic];
	}
}

describe("detectFusionEnvConflicts", () => {
	afterEach(() => {
		// Belt-and-suspenders: wipe every pair after each case so a case that
		// forgot to restore can't bleed into the next. snapshotEnv/restoreEnv
		// inside each case handles the precise save/restore of pre-test state.
		clearAllPairs();
	});

	it("returns no warnings when neither var of any pair is set", () => {
		const snap = snapshotEnv();
		clearAllPairs();
		try {
			expect(detectFusionEnvConflicts()).toEqual([]);
		} finally {
			restoreEnv(snap);
		}
	});

	it("returns no warnings when only FUSION_* is set (normal mapped case)", () => {
		const snap = snapshotEnv();
		clearAllPairs();
		process.env.FUSION_BASE_URL = "https://gateway.example.com";
		try {
			expect(detectFusionEnvConflicts()).toEqual([]);
		} finally {
			restoreEnv(snap);
		}
	});

	it("returns no warnings when only ANTHROPIC_* is set (direct override)", () => {
		const snap = snapshotEnv();
		clearAllPairs();
		process.env.ANTHROPIC_API_KEY = "sk-ant-direct";
		try {
			expect(detectFusionEnvConflicts()).toEqual([]);
		} finally {
			restoreEnv(snap);
		}
	});

	it("flags a pair when both FUSION_* and ANTHROPIC_* are set", () => {
		const snap = snapshotEnv();
		clearAllPairs();
		process.env.FUSION_BASE_URL = "https://gateway.example.com";
		process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com";
		try {
			const warnings = detectFusionEnvConflicts();
			expect(warnings).toHaveLength(1);
			expect(warnings[0].issue).toContain("FUSION_BASE_URL");
			expect(warnings[0].issue).toContain("ANTHROPIC_BASE_URL");
			expect(warnings[0].issue).toContain("silently ignored");
			expect(warnings[0].fix).toContain("unset ANTHROPIC_BASE_URL");
		} finally {
			restoreEnv(snap);
		}
	});

	it("flags all 6 pairs when every pair has both vars set", () => {
		const snap = snapshotEnv();
		clearAllPairs();
		for (const [fusion, anthropic] of PAIRS) {
			process.env[fusion] = "fusion-value";
			process.env[anthropic] = "anthropic-value";
		}
		try {
			const warnings = detectFusionEnvConflicts();
			expect(warnings).toHaveLength(6);
			// Every pair name appears in exactly one warning issue line.
			for (const [fusion, anthropic] of PAIRS) {
				const match = warnings.find((w) => w.issue.includes(fusion));
				expect(match).toBeDefined();
				expect(match?.issue).toContain(anthropic);
			}
		} finally {
			restoreEnv(snap);
		}
	});

	it("flags only the conflicting pairs, not the clean ones (mixed state)", () => {
		const snap = snapshotEnv();
		clearAllPairs();
		// Conflicting: API_KEY pair both set, MODEL pair both set.
		process.env.FUSION_API_KEY = "fk";
		process.env.ANTHROPIC_API_KEY = "ak";
		process.env.FUSION_MODEL = "fusion-m";
		process.env.ANTHROPIC_MODEL = "anthropic-m";
		// Clean: only FUSION_BASE_URL set, only ANTHROPIC_LOG set.
		process.env.FUSION_BASE_URL = "https://gw";
		process.env.ANTHROPIC_LOG = "debug";
		try {
			const warnings = detectFusionEnvConflicts();
			expect(warnings).toHaveLength(2);
			const issues = warnings.map((w) => w.issue).join("\n");
			expect(issues).toContain("FUSION_API_KEY");
			expect(issues).toContain("FUSION_MODEL");
			expect(issues).not.toContain("FUSION_BASE_URL");
			expect(issues).not.toContain("FUSION_LOG");
		} finally {
			restoreEnv(snap);
		}
	});
});
