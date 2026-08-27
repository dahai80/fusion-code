/**
 * Sensitive file protection — prevent AI from reading protected paths.
 *
 * Files matching these patterns are globally denied regardless of
 * tool permissions or FUSION.rules configuration. This cannot be
 * overridden by any rule.
 */

import { normalize } from "path";

const SENSITIVE_PATTERNS: RegExp[] = [
	/\.env$/i,
	/\.env\./i,
	/\.env~/i,
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
];

export function extractCandidatePathsFromCommand(command: string): string[] {
	const tokens = command.split(/[\s|&;<>]+/).filter(Boolean);
	const candidates: string[] = [];
	const seen = new Set<string>();
	for (const raw of tokens) {
		// strip matching surrounding quotes
		let tok = raw;
		if (
			(tok.startsWith('"') && tok.endsWith('"')) ||
			(tok.startsWith("'") && tok.endsWith("'"))
		) {
			tok = tok.slice(1, -1);
		}
		if (!tok) continue;
		// skip flags (-x / --x) and command verbs (first token of a segment)
		if (tok.startsWith("-")) continue;
		const looksLikePath = tok.includes("/") || tok.includes("\\");
		const matchesSensitiveBasename = SENSITIVE_BASENAMES.some((b) =>
			tok === b || tok.endsWith("/" + b) || tok.endsWith("\\" + b),
		);
		if (!looksLikePath && !matchesSensitiveBasename) continue;
		if (seen.has(tok)) continue;
		seen.add(tok);
		candidates.push(tok);
	}
	return candidates;
}

export function getSensitiveFileDenialMessage(filePath: string): string {
	return `Access to "${filePath}" is denied by security policy. This file matches a sensitive path pattern (secrets, keys, or credentials) and cannot be read by AI.`;
}
