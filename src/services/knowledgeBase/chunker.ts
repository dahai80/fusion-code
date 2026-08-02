import { logForDebugging } from "../../utils/debug.js";

export type Chunk = {
	content: string;
	source: string;
	startLine: number;
	endLine: number;
};

export function chunkCode(
	content: string,
	source: string,
	maxChunkLines: number = 80,
	overlapLines: number = 10,
): Chunk[] {
	const lines = content.split("\n");
	const chunks: Chunk[] = [];

	let start = 0;
	while (start < lines.length) {
		const end = Math.min(start + maxChunkLines, lines.length);
		const chunkLines = lines.slice(start, end);
		chunks.push({
			content: chunkLines.join("\n"),
			source,
			startLine: start + 1,
			endLine: end,
		});
		if (end >= lines.length) break;
		start = end - overlapLines;
	}

	logForDebugging(`chunker: ${source} -> ${chunks.length} chunks`);
	return chunks;
}

export function chunkMarkdown(content: string, source: string): Chunk[] {
	const sections = content.split(/\n(?=#{1,3}\s)/);
	const chunks: Chunk[] = [];
	let lineOffset = 1;

	for (const section of sections) {
		if (!section.trim()) continue;
		const lineCount = section.split("\n").length;
		chunks.push({
			content: section.trim(),
			source,
			startLine: lineOffset,
			endLine: lineOffset + lineCount - 1,
		});
		lineOffset += lineCount;
	}

	logForDebugging(`chunker: ${source} -> ${chunks.length} md chunks`);
	return chunks;
}

export function chunkText(
	content: string,
	source: string,
	maxChars: number = 2000,
	overlapChars: number = 200,
): Chunk[] {
	if (content.length <= maxChars) {
		return [
			{ content, source, startLine: 1, endLine: content.split("\n").length },
		];
	}

	const chunks: Chunk[] = [];
	let start = 0;
	let lineOffset = 1;

	while (start < content.length) {
		const end = Math.min(start + maxChars, content.length);
		const chunk = content.slice(start, end);
		const lineCount = chunk.split("\n").length;
		chunks.push({
			content: chunk,
			source,
			startLine: lineOffset,
			endLine: lineOffset + lineCount - 1,
		});
		if (end >= content.length) break;
		start = end - overlapChars;
		lineOffset += lineCount;
	}

	logForDebugging(`chunker: ${source} -> ${chunks.length} text chunks`);
	return chunks;
}
