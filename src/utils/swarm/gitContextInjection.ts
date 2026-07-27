import { execFileSync } from "child_process";
import { logEvent } from "../../services/analytics/index.js";
import type { ScopedMcpServerConfig } from "../../services/mcp/config.js";
import { logForDebugging } from "../debug.js";

const AGENT_TYPES_THAT_NEED_GIT_CONTEXT = new Set([
	"researcher",
	"explorer",
	"reviewer",
	"code-reviewer",
	"security-reviewer",
	"audit",
]);

const MAX_COMMITS = 5;
const MAX_CHANGED_FILES = 20;

export function shouldInjectGitContext(agentType: string): boolean {
	return AGENT_TYPES_THAT_NEED_GIT_CONTEXT.has(agentType);
}

export interface GitContext {
	branch: string | null;
	recentCommits: string[];
	changedFiles: string[];
	stagedFiles: string[];
}

function gitExec(args: string[], cwd?: string): string | null {
	try {
		const opts = cwd
			? { cwd, encoding: "utf-8" as const }
			: { encoding: "utf-8" as const };
		return execFileSync("git", args, opts).trim() || null;
	} catch {
		return null;
	}
}

export function getGitContext(cwd?: string): GitContext {
	const result: GitContext = {
		branch: null,
		recentCommits: [],
		changedFiles: [],
		stagedFiles: [],
	};

	const branch = gitExec(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
	result.branch = branch;

	const log = gitExec(["log", "--oneline", `-${MAX_COMMITS}`], cwd);
	if (log) {
		result.recentCommits = log.split("\n");
	}

	const diff = gitExec(["diff", "--name-only", "HEAD"], cwd);
	if (diff) {
		const files = diff.split("\n");
		result.changedFiles = files.slice(0, MAX_CHANGED_FILES);
		if (files.length > MAX_CHANGED_FILES) {
			result.changedFiles.push(
				`... and ${files.length - MAX_CHANGED_FILES} more`,
			);
		}
	}

	const staged = gitExec(["diff", "--cached", "--name-only"], cwd);
	if (staged) {
		result.stagedFiles = staged.split("\n").slice(0, MAX_CHANGED_FILES);
	}

	return result;
}

export function formatGitContext(ctx: GitContext): string {
	const lines: string[] = ["<git_context>"];
	if (ctx.branch) {
		lines.push(`branch: ${ctx.branch}`);
	}
	if (ctx.recentCommits.length > 0) {
		lines.push("recent_commits:");
		for (const c of ctx.recentCommits) {
			lines.push(`  ${c}`);
		}
	}
	if (ctx.changedFiles.length > 0) {
		lines.push("changed_files:");
		for (const f of ctx.changedFiles) {
			lines.push(`  ${f}`);
		}
	}
	if (ctx.stagedFiles.length > 0) {
		lines.push("staged_files:");
		for (const f of ctx.stagedFiles) {
			lines.push(`  ${f}`);
		}
	}
	lines.push("</git_context>");
	lines.push(
		"Use this git context to focus your exploration on relevant branches and recent changes.",
	);
	return lines.join("\n");
}

export function getGitContextInjection(
	agentType: string,
	cwd?: string,
): string | null {
	if (!shouldInjectGitContext(agentType)) {
		return null;
	}
	const ctx = getGitContext(cwd);
	const hasData =
		ctx.branch || ctx.recentCommits.length > 0 || ctx.changedFiles.length > 0;
	if (!hasData) {
		return null;
	}
	logEvent("tengu_git_context_injected", {
		agent_type: agentType,
		branch: ctx.branch ?? "",
		commit_count: ctx.recentCommits.length,
		changed_file_count: ctx.changedFiles.length,
	});
	return formatGitContext(ctx);
}

const CHUB_AGENT_TYPES = new Set([
	"researcher",
	"explorer",
	"code-reviewer",
	"general-purpose",
]);

let _chubAvailable: boolean | null = null;

function isChubAvailable(): boolean {
	if (_chubAvailable !== null) return _chubAvailable;
	try {
		execFileSync("chub", ["--version"], { timeout: 3000, stdio: "pipe" });
		_chubAvailable = true;
	} catch {
		_chubAvailable = false;
		logForDebugging("[chub-hint] chub CLI not found, skipping hint injection");
	}
	return _chubAvailable;
}

export function getChubHint(): string | null {
	if (!isChubAvailable()) return null;
	if (
		typeof globalThis._currentAgentType === "string" &&
		!CHUB_AGENT_TYPES.has(globalThis._currentAgentType)
	) {
		return null;
	}
	return `<context_hub_hint>
When you need API documentation for a library or framework, use the CLI tool "chub" to fetch current, versioned docs:
- chub search "query" — find relevant docs
- chub get <id> --lang <py|js|go> — fetch docs by ID and language
Example: chub get openai/chat --lang py
This reduces API hallucination by providing verified, up-to-date documentation.
</context_hub_hint>`;
}

export function getChubMcpConfig(): ScopedMcpServerConfig | null {
	if (!isChubAvailable()) return null;
	return {
		type: "stdio" as const,
		command: "chub",
		args: ["mcp"],
		scope: "dynamic" as const,
	};
}
