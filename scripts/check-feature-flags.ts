#!/usr/bin/env bun
// P1-4 (audit R10): feature-flag four-source drift gate.
// Diffs the build-time feature('X') call sites in src/ against the
// fullExperimentalFeatures array in scripts/build.ts. Fails on any
// mismatch — orphan flags in build.ts (0 src refs) or active misses
// (src refs absent from build.ts, so --feature-set=dev-full can't enable
// them and the DCE'd path can't be compile-tested).
//
// docs/feature-flags.md is NOT machine-checked here (prose table); it is
// reconciled manually when this gate runs clean. The src↔build pair is the
// load-bearing one — a miss there breaks dev-full build or leaves a path
// untestable; a doc-only drift is cosmetic.
//
// Run: bun run scripts/check-feature-flags.ts
// Wired into `bun run check` via package.json "check" (audit P1-4).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Glob } from "bun";

const ROOT = resolve(import.meta.dirname, "..");
const SRC_DIR = resolve(ROOT, "src");

// --- collect src feature('X') call sites (all quote forms) ---
// Pure in-process scan (no rg/shell-out) so the gate is deterministic and
// immune to tool-rewrite proxies on the dev machine. Scans every .ts/.tsx
// under src/ for `feature("X")` / `feature('X')` and de-duplicates.
function collectSrcFlags(): Set<string> {
	const flags = new Set<string>();
	const re = /feature\(["']([A-Z][A-Z0-9_]+)["']\)/g;
	const glob = new Glob("**/*.{ts,tsx}");
	for (const path of glob.scanSync(SRC_DIR)) {
		const full = resolve(SRC_DIR, path);
		const src = readFileSync(full, "utf8");
		const matches = src.matchAll(re);
		for (const m of matches) {
			flags.add(m[1] as string);
		}
	}
	return flags;
}

// --- collect build.ts fullExperimentalFeatures array entries ---
function collectBuildFlags(): Set<string> {
	const buildPath = resolve(ROOT, "scripts/build.ts");
	const src = readFileSync(buildPath, "utf8");
	const flags = new Set<string>();
	// Slice the fullExperimentalFeatures array body (between its `[` and `] as const`).
	const start = src.indexOf("fullExperimentalFeatures = [");
	if (start === -1) {
		throw new Error(
			"[check-feature-flags] cannot locate fullExperimentalFeatures array in scripts/build.ts",
		);
	}
	const end = src.indexOf("] as const", start);
	if (end === -1) {
		throw new Error(
			"[check-feature-flags] cannot locate closing `] as const` of fullExperimentalFeatures",
		);
	}
	const body = src.slice(start, end);
	// Real entries are quoted flag names on their own; comment lines (//) are not entries.
	for (const line of body.split("\n")) {
		const trimmed = line.trimStart();
		if (trimmed.startsWith("//")) continue;
		const m = trimmed.match(/^"([A-Z][A-Z0-9_]+)",?$/);
		if (m) flags.add(m[1]);
	}
	return flags;
}

const srcFlags = collectSrcFlags();
const buildFlags = collectBuildFlags();

const orphans = [...buildFlags].filter((f) => !srcFlags.has(f)).sort();
const misses = [...srcFlags].filter((f) => !buildFlags.has(f)).sort();

console.log(
	`[check-feature-flags] src=${srcFlags.size} build=${buildFlags.size} orphans=${orphans.length} misses=${misses.length}`,
);

if (orphans.length === 0 && misses.length === 0) {
	console.log(
		"[check-feature-flags] OK: src feature() call sites match build.ts fullExperimentalFeatures (audit P1-4 R10)",
	);
	process.exit(0);
}

console.error(
	"[check-feature-flags] FAIL: feature-flag drift between src and build.ts (audit P1-4 R10)",
);
for (const f of orphans) {
	console.error(
		`  ORPHAN  ${f}: in build.ts fullExperimentalFeatures but 0 feature("${f}") call sites in src/ — remove from build.ts`,
	);
}
for (const f of misses) {
	console.error(
		`  MISS    ${f}: feature("${f}") called in src/ but absent from build.ts fullExperimentalFeatures — --feature-set=dev-full cannot enable it; add to build.ts`,
	);
}
console.error(
	'  Fix: re-run `rg -rohN "feature\\([\\"\'][A-Z0-9_]+[\\"\']\\)" src/ | sort -u` and sync scripts/build.ts, then docs/feature-flags.md.',
);
process.exit(1);
