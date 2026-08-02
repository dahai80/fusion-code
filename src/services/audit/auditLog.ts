/**
 * Fusion Gateway Audit Log — persistent local operation audit trail.
 *
 * All file read/write, terminal commands, and MCP requests are logged
 * to ~/.fusion-code/audit/ for full traceability of AI actions.
 *
 * Log format: JSONL, one entry per line, appended atomically.
 * Rotation: files rotate when exceeding maxFileSize (default 10MB).
 */

import { appendFile, mkdir, readdir, stat, unlink } from "fs/promises";
import { join } from "path";
import { logForDebugging } from "../../utils/debug.js";
import { getClaudeConfigHomeDir } from "../../utils/envUtils.js";

export type AuditLogEntry = {
	timestamp: string;
	session_id: string;
	tool_name: string;
	operation: "read" | "write" | "execute" | "mcp_call" | "denied";
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
		await mkdir(dir, { recursive: true });
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

export async function appendAuditLog(entry: AuditLogEntry): Promise<void> {
	try {
		await ensureAuditDir();
		await rotateIfNeeded();
		const line = JSON.stringify(entry) + "\n";
		await appendFile(getAuditFilePath(), line, {
			mode: 0o600, // Owner read/write only
		});
	} catch (e) {
		logForDebugging(`auditLog: failed to append: ${(e as Error).message}`);
	}
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
		target,
		detail: opts?.detail,
		success: opts?.success ?? true,
		error: opts?.error,
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
