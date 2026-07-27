import type {
	CommandContext,
	LocalCommandResult,
} from "../../types/command.js";
import {
	approveForSession,
	cancelSessionRules,
	getSessionApprovedTools,
} from "../../utils/permissions/approvalRuntime.js";

export async function execute(
	_context: CommandContext,
	args?: string,
): Promise<LocalCommandResult> {
	const trimmed = args?.trim() ?? "";

	if (trimmed === "--clear") {
		const ok = cancelSessionRules();
		return {
			type: "text",
			value: ok
				? "All session-scoped permission rules have been cleared."
				: "Failed to clear session rules.",
		};
	}

	if (trimmed === "--list") {
		const tools = getSessionApprovedTools();
		if (tools.length === 0) {
			return { type: "text", value: "No session-scoped approvals active." };
		}
		return {
			type: "text",
			value: `Session-approved tools:\n${tools.map((t) => `  - ${t}`).join("\n")}`,
		};
	}

	if (!trimmed) {
		return {
			type: "text",
			value:
				"Usage:\n" +
				"  /approve-session <tool-name>  — Auto-approve a tool for this session\n" +
				"  /approve-session --clear      — Clear all session approvals\n" +
				"  /approve-session --list       — List current session approvals",
		};
	}

	const parts = trimmed.split(/\s+/);
	const toolName = parts[0]!;
	const ruleContent = parts.length > 1 ? parts.slice(1).join(" ") : undefined;

	const ok = approveForSession(toolName, ruleContent);
	return {
		type: "text",
		value: ok
			? `Approved "${toolName}${ruleContent ? `(${ruleContent})` : ""}" for this session.`
			: `Failed to approve "${toolName}" for this session.`,
	};
}
