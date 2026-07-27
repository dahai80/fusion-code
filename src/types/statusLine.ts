import type { VimMode } from "./textInputTypes.js";

type RateLimitWindow = {
	used_percentage: number;
	resets_at: number;
};

type RateLimits = {
	five_hour?: RateLimitWindow;
	seven_day?: RateLimitWindow;
};

type CurrentUsage = {
	input_tokens: number;
	output_tokens: number;
	cache_creation_input_tokens: number;
	cache_read_input_tokens: number;
} | null;

export type StatusLineCommandInput = {
	// Base hook input (from createBaseHookInput)
	session_id: string;
	transcript_path: string;
	cwd: string;
	permission_mode?: string;
	agent_id?: string;
	agent_type?: string;

	// Session
	session_name?: string;

	// Model
	model: {
		id: string;
		display_name: string;
	};

	// Workspace
	workspace: {
		current_dir: string;
		project_dir: string;
		added_dirs: string[];
	};

	// Version
	version: string;

	// Output style
	output_style: {
		name: string;
	};

	// Cost tracking
	cost: {
		total_cost_usd: number;
		total_duration_ms: number;
		total_api_duration_ms: number;
		total_lines_added: number;
		total_lines_removed: number;
	};

	// Context window
	context_window: {
		total_input_tokens: number;
		total_output_tokens: number;
		context_window_size: number;
		current_usage: CurrentUsage;
		used_percentage: number | null;
		remaining_percentage: number | null;
	};

	// Token threshold flag
	exceeds_200k_tokens: boolean;

	// Rate limits (optional, only present if at least one window has data)
	rate_limits?: RateLimits;

	// Vim mode (optional, only present when vim is enabled)
	vim?: {
		mode: VimMode;
	};

	// Agent type (optional, only present when running as an agent)
	agent?: {
		name: string;
	};

	// Remote mode (optional, only present when in remote mode)
	remote?: {
		session_id: string;
	};

	// Worktree session (optional, only present when in a worktree)
	worktree?: {
		name: string;
		path: string;
		branch?: string;
		original_cwd: string;
		original_branch?: string;
	};
};
