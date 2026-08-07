// D1 轨迹飞轮 — 共享类型 (issue #50/#51)
//
// 数据源: ~/.fusion-code/projects/<cwd-slug>/<session-id>.jsonl
// 每行一条事件, type ∈ {user, assistant, queue-operation, attachment, ...}
// assistant.message.content = block[]: text | tool_use | thinking
// user.message.content      = block[]: tool_result (is_error 天然存在) | str
// 配对: assistant.tool_use.id ↔ user.tool_result.tool_use_id

// 单条 tool_use (来自 assistant)
export interface ToolCall {
	id: string;
	name: string;
	input: unknown;
}

// 单条 tool_result (来自 user, 与 ToolCall 按 id 配对)
export interface ToolResult {
	toolUseId: string;
	isError: boolean;
	content: string;
}

// 清洗后的单步轨迹: 一轮 user→assistant→(tool 循环)→final
export interface TrajectoryStep {
	role: "user" | "assistant";
	text: string;
	thinking?: string;
	toolCalls?: ToolCall[];
	toolResults?: ToolResult[];
}

// 标注类别: 成功正例 / 自纠正候选
export type TrajectoryLabel = "positive" | "self_correction";

// 汇聚后的单 session 轨迹
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

// manifest 单条记录
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

// manifest 文件结构
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

// 导出格式
export type ExportFormat = "sft" | "dpo" | "grpo";

// SFT 样本 (ShareGPT messages-JSONL)
export interface SFTSample {
	messages: { role: "system" | "user" | "assistant"; content: string }[];
	source: string;
}

// DPO 偏好对
export interface DPOPair {
	prompt: string;
	chosen: string;
	rejected: string;
	source: string;
}

// GRPO prompt + reward 信号
export interface GRPOSample {
	prompt: string;
	completion: string;
	reward: number;
	source: string;
}

// 收集选项
export interface CollectOptions {
	sourceDir: string;
	destDir: string;
	product?: string;
}

// 导出选项
// storeDir  = 汇聚库目录 (manifest.json + raw/ 所在), 优先使用
// sourceDir = 兼容旧调用: 若 storeDir 未传, 作为汇聚库回退
// destDir   = 输出目录 (sft/dpo/grpo.jsonl 写入处)
export interface ExportOptions {
	sourceDir: string;
	destDir: string;
	format: ExportFormat;
	sessionId?: string;
	storeDir?: string;
}
