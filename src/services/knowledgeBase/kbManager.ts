import { readdir, readFile } from "fs/promises";
import { extname, join } from "path";
import { logForDebugging } from "../../utils/debug.js";
import type { Chunk } from "./chunker.js";
import { chunkCode, chunkMarkdown, chunkText } from "./chunker.js";
import { getEmbedding, getEmbeddings } from "./embedder.js";
import { type VectorEntry, VectorStore } from "./vectorStore.js";

export type KBStatus = {
	exists: boolean;
	entryCount: number;
	sources: string[];
	updated_at?: string;
};

const KB_DIR = (cwd: string) => join(cwd, ".fusion", "kb");

const CODE_EXTS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".py",
	".rs",
	".go",
	".java",
	".c",
	".cpp",
	".h",
	".hpp",
	".rb",
	".php",
	".swift",
	".kt",
]);

const DOC_EXTS = new Set([".md", ".txt", ".rst", ".adoc"]);

function getChunkerForFile(
	filePath: string,
): (content: string, source: string) => Chunk[] {
	const ext = extname(filePath);
	if (DOC_EXTS.has(ext)) return (c, s) => chunkMarkdown(c, s);
	if (CODE_EXTS.has(ext)) return (c, s) => chunkCode(c, s);
	return (c, s) => chunkText(c, s);
}

async function collectFiles(
	dir: string,
	maxDepth: number = 5,
	currentDepth: number = 0,
): Promise<string[]> {
	if (currentDepth >= maxDepth) return [];
	const files: string[] = [];
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	for (const entry of entries) {
		if (
			entry.name.startsWith(".") ||
			entry.name === "node_modules" ||
			entry.name === ".git"
		)
			continue;
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			const subFiles = await collectFiles(fullPath, maxDepth, currentDepth + 1);
			files.push(...subFiles);
		} else {
			const ext = extname(entry.name);
			if (CODE_EXTS.has(ext) || DOC_EXTS.has(ext)) {
				files.push(fullPath);
			}
		}
	}
	return files;
}

export async function buildKB(cwd: string): Promise<string> {
	const kbDir = KB_DIR(cwd);
	const store = await VectorStore.load(kbDir);

	const files = await collectFiles(cwd);
	logForDebugging(`kbManager: found ${files.length} files to index`);

	let totalChunks = 0;
	let totalEmbedded = 0;

	for (const filePath of files) {
		try {
			const content = await readFile(filePath, "utf-8");
			const chunker = getChunkerForFile(filePath);
			const chunks = chunker(content, filePath);
			totalChunks += chunks.length;

			const texts = chunks.map((c) => c.content.slice(0, 500));
			const embeddings = await getEmbeddings(texts);

			const entries: VectorEntry[] = [];
			for (let i = 0; i < chunks.length; i++) {
				if (embeddings[i]) {
					entries.push({
						id: `${filePath}:${chunks[i].startLine}`,
						content: chunks[i].content,
						source: chunks[i].source,
						startLine: chunks[i].startLine,
						endLine: chunks[i].endLine,
						embedding: embeddings[i]!,
					});
					totalEmbedded++;
				}
			}

			await store.addEntries(entries);
		} catch (e) {
			logForDebugging(`kbManager: skipped ${filePath}: ${String(e)}`);
		}
	}

	await store.save();
	logForDebugging(
		`kbManager: build complete — ${totalChunks} chunks, ${totalEmbedded} embedded`,
	);
	return `✅ Knowledge base built: ${files.length} files, ${totalChunks} chunks, ${totalEmbedded} indexed`;
}

export async function queryKB(
	cwd: string,
	query: string,
	topK: number = 5,
): Promise<string> {
	const kbDir = KB_DIR(cwd);
	const store = await VectorStore.load(kbDir);

	if (store.size === 0) {
		return "Knowledge base is empty. Run /kb build first.";
	}

	const queryEmbedding = await getEmbedding(query);
	if (!queryEmbedding) {
		return "Failed to generate query embedding. Is MLX running?";
	}

	const results = await store.query(queryEmbedding, topK);
	if (results.length === 0) {
		return "No relevant results found.";
	}

	const lines: string[] = [`🔍 Query: "${query}"`, ""];
	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		lines.push(
			`${i + 1}. ${r.source}:${r.startLine}-${r.endLine} (score: ${r.score.toFixed(3)})`,
		);
		lines.push(
			`   ${r.content.slice(0, 200)}${r.content.length > 200 ? "..." : ""}`,
		);
		lines.push("");
	}

	return lines.join("\n");
}

export async function getKBStatus(cwd: string): Promise<KBStatus> {
	const kbDir = KB_DIR(cwd);
	try {
		const store = await VectorStore.load(kbDir);
		return {
			exists: store.size > 0,
			entryCount: store.size,
			sources: store.getSources(),
		};
	} catch {
		return { exists: false, entryCount: 0, sources: [] };
	}
}

export async function resetKB(cwd: string): Promise<string> {
	const kbDir = KB_DIR(cwd);
	const store = await VectorStore.load(kbDir);
	await store.clear();
	await store.save();
	logForDebugging("kbManager: reset complete");
	return "✅ Knowledge base cleared";
}
