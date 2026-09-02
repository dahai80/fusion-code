/**
 * Fusion Gateway Audit Log — persistent local operation audit trail.
 *
 * All file read/write, terminal commands, and MCP requests are logged
 * to ~/.fusion-code/audit/ for full traceability of AI actions.
 *
 * Log format: JSONL, one entry per line, appended atomically.
 * Rotation: files rotate when exceeding maxFileSize (default 10MB).
 */

import { chmod, mkdir, open, readdir, stat, unlink, writeFile } from "fs/promises";
import { O_APPEND, O_CREAT, O_NOFOLLOW, O_WRONLY } from "node:constants";
import { join } from "path";
import { logForDebugging } from "../../utils/debug.js";
import { getClaudeConfigHomeDir } from "../../utils/envUtils.js";

export type AuditLogEntry = {
	timestamp: string;
	session_id: string;
	tool_name: string;
	operation: "read" | "write" | "execute" | "mcp_call" | "denied" | "skill_write";
	target: string;
	detail?: string;
	success: boolean;
	error?: string;
	duration_ms?: number;
};

const AUDIT_DIR_NAME = "audit";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_AUDIT_FILES = 30; // Keep 30 rotated files
const AUDIT_FILE_PREFIX = "audit-";

function getAuditDir(): string {
	return join(getClaudeConfigHomeDir(), AUDIT_DIR_NAME);
}

function getAuditFilePath(): string {
	const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
	return join(getAuditDir(), `${AUDIT_FILE_PREFIX}${date}.jsonl`);
}

async function ensureAuditDir(): Promise<void> {
	const dir = getAuditDir();
	try {
		// P2-17: 目录 0700 非 0755。审计文件 0600 但 0755 目录下任何同用户进程
		// 可 readdir/unlink 条目 → 轮转/防篡改失效。0700 仅属主可遍历+移除。
		await mkdir(dir, { recursive: true, mode: 0o700 });
		// mode 受 umask 影响 (mkdir mode 是 creation mask), 显式 chmod 锁定。
		await chmod(dir, 0o700).catch(() => {});
	} catch (e) {
		const code = (e as NodeJS.ErrnoException).code;
		if (code !== "EEXIST") {
			logForDebugging(`auditLog: failed to create dir ${dir}: ${code}`);
		}
	}
}

async function shouldRotate(filePath: string): Promise<boolean> {
	try {
		const s = await stat(filePath);
		return s.size >= MAX_FILE_SIZE;
	} catch {
		return false;
	}
}

async function rotateIfNeeded(): Promise<void> {
	const filePath = getAuditFilePath();
	if (!(await shouldRotate(filePath))) return;

	const rotatedPath = filePath.replace(".jsonl", `-${Date.now()}.jsonl`);
	try {
		const { rename } = await import("fs/promises");
		await rename(filePath, rotatedPath);
		logForDebugging(`auditLog: rotated ${filePath} -> ${rotatedPath}`);
	} catch (e) {
		logForDebugging(`auditLog: rotation failed: ${(e as Error).message}`);
	}

	// Prune old files beyond MAX_AUDIT_FILES
	try {
		const dir = getAuditDir();
		const entries = await readdir(dir);
		const auditFiles = entries
			.filter((e) => e.startsWith(AUDIT_FILE_PREFIX) && e.endsWith(".jsonl"))
			.sort()
			.reverse();
		if (auditFiles.length > MAX_AUDIT_FILES) {
			const toDelete = auditFiles.slice(MAX_AUDIT_FILES);
			for (const f of toDelete) {
				await unlink(join(dir, f)).catch(() => {});
			}
			logForDebugging(`auditLog: pruned ${toDelete.length} old audit files`);
		}
	} catch {
		// Non-critical
	}
}

// P1-13: 审计写失败的不可恢复 errno — fail-closed (重抛让调用方决定阻断)。
// 攻击者填满磁盘 (ENOSPC) / 只读挂载 (EROFS) / 权限收回 (EACCES) → 审计轨迹静默
// 丢失, "审计失败" 与 "无工具调用" 读时不可区分, 破坏不可否认性。这些 errno = 审计
// 无法保证, 重抛。瞬时/可恢复错误 (EMFILE/EAGAIN/ENOTEMPTY 轮转竞态) 仍 fail-open
// (记 debug 日志), 避免偶发噪声拖垮主路径。
const AUDIT_FAIL_CLOSED_CODES = new Set([
	"EACCES",
	"ENOSPC",
	"EROFS",
	"EDQUOT",
	"ENOTDIR",
	"EISDIR",
	// audit-0902 P1-3: O_NOFOLLOW rejects a symlinked audit file with ELOOP —
	// a tampering attempt, audit integrity cannot be guaranteed, fail-closed.
	"ELOOP",
]);

export async function appendAuditLog(entry: AuditLogEntry): Promise<void> {
	try {
		await ensureAuditDir();
		await rotateIfNeeded();
		const line = JSON.stringify(entry) + "\n";
		// audit-0902 P1-3: appendFile follows symlinks. A same-user process that
		// swaps audit-YYYY-MM-DD.jsonl for a symlink (dir 0700 blocks creation
		// but NOT same-user swap of an existing entry) would redirect audit
		// appends into an attacker-chosen target — silently losing the audit
		// trail or corrupting another file. O_NOFOLLOW opens the path itself
		// only if it is NOT a symlink (ELOOP otherwise), so the audit file
		// cannot be hijacked mid-session. O_APPEND preserves atomic append
		// semantics. Mode 0600 = owner-only.
		const handle = await open(getAuditFilePath(), O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW, 0o600);
		try {
			await writeFile(handle, line);
		} finally {
			await handle.close();
		}
	} catch (e) {
		const code = (e as NodeJS.ErrnoException).code;
		const msg = (e as Error).message;
		// P1-13: 不可恢复 fs 错 → fail-closed (审计无法保证, 重抛 surfacing)。
		if (code && AUDIT_FAIL_CLOSED_CODES.has(code)) {
			logForDebugging(
				`auditLog: fail-closed append (${code}): ${msg} — rethrowing, audit integrity cannot be guaranteed`,
			);
			throw new Error(
				`audit log write failed (${code}): audit integrity cannot be guaranteed — refusing to proceed silently`,
			);
		}
		// 瞬时/可恢复错误 → fail-open (记日志, 不阻断主路径)。
		logForDebugging(`auditLog: failed to append: ${msg}`);
	}
}

// Credential redaction — mask secret families before persisting to audit JSONL.
// item 22 (CC 2.1.224 sandbox credential awareness): audit log target/detail/error
// may carry embedded tokens (e.g. `curl -H "Authorization: Bearer eyJ..."` in a
// 200-char command slice). Mask to <prefix4>…<suffix4> so the format stays
// recognizable but the secret is unrecoverable. Non-matching text passes through.
// Single-pass combined alternation — each secret span matched exactly once, so
// no later pattern re-masks an already-masked prefix (the bug with a chained
// .replace loop: Bearer would re-mask the leading eyJ… of a JWT Bearer token).
// Alternation order is irrelevant for overlap: the regex scans left-to-right,
// so for `Authorization: Bearer <jwt>` the Bearer branch wins (Bearer appears
// before eyJ), masking the whole token — equivalent result to the JWT branch.
// P1-9 (audit R16): expanded with 6 more families — sk-ant-api03 (Anthropic),
// gh[pousr]_ (GitHub PAT/app/oauth/refresh), xox[abprs]- (Slack), glpat-
// (GitLab), and multiline PEM `-----BEGIN…PRIVATE KEY-----`. Patterns reused
// from src/services/teamMemorySync/secretScanner.ts (single source of truth).
const SECRET_RE =
	/(\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b)|(\bBearer\s+[A-Za-z0-9._~+/=-]+)|(X-Amz-Signature=[0-9a-fA-F]+)|([xX]-[aA][pP][iI]-[kK][eE][yY]:\s*[^\s,;]+)|(Authorization:\s*Basic\s+[A-Za-z0-9._~+/=-]+)|(\bsk-ant-[A-Za-z0-9_-]{20,})|(\bgh[pousr]_[A-Za-z0-9]{36,})|(\bxox[abprs]-[0-9]{10,13}-[0-9]{10,13}[A-Za-z0-9-]*)|(\bglpat-[A-Za-z0-9_-]{20})|(-----BEGIN[A-Z0-9_ -]{0,100}PRIVATE KEY(?: BLOCK)?-----[\s\S]{64,}?-----END[A-Z0-9_ -]{0,100}PRIVATE KEY(?: BLOCK)?-----)/g;

function maskSecretSpan(match: string): string {
	if (match.startsWith("Bearer")) {
		return `Bearer ${maskMiddle(match.slice("Bearer".length).trim())}`;
	}
	if (match.startsWith("Authorization: Basic")) {
		return `Authorization: Basic ${maskMiddle(
			match.slice("Authorization: Basic".length).trim(),
		)}`;
	}
	if (match.toLowerCase().startsWith("x-api-key:")) {
		const val = match.slice(match.indexOf(":") + 1).trim();
		return `x-api-key: ${maskMiddle(val)}`;
	}
	if (match.startsWith("X-Amz-Signature=")) {
		return `X-Amz-Signature=${maskMiddle(match.slice("X-Amz-Signature=".length))}`;
	}
	// JWT (standalone, starts eyJ)
	return maskMiddle(match);
}

function maskMiddle(secret: string): string {
	if (secret.length <= 8) {
		return `${secret.slice(0, 2)}…${secret.slice(-2)}`;
	}
	return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

export function redactSecrets(input: string): string {
	if (!input) {
		return input;
	}
	return input.replace(SECRET_RE, maskSecretSpan);
}

export function createAuditEntry(
	sessionId: string,
	toolName: string,
	operation: AuditLogEntry["operation"],
	target: string,
	opts?: {
		detail?: string;
		success?: boolean;
		error?: string;
		duration_ms?: number;
	},
): AuditLogEntry {
	return {
		timestamp: new Date().toISOString(),
		session_id: sessionId,
		tool_name: toolName,
		operation,
		target: redactSecrets(target),
		detail: opts?.detail ? redactSecrets(opts.detail) : undefined,
		success: opts?.success ?? true,
		error: opts?.error ? redactSecrets(opts.error) : undefined,
		duration_ms: opts?.duration_ms,
	};
}

// Operation rate limiter — prevent AI from bulk destructive actions
const operationCounts = new Map<
	string,
	{ count: number; windowStart: number }
>();

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const DEFAULT_MAX_OPERATIONS = 50; // Max operations per window per type
const RATE_LIMIT_PRUNE_INTERVAL_MS = 5 * 60_000; // Prune stale entries every 5 min
let lastPruneTime = 0;

function pruneStaleRateLimitEntries(now: number): void {
	if (now - lastPruneTime < RATE_LIMIT_PRUNE_INTERVAL_MS) return;
	lastPruneTime = now;
	for (const [key, rec] of operationCounts) {
		if (now - rec.windowStart > RATE_LIMIT_WINDOW_MS) {
			operationCounts.delete(key);
		}
	}
}

export function checkOperationRateLimit(
	operationType: string,
	maxOps: number = DEFAULT_MAX_OPERATIONS,
): { allowed: boolean; currentCount: number; maxOps: number } {
	const now = Date.now();
	pruneStaleRateLimitEntries(now);
	const record = operationCounts.get(operationType);

	if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
		operationCounts.set(operationType, { count: 1, windowStart: now });
		return { allowed: true, currentCount: 1, maxOps };
	}

	record.count++;
	if (record.count > maxOps) {
		logForDebugging(
			`auditLog: rate limit hit for ${operationType}: ${record.count}/${maxOps}`,
		);
		return { allowed: false, currentCount: record.count, maxOps };
	}

	return { allowed: true, currentCount: record.count, maxOps };
}

export function resetRateLimiter(): void {
	operationCounts.clear();
}
