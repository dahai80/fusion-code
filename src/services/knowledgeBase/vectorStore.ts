import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { logForDebugging } from "../../utils/debug.js";
import { cosineSimilarity } from "./embedder.js";

export type VectorEntry = {
	id: string;
	content: string;
	source: string;
	startLine: number;
	endLine: number;
	embedding: number[];
};

export type VectorStoreData = {
	entries: VectorEntry[];
	version: number;
	created_at: string;
	updated_at: string;
};

export class VectorStore {
	private filePath: string;
	private data: VectorStoreData;

	private constructor(filePath: string, data: VectorStoreData) {
		this.filePath = filePath;
		this.data = data;
	}

	static async load(dir: string): Promise<VectorStore> {
		const filePath = join(dir, "vectors.json");
		try {
			const raw = await readFile(filePath, "utf-8");
			const data = JSON.parse(raw) as VectorStoreData;
			logForDebugging(
				`vectorStore: loaded ${data.entries.length} entries from ${filePath}`,
			);
			return new VectorStore(filePath, data);
		} catch {
			const data: VectorStoreData = {
				entries: [],
				version: 1,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			};
			await mkdir(dir, { recursive: true });
			return new VectorStore(filePath, data);
		}
	}

	async save(): Promise<void> {
		this.data.updated_at = new Date().toISOString();
		await mkdir(join(this.filePath, ".."), { recursive: true });
		await writeFile(this.filePath, JSON.stringify(this.data), "utf-8");
		logForDebugging(`vectorStore: saved ${this.data.entries.length} entries`);
	}

	get size(): number {
		return this.data.entries.length;
	}

	async addEntries(entries: VectorEntry[]): Promise<void> {
		const existingIds = new Set(this.data.entries.map((e) => e.id));
		const newEntries = entries.filter((e) => !existingIds.has(e.id));
		this.data.entries.push(...newEntries);
		logForDebugging(
			`vectorStore: added ${newEntries.length} entries (total: ${this.data.entries.length})`,
		);
	}

	async query(
		queryEmbedding: number[],
		topK: number = 5,
		minScore: number = 0.3,
	): Promise<Array<VectorEntry & { score: number }>> {
		const scored = this.data.entries
			.map((entry) => ({
				...entry,
				score: cosineSimilarity(queryEmbedding, entry.embedding),
			}))
			.filter((e) => e.score >= minScore)
			.sort((a, b) => b.score - a.score)
			.slice(0, topK);

		logForDebugging(
			`vectorStore: query returned ${scored.length} results (top score: ${scored[0]?.score ?? 0})`,
		);
		return scored;
	}

	async clear(): Promise<void> {
		this.data.entries = [];
		logForDebugging("vectorStore: cleared all entries");
	}

	getSources(): string[] {
		return [...new Set(this.data.entries.map((e) => e.source))];
	}
}
