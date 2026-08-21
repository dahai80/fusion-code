// item 6: transcript 磁盘裁剪 + 崩溃安全 checkpoint (CC 2.1.208, §188/§628)
//
// 问题: compact 发生时 QueryEngine 内存裁前缀 (mutableMessages.splice), 但磁盘
// .jsonl 纯追加 (appendEntryToFile), pre-compact 段永留盘。编辑密集会话同文件
// 反复 Read/Edit → tool_result 巨大 → 多 GB (inc-3930)。
//
// 本模块: 纯函数裁剪逻辑 (可测), 不动 sessionStorage 类内部。磁盘重写串行由
// Project.trimTranscriptOnDisk 类方法走 trackWrite (同 removeMessageByUuid 模式)。
//
// 三重数据安全: (1) default off — FUSION_TRANSCRIPT_TRIM_THRESHOLD 未设则永不裁;
// (2) atomicWriteFile tmp+rename — 崩溃不留半写; (3) preservedSegment boundary 不裁。

import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// --- 常量 --------------------------------------------------------------------

// 50MB — 同 MAX_TOMBSTONE_REWRITE_BYTES / MAX_TRANSCRIPT_READ_BYTES 量级。裁剪走
// 全文件重写 (非 tail-splice), 复用同 bail-out 上限防 OOM。
export const DEFAULT_TRIM_THRESHOLD_BYTES = 50 * 1024 * 1024;

// 裁剪 checkpoint 文件后缀。与主 .jsonl 同目录, 崩溃时存续用于恢复判定。
const TRIM_CHECKPOINT_SUFFIX = ".trim-checkpoint";

// compact_boundary 字节标记 (与 sessionStoragePortable.compactBoundaryMarker 同源)。
// 懒分配 — 多数 session 不触发裁剪。
let _compactBoundaryMarker: Buffer | undefined;
function compactBoundaryMarker(): Buffer {
	if (_compactBoundaryMarker === undefined) {
		_compactBoundaryMarker = Buffer.from('"compact_boundary"');
	}
	return _compactBoundaryMarker;
}

// metadata 行标记 (与 sessionStorage.METADATA_TYPE_MARKERS 同源) — 裁剪后须保留
// pre-boundary metadata, 否则 resume 丢 session 元数据 (title/agent-name/mode)。
const METADATA_TYPE_MARKERS = [
	'"type":"summary"',
	'"type":"custom-title"',
	'"type":"tag"',
	'"type":"agent-name"',
	'"type":"agent-color"',
	'"type":"agent-setting"',
	'"type":"mode"',
	'"type":"worktree-state"',
	'"type":"pr-link"',
];

// --- 类型 --------------------------------------------------------------------

export interface TrimDecision {
	trim: boolean;
	size: number;
}

export interface TrimResult {
	trimmed: boolean;
	origSize: number;
	newSize: number;
	trimmedBytes: number;
	reason: string;
}

interface CheckpointRecord {
	trimmedAt: string;
	boundaryOffset: number;
	origSize: number;
	newSize: number;
}

interface BoundaryInfo {
	// 最后一行非-preserved compact_boundary 的起始字节偏移 (行首)。无则 null。
	lastBoundaryLineStart: number | null;
	// 最后一行 boundary 的完整内容 (含换行), 用于拼新文件首行。
	lastBoundaryLine: Buffer | null;
	// 最后一个 boundary 是否 preservedSegment (true → 不裁)。
	lastBoundaryPreserved: boolean;
	// pre-boundary 区间的 metadata 行 (完整行, 含换行)。
	metadataLines: Buffer[];
}

// --- 触发判定 ----------------------------------------------------------------

/**
 * 判定 transcript 是否应裁剪。default off — env 未设返 {trim:false} (byte-identical 旧行为)。
 * 用户显式设 FUSION_TRANSCRIPT_TRIM_THRESHOLD=<正整数> 才启用。
 */
export function shouldTrimTranscript(
	filePath: string,
	thresholdBytes?: number,
): TrimDecision {
	const envVal = process.env.FUSION_TRANSCRIPT_TRIM_THRESHOLD;
	const threshold =
		thresholdBytes ??
		(envVal === undefined ? Infinity : parseThreshold(envVal));
	const size = fileSizeSync(filePath);
	return { trim: threshold !== Infinity && size > threshold, size };
}

function parseThreshold(raw: string): number {
	const n = Number.parseInt(raw, 10);
	// 非数/负/0 → Infinity (off)。0 亦 off (裁剪点=0 无意义, 且 "0=off" 与其他 item 一致)。
	if (!Number.isFinite(n) || n <= 0) return Infinity;
	return n;
}

function fileSizeSync(filePath: string): number {
	// 同步 stat — shouldTrim 在 compact 收尾同步判定, 体积小。
	// 失败 (文件不存在) → 0 → 不裁。
	try {
		// require 避循环依赖 (node:fs/promises stat 是 async, 此处用 sync)。
		const { statSync } = require("node:fs") as typeof import("node:fs");
		return statSync(filePath).size;
	} catch {
		return 0;
	}
}

// --- 核心裁剪 ----------------------------------------------------------------

/**
 * 计算裁剪信息: 扫描全文件找最后非-preserved compact_boundary, 收 pre-boundary metadata。
 * 纯函数, 不写盘。返回 BoundaryInfo 或 null (无可用裁剪点)。
 */
export async function computeTrimBoundary(
	filePath: string,
): Promise<BoundaryInfo | null> {
	const content = await readFile(filePath);
	if (content.length === 0) return null;

	const marker = compactBoundaryMarker();
	const NEWLINE = 0x0a;

	// 单遍正向扫: 记每个 boundary 行的 [start, end) + preserved, 同时收 pre-last-boundary metadata。
	let lastBoundaryLineStart: number | null = null;
	let lastBoundaryLine: Buffer | null = null;
	let lastBoundaryPreserved = false;

	// 边界前 (即 lastBoundaryLineStart 之前) 的 metadata 行。
	const metadataLines: Buffer[] = [];

	let lineStart = 0;
	let nl = content.indexOf(NEWLINE);
	while (nl !== -1) {
		const lineEnd = nl + 1; // 含换行
		const lineBuf = content.subarray(lineStart, lineEnd);

		// 检测 compact_boundary (marker 可能在用户内容里 → parseBoundaryLine 确认)
		if (lineBuf.includes(marker)) {
			const info = parseBoundaryLine(lineBuf.toString("utf-8"));
			if (info !== null) {
				// 更新最后 boundary。之前的 "最后 boundary" 现在变成它的 pre-boundary —
				// 但 metadata 扫描只对最终 lastBoundaryLineStart 之前的行, 所以下面统一收。
				lastBoundaryLineStart = lineStart;
				lastBoundaryLine = Buffer.from(lineBuf); // 拷贝, 脱离原 buffer
				lastBoundaryPreserved = info.hasPreservedSegment;
			}
		}

		lineStart = lineEnd;
		nl = content.indexOf(NEWLINE, lineStart);
	}

	// 处理末行无换行 (健壮)
	if (lineStart < content.length) {
		const lineBuf = content.subarray(lineStart);
		if (lineBuf.includes(marker)) {
			const info = parseBoundaryLine(lineBuf.toString("utf-8"));
			if (info !== null) {
				lastBoundaryLineStart = lineStart;
				lastBoundaryLine = Buffer.from(lineBuf);
				lastBoundaryPreserved = info.hasPreservedSegment;
			}
		}
	}

	// 无 boundary → 不裁 (无可裁点)。
	if (lastBoundaryLineStart === null) return null;

	// 最后 boundary 是 preservedSegment → 不裁 (preserved 消息物理在 pre-boundary, 裁了丢)。
	if (lastBoundaryPreserved) return null;

	// 收 lastBoundaryLineStart 之前的 metadata 行 (整个 [0, lastBoundaryLineStart))。
	const preBoundary = content.subarray(0, lastBoundaryLineStart);
	collectMetadataLines(preBoundary, metadataLines);

	return {
		lastBoundaryLineStart,
		lastBoundaryLine,
		lastBoundaryPreserved,
		metadataLines,
	};
}

/**
 * 确认 boundary 行: type===system && subtype===compact_boundary, 返回 preservedSegment 标志。
 * (与 sessionStoragePortable.parseBoundaryLine 同源 — marker 可出现在用户内容里, 须 JSON 确认。)
 */
function parseBoundaryLine(
	line: string,
): { hasPreservedSegment: boolean } | null {
	try {
		const parsed = JSON.parse(line) as {
			type?: string;
			subtype?: string;
			compactMetadata?: { preservedSegment?: unknown };
		};
		if (parsed.type !== "system" || parsed.subtype !== "compact_boundary") {
			return null;
		}
		return {
			hasPreservedSegment: Boolean(parsed.compactMetadata?.preservedSegment),
		};
	} catch {
		return null;
	}
}

/**
 * 从字节段收 metadata 行 (完整行含换行)。逐行检查 markers。
 */
function collectMetadataLines(buf: Buffer, out: Buffer[]): void {
	const NEWLINE = 0x0a;
	const markerBufs = METADATA_TYPE_MARKERS.map((m) => Buffer.from(m));
	let lineStart = 0;
	let nl = buf.indexOf(NEWLINE);
	while (nl !== -1) {
		const lineEnd = nl + 1;
		const lineBuf = buf.subarray(lineStart, lineEnd);
		for (const m of markerBufs) {
			if (lineBuf.includes(m)) {
				out.push(Buffer.from(lineBuf));
				break;
			}
		}
		lineStart = lineEnd;
		nl = buf.indexOf(NEWLINE, lineStart);
	}
}

/**
 * 执行磁盘裁剪。调用方 (Project.trimTranscriptOnDisk) 须在 trackWrite 内调。
 * 流程: computeTrimBoundary → 拼 metadata + boundary + post-compact 段 →
 * 先写 checkpoint → atomicWriteFile 换主文件 → 删 checkpoint。
 *
 * 返回 TrimResult。不裁 (无 boundary / preserved / 文件过小) 返回 {trimmed:false, reason}。
 */
export async function performTrim(filePath: string): Promise<TrimResult> {
	const { size: origSize } = await stat(filePath);
	if (origSize === 0) {
		return {
			trimmed: false,
			origSize,
			newSize: 0,
			trimmedBytes: 0,
			reason: "empty-file",
		};
	}

	const boundary = await computeTrimBoundary(filePath);
	if (boundary === null || boundary.lastBoundaryLineStart === null) {
		return {
			trimmed: false,
			origSize,
			newSize: origSize,
			trimmedBytes: 0,
			reason: "no-trim-point",
		};
	}

	// post-compact 段 = boundary 行 + 其后所有内容。
	const boundaryStart = boundary.lastBoundaryLineStart;
	const content = await readFile(filePath);
	const postCompact = content.subarray(boundaryStart);

	// 拼新文件: metadata 行 + post-compact 段。metadata 已含换行, postCompact 以 boundary 行起。
	const parts: Buffer[] = [];
	for (const m of boundary.metadataLines) parts.push(m);
	parts.push(postCompact);
	const newContent = Buffer.concat(parts);
	const newSize = newContent.length;

	// 1. checkpoint 先写 (崩溃时存续, 恢复协议据此判定)。
	const checkpointPath = filePath + TRIM_CHECKPOINT_SUFFIX;
	const checkpoint: CheckpointRecord = {
		trimmedAt: new Date().toISOString(),
		boundaryOffset: boundaryStart,
		origSize,
		newSize,
	};
	await atomicWriteFile(checkpointPath, JSON.stringify(checkpoint));

	// 2. 原子换主文件 (tmp+rename, 崩溃安全 — 要么旧完整留, 要么新完整换)。
	await atomicWriteFile(filePath, newContent.toString("utf-8"));

	// 3. 换成功后删 checkpoint。
	try {
		await unlink(checkpointPath);
	} catch {
		// checkpoint 删失败不阻断 (下次 recoverTrimIfNeeded 见 checkpoint+主文件 OK 会幂等删)。
	}

	return {
		trimmed: true,
		origSize,
		newSize,
		trimmedBytes: origSize - newSize,
		reason: "trimmed",
	};
}

// --- 崩溃恢复 ----------------------------------------------------------------

/**
 * 恢复协议。resume/启动调。default off 时 checkpoint 永不存在 → no-op, 零开销。
 * - checkpoint 不存在 → 无中断裁剪, no-op。
 * - checkpoint 存在 + 主文件可解析 (首行 valid JSON) → 裁剪已完成 checkpoint 未删 → 删 checkpoint, no-op (幂等)。
 * - checkpoint 存在 + 主文件损坏/空 → 裁剪中断于 atomicWriteFile 中途 (理论极不可能, 防御) →
 *   记日志, 保留 checkpoint 作证, 不自动删主文件 (Rule 12 fail-visible — 让用户决定, 不静默丢数据)。
 */
export async function recoverTrimIfNeeded(filePath: string): Promise<void> {
	const checkpointPath = filePath + TRIM_CHECKPOINT_SUFFIX;

	let checkpointExists = false;
	try {
		await stat(checkpointPath);
		checkpointExists = true;
	} catch {
		// checkpoint 不存在 → 无中断裁剪, no-op。
		return;
	}
	if (!checkpointExists) return;

	// checkpoint 存在 — 判主文件完整性。
	let mainIntact = false;
	try {
		const content = await readFile(filePath, { encoding: "utf-8" });
		if (content.length > 0) {
			// 首行 valid JSON → 主文件完整 (裁剪已完成)。
			const firstNl = content.indexOf("\n");
			const firstLine = firstNl === -1 ? content : content.slice(0, firstNl);
			JSON.parse(firstLine);
			mainIntact = true;
		}
	} catch {
		// 主文件读失败 / 首行非 JSON → 损坏。
		mainIntact = false;
	}

	if (mainIntact) {
		// 裁剪完成但 checkpoint 未删 → 幂等删 checkpoint, no-op。
		try {
			await unlink(checkpointPath);
		} catch {
			// 删失败忽略, 下次再收尾。
		}
		return;
	}

	// 主文件损坏 — fail-visible (Rule 12)。保留 checkpoint 作证, 不静默删主文件。
	// 记日志让用户感知 (logForDebugging / console 避循环依赖 — 用 process.stderr)。
	process.stderr.write(
		`[item6] transcript trim interrupted: checkpoint exists but main file corrupt. ` +
			`main=${filePath} checkpoint=${checkpointPath} — manual recovery needed.\n`,
	);
}

// --- 原子写 (与 sessionStorage.atomicWriteFile 同源, 独立避免导出私有) -----------

async function atomicWriteFile(filePath: string, data: string): Promise<void> {
	const dir = dirname(filePath);
	const tmpName = join(
		dir,
		`.tmp-trim-${process.pid}-${data.length}-${Buffer.byteLength(filePath)}`,
	);
	try {
		await writeFile(tmpName, data, { mode: 0o600 });
		await rename(tmpName, filePath);
	} catch (error) {
		try {
			await unlink(tmpName);
		} catch {
			// 忽略清理失败
		}
		throw error;
	}
}
