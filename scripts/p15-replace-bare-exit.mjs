// P1-5 (audit R11): replace bare process.exit(N) -> gracefulShutdownSync(N)
// in src/main.tsx, init-boundary-aware. Deterministic (Rule 5), not model-routed.
//
// ALLOWLIST of lines to convert (post-init stateful paths only):
//   889 (SIGINT GAP1), 2022-2592 (validation block), 2688, 2873-2912,
//   3286, 3297, 3911 (GAP3), 4555 (GAP2), 5849 (GAP4).
// NOT converted (out of scope):
//   PRE-stage 517/706/740/755/770/949/967 (before init — gracefulShutdownSync
//     not semantically available),
//   post-REPL cluster 4729/4750/4945/5040 (already prefixed by
//     `await gracefulShutdown(N)` — trailing process.exit is dead code after
//     forceExit),
//   subcommands 5718/5758/5801/5898/5917/5929/5940/5969 (separate command
//     lifecycle, no REPL cleanup).
//
// Run: node scripts/p15-replace-bare-exit.mjs
// Idempotent: re-running on already-converted lines is a no-op (match guard
// skips lines not containing `process.exit`).

import { readFileSync, writeFileSync } from "node:fs";

const FILE = "src/main.tsx";

// 1-indexed line numbers whose `process.exit(N)` becomes `gracefulShutdownSync(N)`.
const CONVERT = new Set([
	889, 2022, 2028, 2036, 2067, 2188, 2201, 2212, 2234, 2273, 2285, 2298, 2305,
	2318, 2331, 2338, 2444, 2467, 2543, 2579, 2592, 2688, 2873, 2879, 2888, 2897,
	2906, 2912, 3286, 3297, 3911, 4555, 5849,
]);

const src = readFileSync(FILE, "utf8");
const lines = src.split("\n");
let changed = 0;
const report = [];

for (const ln of CONVERT) {
	const idx = ln - 1;
	const original = lines[idx];
	if (original === undefined) {
		report.push(`SKIP ${ln}: line out of range (file shifted?)`);
		continue;
	}
	// Match a bare process.exit(N) call on the line (possibly indented).
	// Captures the argument verbatim (e.g. `1`, `0`, `exitCode`).
	const m = original.match(/^(\s*)process\.exit\(([^)]*)\);(\s*)$/);
	if (!m) {
		// Already converted or different shape — record, do not touch.
		if (original.includes("gracefulShutdownSync")) {
			report.push(`SKIP ${ln}: already gracefulShutdownSync`);
		} else {
			report.push(
				`SKIP ${ln}: no bare process.exit match -> ${original.trim()}`,
			);
		}
		continue;
	}
	const [, indent, arg, trail] = m;
	lines[idx] = `${indent}gracefulShutdownSync(${arg});${trail}`;
	changed++;
	report.push(
		`CONV ${ln}: process.exit(${arg}) -> gracefulShutdownSync(${arg})`,
	);
}

if (changed > 0) {
	writeFileSync(FILE, lines.join("\n"));
}

console.log(
	`P1-5 replace: ${changed} lines converted (of ${CONVERT.size} targets).`,
);
for (const r of report) {
	console.log(`  ${r}`);
}

if (changed === 0 && report.every((r) => r.startsWith("SKIP"))) {
	console.log("No changes needed (idempotent no-op).");
}
