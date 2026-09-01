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
	// P0-1 (audit R1): API server auth token — ~/.fusion-code/server.token (mode 0600).
	// AI 读该 token 即获本地 API server 控制权 (/api/code/generate + WS chat spawn 子进程 = RCE)。
	// 不纳入保护则 token 经 FileRead/Bash cat 泄露。锚定结尾 `server.token` 覆盖任意目录下的同名文件。
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

// P2-1: 符号链接穿透守卫。isSensitiveFilePath 仅操作路径字符串 — `ln -s ~/.env ./link`
// 后 `./link` 规范化串不含 `.env`, 守卫见无害路径但 AI 见敏感内容。
// 此 async helper 解析 symlink: lstat 探测 → 若符号链接则 realpath 解析真实目标 →
// 真实目标匹配敏感 pattern 则拒绝; realpath 失败 (断链) 则拒绝 (无法判定, fail-closed)。
// 路径不存在 (ENOENT) 不算穿透 → 返回 false (非符号链接, 正常缺失文件)。
// 调用点在 isSensitiveFilePath 字符串检查之外补充此检查 (字符串检查仍快路径短路)。
export async function isSymlinkBypassingSensitiveGate(
	filePath: string,
): Promise<boolean> {
	try {
		const stats = await lstat(filePath);
		if (!stats.isSymbolicLink()) return false; // 非符号链接 → 字符串检查已足够
		// 符号链接: realpath 解析最终目标, 再测敏感 pattern
		const resolved = await realpath(filePath);
		return isSensitiveFilePath(resolved);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return false; // 目标不存在, 非穿透
		// 断链 (ELOOP/其他) → 无法判定真实目标, fail-closed 拒绝
		if (code === "ELOOP" || code === "EINVAL" || code === "ENOTDIR") {
			return true;
		}
		// 其他错误 (权限等) 保守拒绝, 避免静默放过
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
	// P0-1 (audit R1): Bash `cat ~/.fusion-code/server.token` 提取守卫
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
			(b) => tok === b || tok.endsWith("/" + b) || tok.endsWith("\\" + b),
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
