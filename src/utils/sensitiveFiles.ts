/**
 * Sensitive file protection — prevent AI from reading protected paths.
 *
 * Files matching these patterns are globally denied regardless of
 * tool permissions or FUSION.rules configuration. This cannot be
 * overridden by any rule.
 */

import { lstat, realpath } from "node:fs/promises";
import { normalize } from "node:path";

const SENSITIVE_PATTERNS: RegExp[] = [
	/\.env$/i,
	/\.env\./i,
	/\.env~/i,
	// audit-0902 P1-2: direnv .envrc — holds shell-injected secrets (export FOO=...),
	// loaded by direnv on cd. `\.env\.` needs a literal dot after `.env`; `.envrc`
	// is `.env`+`rc` (no dot) so it slipped past. Anchored to catch any path
	// ending in `.envrc`.
	/\.envrc$/i,
	/\.env_local$/i,
	/\.env_production$/i,
	/\.env_staging$/i,
	/id_rsa/i,
	/id_ed25519/i,
	/id_ecdsa/i,
	/id_dsa/i,
	/\.ssh\/config$/i,
	/\.ssh\/authorized_keys$/i,
	/\.ssh\/known_hosts$/i,
	/\.pem$/i,
	/\.key$/i,
	/\.p12$/i,
	/\.pfx$/i,
	/\.jks$/i,
	/\.keystore$/i,
	/credentials\.json$/i,
	/service-account.*\.json$/i,
	/aws.*credentials/i,
	/\.aws\/credentials$/i,
	/\.aws\/config$/i,
	/\.npmrc$/i,
	/\.pypirc$/i,
	/\/\.gitconfig$/i,
	/\.netrc$/i,
	/\.kube\/config$/i,
	/\.docker\/config\.json$/i,
	/\.git-credentials$/i,
	/\.github-token$/i,
	// audit-0903 P2 SEC-3: additional secret-bearing files that slipped past
	// the prior pattern list. Each holds plaintext credentials readable by a
	// single `cat`, so deny them like the SSH/AWS entries above.
	/\.pgpass$/i, // PostgreSQL .pgpass — host:port:db:user:password
	/\.my\.cnf$/i, // MySQL client creds (user/password under [client])
	/\.htpasswd$/i, // Apache basic-auth htpasswd — bcrypt/MD5 hashes
	/\.secret$/i, // generic .secret / Rails secrets.yml key files
	/\.token$/i, // generic .token — catch-all for API token files
	/\.passwd$/i, // Dovecot .passwd / shadow-adjacent credential files
	// P0-1 (audit R1): API server auth token — ~/.fusion-code/server.token (mode 0600).
	// Reading this token gives AI full control of the local API server (/api/code/generate + WS chat spawning subprocesses = RCE).
	// Without protection the token leaks via FileRead/Bash cat. Anchoring the trailing `server.token` covers same-named files in any directory.
	/server\.token$/i,
];

const SENSITIVE_DIR_PATTERNS: RegExp[] = [
	/\/\.ssh$/i,
	/\/\.ssh\//i,
	/\/\.gnupg$/i,
	/\/\.gnupg\//i,
	/\/\.aws$/i,
	/\/\.aws\//i,
	/\/\.kube$/i,
	/\/\.kube\//i,
	/\/\.fusion-code\/audit$/i,
	/\/\.fusion-code\/audit\//i,
];

export function isSensitiveFilePath(filePath: string): boolean {
	const normalized = normalize(filePath);
	for (const pattern of SENSITIVE_PATTERNS) {
		if (pattern.test(normalized)) return true;
	}
	for (const pattern of SENSITIVE_DIR_PATTERNS) {
		if (pattern.test(normalized)) return true;
	}
	return false;
}

// P2-1: symlink traversal guard. isSensitiveFilePath only operates on the path string — after
// `ln -s ~/.env ./link`, the normalized `./link` string contains no `.env`, so the gate sees a
// harmless path while the AI sees sensitive content.
// This async helper resolves symlinks: lstat probe → if a symlink, realpath resolves the real target →
// reject if the real target matches a sensitive pattern; reject on realpath failure (broken link, cannot determine = fail-closed).
// A nonexistent path (ENOENT) is not traversal → return false (not a symlink, just a normally missing file).
// Call sites add this check on top of the isSensitiveFilePath string check (the string check remains the fast-path short circuit).
export async function isSymlinkBypassingSensitiveGate(
	filePath: string,
): Promise<boolean> {
	try {
		const stats = await lstat(filePath);
		if (!stats.isSymbolicLink()) return false; // not a symlink → string check suffices
		// Symlink: realpath resolves the final target, then test sensitive patterns
		const resolved = await realpath(filePath);
		return isSensitiveFilePath(resolved);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return false; // target does not exist, not traversal
		// Broken link (ELOOP/other) → real target undeterminable, reject fail-closed
		if (code === "ELOOP" || code === "EINVAL" || code === "ENOTDIR") {
			return true;
		}
		// Other errors (permissions etc.) rejected conservatively to avoid silently letting them through
		return true;
	}
}

// P0-5: extract candidate file-path tokens from a Bash command string for the
// sensitive-file gate. The Bash tool's `command` arg bypassed the gate (which
// only inspected file_path/edits[]), so `cat ~/.ssh/id_rsa` or
// `grep x .env` reached secrets unblocked. This pulls path-looking operands —
// tokens containing a path separator, or bare filenames matching a sensitive
// basename (`.env`, `id_rsa`, `credentials.json`) — without re-implementing a
// shell parser: split on whitespace/operators, strip surrounding quotes, drop
// command verbs and flags. Conservative on purpose: a false positive blocks a
// legitimate read (loud, reversible); a false negative leaks a secret.
const SENSITIVE_BASENAMES = [
	".env",
	// audit-0902 P1-2: direnv .envrc — same miss as SENSITIVE_PATTERNS; the Bash
	// command-token extractor (addCandidate) only flags bare names in this list,
	// so `cat ~/.envrc` reached the secret unblocked.
	".envrc",
	"id_rsa",
	"id_ed25519",
	"id_ecdsa",
	"id_dsa",
	"credentials.json",
	".npmrc",
	".pypirc",
	".netrc",
	".git-credentials",
	".github-token",
	// P0-1 (audit R1): guards Bash extraction of `cat ~/.fusion-code/server.token`
	"server.token",
];

// P0-1 (audit 0901): shells pass `bash -c '<script>'` — the script body lives
// inside ONE quoted token. The old splitter split that single token out of its
// surrounding pair and was done, leaving `cat ~/.env'` (trailing quote) which
// regex `\.env$` did NOT match → secret leaked. Fix is two-part:
//   1. Aggressive leading/trailing quote strip (any run of ' or ") so a single
//      dangling quote can't survive into the pattern test.
//   2. `bash -c`/`sh -c`/`zsh -c`/`-c` script recursion — after stripping the
//      `-c` wrapper quotes, re-scan the script body for path tokens. Without
//      this, `bash -c 'cat ~/.ssh/id_rsa'` hides the key path one level down.
// Loop-bounded (script nesting depth cap) so a crafted `bash -c 'bash -c ...'`
// chain can't recurse forever.
const SHELL_C_FLAGS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const MAX_SCRIPT_DEPTH = 4;

function stripQuotes(tok: string): string {
	let s = tok;
	// strip any leading run of quotes, then any trailing run of quotes.
	// `bash -c 'cat ~/.env'` → after split the -c operand is `'cat ~/.env'`;
	// we want `cat ~/.env`. Aggressive strip also kills a lone dangling quote
	// that survived a partial split (`~/.env'`).
	s = s.replace(/^['"]+/, "").replace(/['"]+$/, "");
	return s;
}

export function extractCandidatePathsFromCommand(command: string): string[] {
	const candidates: string[] = [];
	const seen = new Set<string>();
	const addCandidate = (tok: string) => {
		if (!tok) return;
		if (tok.startsWith("-")) return;
		const looksLikePath = tok.includes("/") || tok.includes("\\");
		const matchesSensitiveBasename = SENSITIVE_BASENAMES.some(
			(b) => tok === b || tok.endsWith(`/${b}`) || tok.endsWith(`\\${b}`),
		);
		if (!looksLikePath && !matchesSensitiveBasename) return;
		if (seen.has(tok)) return;
		seen.add(tok);
		candidates.push(tok);
	};

	const scan = (cmd: string, depth: number) => {
		if (depth > MAX_SCRIPT_DEPTH) return;
		const tokens = cmd.split(/[\s|&;<>]+/).filter(Boolean);
		for (let i = 0; i < tokens.length; i++) {
			const raw = tokens[i];
			const tok = stripQuotes(raw);
			if (!tok) continue;
			// `-c '<script>'` recursion: when we see a shell verb followed by
			// `-c`, the NEXT token is the inline script — strip its quotes and
			// recurse into it (its own path tokens + nested -c).
			if (SHELL_C_FLAGS.has(tok) || tok === "-c") {
				// find the -c flag position
				let j = i;
				if (SHELL_C_FLAGS.has(tok)) {
					// advance to -c
					if (i + 1 < tokens.length && stripQuotes(tokens[i + 1]) === "-c") {
						j = i + 1;
					} else {
						continue;
					}
				}
				// script token follows -c
				if (j + 1 < tokens.length) {
					const scriptBody = stripQuotes(tokens[j + 1]);
					if (scriptBody) scan(scriptBody, depth + 1);
				}
				continue;
			}
			addCandidate(tok);
		}
	};

	scan(command, 0);
	return candidates;
}

export function getSensitiveFileDenialMessage(filePath: string): string {
	return `Access to "${filePath}" is denied by security policy. This file matches a sensitive path pattern (secrets, keys, or credentials) and cannot be read by AI.`;
}
