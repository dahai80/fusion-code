import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// P1-5 (audit R11): contract test — no bare process.exit after the init
// boundary in src/main.tsx except on a documented allowlist. Replaces
// ad-hoc grep with a deterministic assertion (Rule 5: decide with code).
//
// The init boundary is `await init()` (commander preAction). Before it,
// gracefulShutdownSync is not semantically available, so bare process.exit
// is allowed (PRE-stage fast paths). After it, every exit must route
// through gracefulShutdownSync so cleanup (terminal-mode restore, session-end
// hooks, analytics flush) runs.
//
// Allowlist (post-init bare process.exit that is intentionally kept):
//   - pre-REPL fast paths: deep-link / URL-scheme handlers (and similar) that
//     process a URI and exit with the handler's result before the main REPL
//     command action runs. Separate lifecycle, no REPL to clean up. Detected
//     by "preceding non-blank line is an allowlisted fast-path result call".
//   - post-REPL cluster: lines already prefixed by `await gracefulShutdown(N)`
//     — the trailing process.exit is dead code after forceExit, kept to match
//     the upstream pattern. Detected by "preceding non-blank line is
//     await gracefulShutdown".
//   - named subcommands (server/ssh/agents/auto-mode/open/...): extracted to
//     ./main/*SubCommands.ts per audit P2-1/R17 god-module split (slices
//     C2-C4), so their bare exits live outside main.tsx and are not scanned
//     here at all.
//
// All are detected structurally, so line-number drift does not silently
// weaken the contract — a new bare exit fails loudly until classified.

const here = dirname(fileURLToPath(import.meta.url));
const mainPath = join(here, "..", "..", "src", "main.tsx");
const src = readFileSync(mainPath, "utf8");
const lines = src.split("\n");

function findInitBoundary(): number {
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].includes("await init()")) {
			return i + 1; // 1-indexed
		}
	}
	throw new Error("init boundary `await init()` not found in main.tsx");
}

// An actual process.exit( call, not a comment and not process.exitCode.
function isBareExitCall(line: string): boolean {
	const trimmed = line.trimStart();
	if (trimmed.startsWith("//")) return false;
	if (trimmed.startsWith("*")) return false;
	// process.exitCode is a property set, not an exit call.
	if (/process\.exitCode\b/.test(trimmed)) return false;
	return /process\.exit\s*\(/.test(trimmed);
}

// post-REPL dead-code pattern: the line immediately above is an
// `await gracefulShutdown(N);` call (the real exit), making this trailing
// process.exit unreachable after forceExit.
function precededByAwaitGracefulShutdown(idx: number): boolean {
	// scan upward past blank lines for the first non-blank line
	for (let j = idx - 1; j >= 0; j--) {
		const t = lines[j].trim();
		if (t === "") continue;
		return /^\s*await\s+gracefulShutdown\s*\(/.test(lines[j]);
	}
	return false;
}

// Pre-REPL fast-path pattern: a separate-lifecycle exit reached before the
// main REPL command action runs — e.g. a deep-link/URL-scheme handler that
// processes the URI and exits with the handler's result code. Detected by the
// line immediately above being a call whose result feeds the exit. This is
// the post-subcommand-extraction shape: all named subcommands
// (server/ssh/agents/auto-mode/open/...) were extracted to ./main/*SubCommands.ts
// per audit P2-1/R17 god-module split (slices C2-C4), so no inline
// `.command(` subcommand region remains in main.tsx. The remaining allowlisted
// exits are (a) these pre-REPL fast paths and (b) post-REPL dead code above.
const FAST_PATH_RESULT_CALLS = [
	/handleDeepLinkUri\s*\(/,
	/handleUrlSchemeLaunch\s*\(/,
];
function isPreReplFastPath(idx: number): boolean {
	for (let j = idx - 1; j >= 0; j--) {
		const t = lines[j].trim();
		if (t === "") continue;
		return FAST_PATH_RESULT_CALLS.some((re) => re.test(lines[j]));
	}
	return false;
}

describe("P1-5 no bare process.exit after init (audit R11)", () => {
	it("init boundary exists", () => {
		expect(() => findInitBoundary()).not.toThrow();
	});

	it("every post-init process.exit is allowlisted (post-REPL or pre-REPL fast path)", () => {
		const initLine = findInitBoundary();
		// All named subcommands (server/ssh/agents/auto-mode/open/...) were
		// extracted to ./main/*SubCommands.ts per audit P2-1/R17 god-module
		// split (slices C2-C4), so no inline `.command(` subcommand region
		// remains in main.tsx. The remaining allowlisted exits post-init are:
		//   - pre-REPL fast paths (deep-link/URL-scheme handlers): separate
		//     lifecycle, process the URI then exit, no REPL to clean up.
		//   - post-REPL dead code: a trailing process.exit already preceded by
		//     `await gracefulShutdown(N)` (the real exit).
		// Both are detected structurally, so a new bare exit that fits neither
		// fails loudly until classified — preferable to silent weakening.

		const violations: string[] = [];
		for (let i = 0; i < lines.length; i++) {
			const ln = i + 1;
			if (ln <= initLine) continue; // PRE-stage: allowed
			if (!isBareExitCall(lines[i])) continue;

			const isFastPath = isPreReplFastPath(i);
			const isPostReplDeadCode = precededByAwaitGracefulShutdown(i);

			if (!isFastPath && !isPostReplDeadCode) {
				violations.push(`  line ${ln}: ${lines[i].trim()}`);
			}
		}

		if (violations.length > 0) {
			throw new Error(
				`P1-5 violation: ${violations.length} bare process.exit call(s) ` +
					`after init (line ${initLine}) not on allowlist ` +
					`(post-REPL dead-code or subcommand). Either route through ` +
					`gracefulShutdownSync or, if intentionally a separate ` +
					`lifecycle, document in the allowlist:\n` +
					violations.join("\n"),
			);
		}
		// 0 violations — but assert at least the expected allowlisted exits
		// still exist, so the test cannot pass vacuously if all exits were
		// accidentally removed.
		const remaining = lines
			.map((l, i) => ({ l, ln: i + 1 }))
			.filter(({ l, ln }) => ln > initLine && isBareExitCall(l));
		expect(remaining.length).toBeGreaterThan(0);
	});

	it("SIGHUP handler routes through gracefulShutdown (audit R11)", () => {
		// SIGHUP must be handled and route to gracefulShutdown(129), not a
		// bare exit. Verified by structural presence in gracefulShutdown.ts.
		const gsPath = join(
			here,
			"..",
			"..",
			"src",
			"utils",
			"gracefulShutdown.ts",
		);
		const gs = readFileSync(gsPath, "utf8");
		expect(gs).toMatch(/process\.on\(\s*["']SIGHUP["']/);
		expect(gs).toMatch(/gracefulShutdown\(\s*129\s*\)/);
	});
});
