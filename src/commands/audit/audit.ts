import { readdir, readFile } from "fs/promises";
import { join } from "path";
import type { AuditLogEntry } from "../../services/audit/index.js";
import { logForDebugging } from "../../utils/debug.js";
import { getClaudeConfigHomeDir } from "../../utils/envUtils.js";

type AuditFilter = {
	last?: number;
	tool?: string;
	op?: string;
};

function parseArgs(args: string): AuditFilter {
	const filter: AuditFilter = {};
	const parts = args.split(/\s+/);
	for (let i = 0; i < parts.length; i++) {
		if (parts[i] === "--last" && parts[i + 1]) {
			filter.last = parseInt(parts[i + 1], 10);
			i++;
		} else if (parts[i] === "--tool" && parts[i + 1]) {
			filter.tool = parts[i + 1];
			i++;
		} else if (parts[i] === "--op" && parts[i + 1]) {
			filter.op = parts[i + 1];
			i++;
		}
	}
	return filter;
}

export async function execute(args: string): Promise<string> {
	const filter = parseArgs(args);
	const auditDir = join(getClaudeConfigHomeDir(), "audit");

	let entries: string[];
	try {
		entries = await readdir(auditDir);
	} catch {
		return "No audit logs found. Audit logging starts automatically when tools are used.";
	}

	const auditFiles = entries
		.filter((e) => e.startsWith("audit-") && e.endsWith(".jsonl"))
		.sort()
		.reverse();

	if (auditFiles.length === 0) {
		return "No audit logs found.";
	}

	const logLines: string[] = [];
	const maxLines = filter.last ?? 50;

	for (const file of auditFiles) {
		if (logLines.length >= maxLines) break;
		try {
			const content = await readFile(join(auditDir, file), "utf-8");
			const lines = content.trim().split("\n").reverse();
			for (const line of lines) {
				if (logLines.length >= maxLines) break;
				if (!line.trim()) continue;
				try {
					const entry: AuditLogEntry = JSON.parse(line);
					if (filter.tool && entry.tool_name !== filter.tool) continue;
					if (filter.op && entry.operation !== filter.op) continue;

					const status = entry.success ? "✅" : "❌";
					const dur = entry.duration_ms ? ` (${entry.duration_ms}ms)` : "";
					const err = entry.error ? ` ERROR: ${entry.error}` : "";
					logLines.push(
						`${status} [${entry.timestamp}] ${entry.tool_name} ${entry.operation} ${entry.target}${dur}${err}`,
					);
				} catch {
					// Skip malformed lines
				}
			}
		} catch (e) {
			logForDebugging(`audit: failed to read ${file}: ${(e as Error).message}`);
		}
	}

	if (logLines.length === 0) {
		return "No matching audit entries found.";
	}

	return `Audit Log (last ${logLines.length} entries):\n\n${logLines.join("\n")}`;
}
