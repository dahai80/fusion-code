// D1 轨迹飞轮 — 汇聚器 (issue #50)
//
// 扫描 ~/.fusion-code/projects/**/*.jsonl + subagents/, 解析配对 tool_use/tool_result,
// 按 is_error 标注 Positive / SelfCorrection, 写入统一汇聚目录 ~/.fusion/trajectories/。

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
	CollectedTrajectory,
	CollectOptions,
	ManifestEntry,
	ToolCall,
	ToolResult,
	TrajectoryManifest,
	TrajectoryStep,
} from "./types.js";

const log = (...args: unknown[]) => console.error("[trajectory]", ...args);

// jsonl 原始事件的最小子集
interface RawEvent {
	type?: string;
	message?: {
		role?: string;
		content?: unknown;
	};
	cwd?: string;
}

interface ContentBlock {
	type?: string;
	text?: string;
	thinking?: string;
	id?: string;
	name?: string;
	input?: unknown;
	tool_use_id?: string;
	is_error?: boolean;
	content?: unknown;
}

// 默认源目录: fusion-code session jsonl
export const DEFAULT_SOURCE_DIR = path.join(
	process.env.HOME ?? "~",
	".fusion-code",
	"projects",
);

// 默认汇聚目录
export const DEFAULT_DEST_DIR = path.join(
	process.env.HOME ?? "~",
	".fusion",
	"trajectories",
);

export const MANIFEST_VERSION = 1;

// 读取并解析单个 jsonl 文件为 RawEvent 列表 (跳过无法解析的行)
async function readJsonl(filePath: string): Promise<RawEvent[]> {
	const content = await fs.readFile(filePath, "utf8");
	const events: RawEvent[] = [];
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			events.push(JSON.parse(trimmed) as RawEvent);
		} catch (e) {
			log(`skip unparseable line in ${filePath}: ${(e as Error).message}`);
		}
	}
	return events;
}

// 把 content (string | block[]) 归一为 block[]
function toBlocks(content: unknown): ContentBlock[] {
	if (typeof content === "string") {
		return content ? [{ type: "text", text: content }] : [];
	}
	if (Array.isArray(content)) {
		return content as ContentBlock[];
	}
	return [];
}

// block 内容转字符串 (tool_result.content 可能是 string 或 block[])
function blockContentToString(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((b) =>
				typeof b === "string"
					? b
					: ((b as ContentBlock)?.text ?? JSON.stringify(b)),
			)
			.join("");
	}
	return content == null ? "" : JSON.stringify(content);
}

// 解析单 session 事件序列为清洗后的 steps + 统计
function parseSession(
	events: RawEvent[],
	_source: string,
	_sessionId: string,
	_product: string,
	_cwd?: string,
): { steps: TrajectoryStep[]; toolUseCount: number; toolErrorCount: number } {
	const steps: TrajectoryStep[] = [];
	let toolUseCount = 0;
	let toolErrorCount = 0;

	for (const ev of events) {
		if (ev.type !== "user" && ev.type !== "assistant") continue;
		const role = ev.message?.role as "user" | "assistant" | undefined;
		if (role !== "user" && role !== "assistant") continue;

		const blocks = toBlocks(ev.message?.content);
		const toolCalls: ToolCall[] = [];
		const toolResults: ToolResult[] = [];
		let text = "";
		let thinking = "";

		for (const b of blocks) {
			const bt = b.type;
			if (bt === "text" && b.text) {
				text += b.text;
			} else if (bt === "thinking" && b.thinking) {
				thinking += b.thinking;
			} else if (bt === "tool_use" && b.id && b.name) {
				toolCalls.push({ id: b.id, name: b.name, input: b.input });
				toolUseCount++;
			} else if (bt === "tool_result" && b.tool_use_id) {
				const isError = b.is_error === true;
				toolResults.push({
					toolUseId: b.tool_use_id,
					isError,
					content: blockContentToString(b.content),
				});
				if (isError) toolErrorCount++;
			}
		}

		// 跳过空步骤 (无文本、无工具调用、无工具结果)
		if (
			!text &&
			!thinking &&
			toolCalls.length === 0 &&
			toolResults.length === 0
		) {
			continue;
		}

		const step: TrajectoryStep = { role, text };
		if (thinking) step.thinking = thinking;
		if (toolCalls.length) step.toolCalls = toolCalls;
		if (toolResults.length) step.toolResults = toolResults;
		steps.push(step);
	}

	return { steps, toolUseCount, toolErrorCount };
}

// 标注: 全程无 tool_result.is_error → positive; 有任一 error → self_correction
function labelTrajectory(
	toolErrorCount: number,
): "positive" | "self_correction" {
	return toolErrorCount === 0 ? "positive" : "self_correction";
}

// 枚举所有 session jsonl (含 subagents)
async function listSessionFiles(
	sourceDir: string,
): Promise<
	{ file: string; sessionId: string; product: string; isSubagent: boolean }[]
> {
	const out: {
		file: string;
		sessionId: string;
		product: string;
		isSubagent: boolean;
	}[] = [];
	let topEntries: string[] = [];
	try {
		topEntries = await fs.readdir(sourceDir);
	} catch (e) {
		log(`source dir not readable: ${sourceDir}: ${(e as Error).message}`);
		return out;
	}

	for (const entry of topEntries) {
		const cwdDir = path.join(sourceDir, entry);
		let stat: Awaited<ReturnType<typeof fs.stat>>;
		try {
			stat = await fs.stat(cwdDir);
		} catch {
			continue;
		}
		if (!stat.isDirectory()) continue;
		let files: string[] = [];
		try {
			files = await fs.readdir(cwdDir);
		} catch {
			continue;
		}
		for (const f of files) {
			if (!f.endsWith(".jsonl")) continue;
			const sessionId = f.replace(/\.jsonl$/, "");
			out.push({
				file: path.join(cwdDir, f),
				sessionId,
				product: "fusion-code",
				isSubagent: false,
			});
		}
		// subagents: <cwd-slug>/<session-id>/subagents/agent-*.jsonl
		let subDirs: string[] = [];
		try {
			subDirs = await fs.readdir(cwdDir);
		} catch {
			subDirs = [];
		}
		for (const sd of subDirs) {
			const subPath = path.join(cwdDir, sd);
			let sstat: Awaited<ReturnType<typeof fs.stat>>;
			try {
				sstat = await fs.stat(subPath);
			} catch {
				continue;
			}
			if (!sstat.isDirectory()) continue;
			const subAgentsDir = path.join(subPath, "subagents");
			let agentFiles: string[] = [];
			try {
				agentFiles = await fs.readdir(subAgentsDir);
			} catch {
				continue;
			}
			for (const af of agentFiles) {
				if (!af.endsWith(".jsonl")) continue;
				out.push({
					file: path.join(subAgentsDir, af),
					sessionId: `${sd}::${af.replace(/\.jsonl$/, "")}`,
					product: "fusion-code",
					isSubagent: true,
				});
			}
		}
	}
	return out;
}

// 写单个汇聚轨迹到 dest/raw/<product>-<safe-session>.jsonl
async function writeTrajectory(
	destDir: string,
	traj: CollectedTrajectory,
): Promise<void> {
	const rawDir = path.join(destDir, "raw");
	await fs.mkdir(rawDir, { recursive: true });
	const safeName = traj.sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
	const outFile = path.join(rawDir, `${traj.product}-${safeName}.jsonl`);
	const lines = traj.steps.map((s) => JSON.stringify(s)).join("\n");
	await fs.writeFile(outFile, lines + (lines ? "\n" : ""), "utf8");
}

// 主入口: 收集并汇聚
export async function collectTrajectories(
	options: CollectOptions,
): Promise<TrajectoryManifest> {
	const { sourceDir, destDir } = options;
	const product = options.product ?? "fusion-code";
	log(`scanning source=${sourceDir} dest=${destDir} product=${product}`);

	const files = await listSessionFiles(sourceDir);
	log(`found ${files.length} session files (incl subagents)`);

	const sessions: ManifestEntry[] = [];
	let totalSteps = 0;
	let totalToolUse = 0;
	let totalToolError = 0;
	let positive = 0;
	let selfCorrection = 0;

	for (const f of files) {
		let events: RawEvent[] = [];
		try {
			events = await readJsonl(f.file);
		} catch (e) {
			log(`skip unreadable ${f.file}: ${(e as Error).message}`);
			continue;
		}
		const { steps, toolUseCount, toolErrorCount } = parseSession(
			events,
			f.file,
			f.sessionId,
			product,
		);
		if (steps.length === 0) continue;

		const label = labelTrajectory(toolErrorCount);
		const traj: CollectedTrajectory = {
			source: f.file,
			sessionId: f.sessionId,
			product: f.product,
			steps,
			label,
			toolUseCount,
			toolErrorCount,
			hasSubagents: f.isSubagent,
		};
		await writeTrajectory(destDir, traj);

		sessions.push({
			source: f.file,
			sessionId: f.sessionId,
			product: f.product,
			label,
			toolUseCount,
			toolErrorCount,
			stepCount: steps.length,
			hasSubagents: f.isSubagent,
		});
		totalSteps += steps.length;
		totalToolUse += toolUseCount;
		totalToolError += toolErrorCount;
		if (label === "positive") positive++;
		else selfCorrection++;
	}

	const manifest: TrajectoryManifest = {
		version: MANIFEST_VERSION,
		generatedAt: new Date().toISOString(),
		destDir,
		sessions,
		totals: {
			sessions: sessions.length,
			steps: totalSteps,
			toolUse: totalToolUse,
			toolError: totalToolError,
			positive,
			selfCorrection,
		},
	};

	await fs.mkdir(destDir, { recursive: true });
	const manifestPath = path.join(destDir, "manifest.json");
	await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

	log(
		`collected ${sessions.length} sessions, ${totalSteps} steps, ` +
			`${totalToolUse} tool pairs (${totalToolError} errors), ` +
			`${positive} positive / ${selfCorrection} self_correction → ${destDir}`,
	);
	return manifest;
}

// 读取已有 manifest (exporter 复用)
export async function readManifest(
	destDir: string,
): Promise<TrajectoryManifest | null> {
	const manifestPath = path.join(destDir, "manifest.json");
	try {
		const raw = await fs.readFile(manifestPath, "utf8");
		return JSON.parse(raw) as TrajectoryManifest;
	} catch {
		return null;
	}
}

// 从 raw/ 目录读回单条汇聚轨迹 (exporter 消费)
export async function loadCollectedTrajectory(
	rawFile: string,
	entry: ManifestEntry,
): Promise<CollectedTrajectory> {
	const content = await fs.readFile(rawFile, "utf8");
	const steps: TrajectoryStep[] = [];
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			steps.push(JSON.parse(trimmed) as TrajectoryStep);
		} catch {}
	}
	return {
		source: entry.source,
		sessionId: entry.sessionId,
		product: entry.product,
		steps,
		label: entry.label,
		toolUseCount: entry.toolUseCount,
		toolErrorCount: entry.toolErrorCount,
		hasSubagents: entry.hasSubagents,
	};
}
