import {
	buildKB,
	getKBStatus,
	queryKB,
	resetKB,
} from "../../services/knowledgeBase/index.js";
import { logForDebugging } from "../../utils/debug.js";

function parseArgs(args: string): {
	subcommand: string;
	rest: string;
} {
	const parts = args.trim().split(/\s+/);
	const subcommand = parts[0] || "status";
	const rest = parts.slice(1).join(" ");
	return { subcommand, rest };
}

export async function execute(
	args: string,
	getCwd: () => string,
): Promise<string> {
	const { subcommand, rest } = parseArgs(args);
	const cwd = getCwd();

	switch (subcommand) {
		case "build":
			return buildKB(cwd);
		case "query":
		case "search":
			if (!rest) return "Usage: /kb query <search text>";
			return queryKB(cwd, rest);
		case "status":
			return handleStatus(cwd);
		case "reset":
			return resetKB(cwd);
		case "help":
		default:
			return usage();
	}
}

async function handleStatus(cwd: string): Promise<string> {
	const status = await getKBStatus(cwd);
	const lines: string[] = ["📚 Knowledge Base Status", ""];

	if (status.exists) {
		lines.push(`  Entries: ${status.entryCount}`);
		lines.push(`  Sources: ${status.sources.length}`);
		if (status.sources.length > 0 && status.sources.length <= 20) {
			for (const s of status.sources) {
				lines.push(`    • ${s}`);
			}
		}
	} else {
		lines.push("  Not built yet. Run /kb build to create.");
	}

	logForDebugging(
		`kb: status — ${status.entryCount} entries, ${status.sources.length} sources`,
	);
	return lines.join("\n");
}

function usage(): string {
	return [
		"/kb — Local knowledge base management",
		"",
		"Usage:",
		"  /kb build         Build KB from project files",
		"  /kb query <text>  Search the knowledge base",
		"  /kb status        Show KB status",
		"  /kb reset         Clear the knowledge base",
		"",
		"Storage: .fusion/kb/ in project root",
		"Requires: MLX running for embedding generation",
	].join("\n");
}
