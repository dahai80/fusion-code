// item 24: plugin marketplace `command` source (CC 2.1.229, §140/§216)
//
// The marketplace declares a local shell command whose stdout yields the plugin directory path.
// Re-resolved each session — the directory can move, no restart needed. Equivalent to a directory
// source, but the path comes dynamically from the command.
//
// Security: same trust model as git/npm/zip install (command runs arbitrary code). Mitigation =
// strictKnownMarketplaces marketplace-name allowlist (policy gate, not host/path pattern — the
// command source has no host/path). The command comes from trusted declarations
// (marketplace.json/settings), not arbitrary user input. fail-visible:
// timeout/non-zero exit/empty output/non-directory -> throw, no silent degradation.
//
// Materialized execution does not wire into the addMarketplaceSource stub (cloud-only removed stub,
// same as all other sources). This module exports the independently testable resolveCommandSource
// real logic, for wiring into the materialization path when the stub is filled in later.

import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { logForDebugging } from "../debug.js";
import { execFileNoThrowWithCwd } from "../execFileNoThrow.js";
import type { MarketplaceSource } from "./schemas.js";

// command source subset (the source:'command' variant of MarketplaceSource)
export interface CommandMarketplaceSource {
	source: "command";
	command: string;
	cwd?: string;
}

// Command timeout. Plugin directory resolution should take seconds — a long-running command is
// likely broken (hang/network).
const COMMAND_TIMEOUT_MS = 30_000;

// P1-12: shell metacharacters — reject on hit (cannot be represented as a single argv; shell semantics = injection surface).
// command source commands come from trusted declarations, not arbitrary user input; forcing a single process with no
// pipes/redirects/chaining, combined with shell:false argv execution, eliminates injection. Genuine shell semantics belong
// in the executor sandbox (long-term).
const SHELL_OPERATOR_RE =
	/[;|&]|\|\||&&|>\s|<\s|\$\(|`|\$\{|2>\s|>>|^[\s]*\(|\\[;&|<>]/;

export interface ResolvedCommandSource {
	directoryPath: string;
}

/**
 * Determines whether a MarketplaceSource is a command source (type guard, used by policy/reconcile).
 */
export function isCommandSource(
	source: MarketplaceSource,
): source is CommandMarketplaceSource {
	return source.source === "command";
}

/**
 * Runs the command source's command -> takes stdout as the directory path -> verifies it exists and is a directory.
 * Returns the resolved absolute directory path (equivalent to a directory source path).
 *
 * fail-visible (Rule 12): timeout/non-zero exit/empty output/non-directory all throw, no silent degradation.
 * Callers (future materialization wiring) must convert exceptions into PluginError, never swallow them.
 */
export async function resolveCommandSource(
	source: CommandMarketplaceSource,
): Promise<ResolvedCommandSource> {
	const cwd = source.cwd ? resolve(source.cwd) : undefined;
	logForDebugging(
		`command source: running "${source.command}"${cwd ? ` in ${cwd}` : ""}`,
	);

	// P1-12: reject shell metacharacters (injection surface — chained commands/pipes/redirects/command substitution).
	// The command source contract = run a single trusted command to get a directory path (e.g. `which myplugin`); complex
	// shell semantics (pipes/chaining/`$()`) are not this source's purpose and are an injection vector — reject. Single-process
	// commands keep the shell:true interface (echo/pwd/printf quoting semantics); the metacharacter gate = the security boundary.
	if (SHELL_OPERATOR_RE.test(source.command)) {
		throw new Error(
			`command source rejected: shell operators not allowed (injection risk) — "${source.command}". ` +
				`Use a single command without pipes/redirects/chaining; complex commands belong in the executor sandbox.`,
		);
	}

	// execa shell:true runs a single command string (already past the metacharacter gate, no chaining/injection).
	const result = await execFileNoThrowWithCwd(source.command, [], {
		cwd,
		timeout: COMMAND_TIMEOUT_MS,
		shell: true,
	});

	if (result.code !== 0) {
		throw new Error(
			`command source exited ${result.code}: "${source.command}"` +
				(result.stderr ? ` — stderr: ${result.stderr.trim()}` : ""),
		);
	}

	const rawPath = result.stdout.trim();
	if (rawPath.length === 0) {
		throw new Error(
			`command source produced empty output: "${source.command}"`,
		);
	}

	const directoryPath = resolve(rawPath);

	// Verify it exists and is a directory — the command should print a directory, not a file/nonexistent path.
	let stats: { isDirectory(): boolean } | undefined;
	try {
		stats = await stat(directoryPath);
	} catch (error) {
		throw new Error(
			`command source printed inaccessible path "${directoryPath}": ${error}`,
		);
	}
	if (!stats.isDirectory()) {
		throw new Error(
			`command source printed non-directory path: "${directoryPath}"`,
		);
	}

	logForDebugging(`command source resolved to: ${directoryPath}`);
	return { directoryPath };
}

/**
 * command source -> equivalent directory source (materialized form).
 * For when the addMarketplaceSource stub is filled in later: converts a command source to a directory
 * source that goes through the existing directory materialization path (reads .claude-plugin/marketplace.json).
 */
export async function commandSourceToDirectorySource(
	source: CommandMarketplaceSource,
): Promise<{ source: "directory"; path: string }> {
	const { directoryPath } = await resolveCommandSource(source);
	return { source: "directory", path: directoryPath };
}
