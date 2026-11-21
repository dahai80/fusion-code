// item 6: transcript on-disk trim + crash-safe checkpoint (CC 2.1.208, §188/§628)
//
// Problem: when compact happens, QueryEngine trims the prefix in memory (mutableMessages.splice), but the
// on-disk .jsonl is append-only (appendEntryToFile), so the pre-compact segment stays on disk forever.
// Edit-heavy sessions Read/Edit the same file repeatedly → huge tool_results → multi-GB files (inc-3930).
//
// This module: pure-function trim logic (testable), does not touch sessionStorage class internals.
// Disk rewrites are serialized by the Project.trimTranscriptOnDisk class method via trackWrite
// (same pattern as removeMessageByUuid).
//
// Triple data safety: (1) default off — never trims unless FUSION_TRANSCRIPT_TRIM_THRESHOLD is set;
// (2) atomicWriteFile tmp+rename — no half-written file after a crash; (3) preservedSegment boundaries are not trimmed.

import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// --- Constants ---------------------------------------------------------------

// 50MB — same magnitude as MAX_TOMBSTONE_REWRITE_BYTES / MAX_TRANSCRIPT_READ_BYTES. Trimming
// rewrites the whole file (not a tail-splice), reusing the same bail-out cap to prevent OOM.
export const DEFAULT_TRIM_THRESHOLD_BYTES = 50 * 1024 * 1024;

// Trim checkpoint file suffix. Lives in the same directory as the main .jsonl, survives crashes for recovery decisions.
const TRIM_CHECKPOINT_SUFFIX = ".trim-checkpoint";

// compact_boundary byte marker (same source as sessionStoragePortable.compactBoundaryMarker).
// Lazily allocated — most sessions never trigger a trim.
let _compactBoundaryMarker: Buffer | undefined;
function compactBoundaryMarker(): Buffer {
	if (_compactBoundaryMarker === undefined) {
		_compactBoundaryMarker = Buffer.from('"compact_boundary"');
	}
	return _compactBoundaryMarker;
}

// metadata line markers (same source as sessionStorage.METADATA_TYPE_MARKERS) — after a trim,
// pre-boundary metadata must be kept, otherwise resume loses session metadata (title/agent-name/mode).
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

// --- Types -------------------------------------------------------------------

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
	// Byte offset (line start) of the last non-preserved compact_boundary line. null if none.
	lastBoundaryLineStart: number | null;
	// Full content of the last boundary line (including newline), used to build the new file's first line.
	lastBoundaryLine: Buffer | null;
	// Whether the last boundary is a preservedSegment (true → do not trim).
	lastBoundaryPreserved: boolean;
	// Metadata lines from the pre-boundary range (full lines, including newline).
	metadataLines: Buffer[];
}

// --- Trigger decision --------------------------------------------------------

/**
 * Decide whether the transcript should be trimmed. Default off — returns {trim:false} when the env is unset (byte-identical old behavior).
 * Enabled only when the user explicitly sets FUSION_TRANSCRIPT_TRIM_THRESHOLD=<positive integer>.
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
	// NaN/negative/0 → Infinity (off). 0 is also off (a trim point of 0 is meaningless, and "0=off" is consistent with the other items).
	if (!Number.isFinite(n) || n <= 0) return Infinity;
	return n;
}

function fileSizeSync(filePath: string): number {
	// Sync stat — shouldTrim decides synchronously at compact completion, small footprint.
	// Failure (file missing) → 0 → no trim.
	try {
		// require avoids a circular dependency (node:fs/promises stat is async; using the sync one here).
		const { statSync } = require("node:fs") as typeof import("node:fs");
		return statSync(filePath).size;
	} catch {
		return 0;
	}
}

// --- Core trim ---------------------------------------------------------------

/**
 * Compute trim info: scan the whole file for the last non-preserved compact_boundary and collect pre-boundary metadata.
 * Pure function, no disk writes. Returns BoundaryInfo or null (no usable trim point).
 */
export async function computeTrimBoundary(
	filePath: string,
	// P3-3: the caller (performTrim) can pass pre-read content to avoid a double read — the original
	// two readFile calls assumed no external writer in between; passing the same buffer guarantees
	// consistency and saves one disk IO.
	preReadContent?: Buffer,
): Promise<BoundaryInfo | null> {
	const content = preReadContent ?? (await readFile(filePath));
	if (content.length === 0) return null;

	const marker = compactBoundaryMarker();
	const NEWLINE = 0x0a;

	// Single forward pass: record [start, end) + preserved for each boundary line, also collecting pre-last-boundary metadata.
	let lastBoundaryLineStart: number | null = null;
	let lastBoundaryLine: Buffer | null = null;
	let lastBoundaryPreserved = false;

	// Metadata lines before the boundary (i.e. before lastBoundaryLineStart).
	const metadataLines: Buffer[] = [];

	let lineStart = 0;
	let nl = content.indexOf(NEWLINE);
	while (nl !== -1) {
		const lineEnd = nl + 1; // including newline
		const lineBuf = content.subarray(lineStart, lineEnd);

		// Detect compact_boundary (the marker may appear in user content → parseBoundaryLine confirms)
		if (lineBuf.includes(marker)) {
			const info = parseBoundaryLine(lineBuf.toString("utf-8"));
			if (info !== null) {
				// Update the last boundary. The previous "last boundary" now becomes its pre-boundary —
				// but the metadata scan only covers lines before the final lastBoundaryLineStart, so it is collected below.
				lastBoundaryLineStart = lineStart;
				lastBoundaryLine = Buffer.from(lineBuf); // copy, detached from the original buffer
				lastBoundaryPreserved = info.hasPreservedSegment;
			}
		}

		lineStart = lineEnd;
		nl = content.indexOf(NEWLINE, lineStart);
	}

	// Handle a final line without newline (robustness)
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

	// No boundary → no trim (no usable trim point).
	if (lastBoundaryLineStart === null) return null;

	// Last boundary is a preservedSegment → no trim (preserved messages physically live in the pre-boundary range; trimming loses them).
	if (lastBoundaryPreserved) return null;

	// Collect metadata lines before lastBoundaryLineStart (the whole [0, lastBoundaryLineStart) range).
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
 * Confirm a boundary line: type===system && subtype===compact_boundary, returns the preservedSegment flag.
 * (Same source as sessionStoragePortable.parseBoundaryLine — the marker can appear in user content, so JSON confirmation is required.)
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
 * Collect metadata lines from a byte range (full lines including newline). Checks markers line by line.
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
 * Perform the on-disk trim. The caller (Project.trimTranscriptOnDisk) must invoke this inside trackWrite.
 * Flow: computeTrimBoundary → assemble metadata + boundary + post-compact segment →
 * write checkpoint first → atomicWriteFile swaps the main file → delete the checkpoint.
 *
 * Returns TrimResult. No trim (no boundary / preserved / file too small) returns {trimmed:false, reason}.
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

	// P3-3: read once, pass to computeTrimBoundary to avoid a double read (the original did two readFile calls: boundary + postCompact).
	const content = await readFile(filePath);
	const boundary = await computeTrimBoundary(filePath, content);
	if (boundary === null || boundary.lastBoundaryLineStart === null) {
		return {
			trimmed: false,
			origSize,
			newSize: origSize,
			trimmedBytes: 0,
			reason: "no-trim-point",
		};
	}

	// Post-compact segment = boundary line + everything after it.
	const boundaryStart = boundary.lastBoundaryLineStart;
	const postCompact = content.subarray(boundaryStart);

	// Assemble the new file: metadata lines + post-compact segment. Metadata already includes newlines; postCompact starts at the boundary line.
	const parts: Buffer[] = [];
	for (const m of boundary.metadataLines) parts.push(m);
	parts.push(postCompact);
	const newContent = Buffer.concat(parts);
	const newSize = newContent.length;

	// 1. Write the checkpoint first (survives crashes; the recovery protocol decides based on it).
	const checkpointPath = filePath + TRIM_CHECKPOINT_SUFFIX;
	const checkpoint: CheckpointRecord = {
		trimmedAt: new Date().toISOString(),
		boundaryOffset: boundaryStart,
		origSize,
		newSize,
	};
	await atomicWriteFile(checkpointPath, JSON.stringify(checkpoint));

	// 2. Atomically swap the main file (tmp+rename, crash-safe — either the old file stays intact or the new one fully replaces it).
	await atomicWriteFile(filePath, newContent.toString("utf-8"));

	// 3. After a successful swap, delete the checkpoint.
	try {
		await unlink(checkpointPath);
	} catch {
		// A checkpoint deletion failure does not block (the next recoverTrimIfNeeded sees checkpoint + intact main file and deletes idempotently).
	}

	return {
		trimmed: true,
		origSize,
		newSize,
		trimmedBytes: origSize - newSize,
		reason: "trimmed",
	};
}

// --- Crash recovery ----------------------------------------------------------

/**
 * Recovery protocol. Called on resume/startup. When default off the checkpoint never exists → no-op, zero cost.
 * - Checkpoint absent → no interrupted trim, no-op.
 * - Checkpoint present + main file parseable (first line valid JSON) → trim completed but checkpoint not deleted → delete the checkpoint, no-op (idempotent).
 * - Checkpoint present + main file corrupt/empty → the trim was interrupted mid-atomicWriteFile (theoretically near-impossible, defensive) →
 *   log it, keep the checkpoint as evidence, do not auto-delete the main file (Rule 12 fail-visible — let the user decide, never silently drop data).
 */
export async function recoverTrimIfNeeded(filePath: string): Promise<void> {
	const checkpointPath = filePath + TRIM_CHECKPOINT_SUFFIX;

	let checkpointExists = false;
	try {
		await stat(checkpointPath);
		checkpointExists = true;
	} catch {
		// Checkpoint absent → no interrupted trim, no-op.
		return;
	}
	if (!checkpointExists) return;

	// Checkpoint present — judge main-file integrity.
	let mainIntact = false;
	try {
		const content = await readFile(filePath, { encoding: "utf-8" });
		if (content.length > 0) {
			// First line valid JSON → main file intact (trim already completed).
			const firstNl = content.indexOf("\n");
			const firstLine = firstNl === -1 ? content : content.slice(0, firstNl);
			JSON.parse(firstLine);
			mainIntact = true;
		}
	} catch {
		// Main file read failed / first line not JSON → corrupt.
		mainIntact = false;
	}

	if (mainIntact) {
		// Trim completed but checkpoint not deleted → idempotent checkpoint deletion, no-op.
		try {
			await unlink(checkpointPath);
		} catch {
			// Ignore deletion failure; clean up next time.
		}
		return;
	}

	// Main file corrupt — fail-visible (Rule 12). Keep the checkpoint as evidence, never silently delete the main file.
	// Log so the user is aware (logForDebugging / console would create a circular dependency — using process.stderr).
	process.stderr.write(
		`[item6] transcript trim interrupted: checkpoint exists but main file corrupt. ` +
			`main=${filePath} checkpoint=${checkpointPath} — manual recovery needed.\n`,
	);
}

// --- Atomic write (same source as sessionStorage.atomicWriteFile, kept separate to avoid exporting a private) ---

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
			// Ignore cleanup failure
		}
		throw error;
	}
}
