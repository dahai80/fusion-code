// D1 trajectory flywheel — shared types (issue #50/#51)
//
// Data source: ~/.fusion-code/projects/<cwd-slug>/<session-id>.jsonl
// One event per line, type ∈ {user, assistant, queue-operation, attachment, ...}
// assistant.message.content = block[]: text | tool_use | thinking
// user.message.content      = block[]: tool_result (is_error available natively) | str
// Pairing: assistant.tool_use.id ↔ user.tool_result.tool_use_id

// A single tool_use (from assistant)
export interface ToolCall {
	id: string;
	name: string;
	input: unknown;
}

// A single tool_result (from user, paired with ToolCall by id)
export interface ToolResult {
	toolUseId: string;
	isError: boolean;
	content: string;
}

// A cleaned single-step trajectory: one round user→assistant→(tool loop)→final
export interface TrajectoryStep {
	role: "user" | "assistant";
	text: string;
	thinking?: string;
	toolCalls?: ToolCall[];
	toolResults?: ToolResult[];
}

// Label category: successful positive / self-correction candidate
export type TrajectoryLabel = "positive" | "self_correction";

// A collected single-session trajectory
export interface CollectedTrajectory {
	source: string;
	sessionId: string;
	product: string;
	cwd?: string;
	steps: TrajectoryStep[];
	label: TrajectoryLabel;
	toolUseCount: number;
	toolErrorCount: number;
	hasSubagents: boolean;
}

// Single manifest record
export interface ManifestEntry {
	source: string;
	sessionId: string;
	product: string;
	label: TrajectoryLabel;
	toolUseCount: number;
	toolErrorCount: number;
	stepCount: number;
	hasSubagents: boolean;
}

// Manifest file structure
export interface TrajectoryManifest {
	version: number;
	generatedAt: string;
	destDir: string;
	sessions: ManifestEntry[];
	totals: {
		sessions: number;
		steps: number;
		toolUse: number;
		toolError: number;
		positive: number;
		selfCorrection: number;
	};
}

// Export format
export type ExportFormat = "sft" | "dpo" | "grpo";

// SFT sample (ShareGPT messages-JSONL)
export interface SFTSample {
	messages: { role: "system" | "user" | "assistant"; content: string }[];
	source: string;
}

// DPO preference pair
export interface DPOPair {
	prompt: string;
	chosen: string;
	rejected: string;
	source: string;
}

// GRPO prompt + reward signal
export interface GRPOSample {
	prompt: string;
	completion: string;
	reward: number;
	source: string;
}

// Collect options
export interface CollectOptions {
	sourceDir: string;
	destDir: string;
	product?: string;
}

// Export options
// storeDir  = collection store directory (where manifest.json + raw/ live), preferred
// sourceDir = legacy-caller compat: used as the store fallback if storeDir is
// not passed
// destDir   = output directory (where sft/dpo/grpo.jsonl are written)
export interface ExportOptions {
	sourceDir: string;
	destDir: string;
	format: ExportFormat;
	sessionId?: string;
	storeDir?: string;
}
