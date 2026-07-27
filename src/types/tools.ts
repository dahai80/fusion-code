import type { TaskType } from "../Task.js";
import type { AgentId } from "./ids.js";
import type {
	NormalizedAssistantMessage,
	NormalizedUserMessage,
} from "./message.js";

export type MCPProgress = {
	type: "mcp_progress";
	status: "started" | "progress" | "completed" | "failed";
	serverName: string;
	toolName: string;
	progress?: number;
	total?: number;
	progressMessage?: string;
	elapsedTimeMs?: number;
};

export type WebSearchProgress =
	| {
			type: "query_update";
			query: string;
	  }
	| {
			type: "search_results_received";
			query: string;
			resultCount: number;
	  };

export type BashProgress = {
	type: "bash_progress";
	output: string;
	fullOutput: string;
	elapsedTimeSeconds: number;
	totalLines: number;
	totalBytes?: number;
	taskId?: string;
	timeoutMs?: number;
};

export type PowerShellProgress = {
	type: "powershell_progress";
	output: string;
	fullOutput: string;
	elapsedTimeSeconds: number;
	totalLines: number;
	totalBytes?: number;
	taskId?: string;
	timeoutMs?: number;
};

export type ShellProgress = BashProgress | PowerShellProgress;

export type AgentToolProgress = {
	type: "agent_progress";
	message: NormalizedUserMessage | NormalizedAssistantMessage;
	prompt: string;
	agentId: AgentId;
};

export type SkillToolProgress = {
	type: "skill_progress";
	message: NormalizedUserMessage | NormalizedAssistantMessage;
	prompt: string;
	agentId: AgentId;
};

export type TaskOutputProgress = {
	type: "waiting_for_task";
	taskDescription: string;
	taskType: TaskType;
};

export type REPLToolProgress = {
	type: "repl_progress";
};

export type SdkWorkflowProgress = {
	type: "phase_started" | "phase_completed" | "phase_failed";
	index: number;
	name: string;
	status: "running" | "completed" | "failed";
};

export type ToolProgressData =
	| MCPProgress
	| WebSearchProgress
	| BashProgress
	| PowerShellProgress
	| AgentToolProgress
	| SkillToolProgress
	| TaskOutputProgress
	| REPLToolProgress
	| SdkWorkflowProgress;
