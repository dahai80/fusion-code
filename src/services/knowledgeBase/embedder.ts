import { logForDebugging } from "../../utils/debug.js";

const MLX_BASE = "http://127.0.0.1:11434";

export async function getEmbedding(text: string): Promise<number[] | null> {
	try {
		const resp = await fetch(`${MLX_BASE}/api/embeddings`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompt: text }),
			signal: AbortSignal.timeout(10000),
		});
		if (!resp.ok) {
			logForDebugging(`embedder: HTTP ${resp.status} from MLX`);
			return null;
		}
		const data = (await resp.json()) as { embedding?: number[] };
		return data.embedding ?? null;
	} catch (e) {
		logForDebugging(`embedder: failed ${String(e)}`);
		return null;
	}
}

export async function getEmbeddings(
	texts: string[],
	batchSize: number = 8,
): Promise<(number[] | null)[]> {
	const results: (number[] | null)[] = [];

	for (let i = 0; i < texts.length; i += batchSize) {
		const batch = texts.slice(i, i + batchSize);
		const batchResults = await Promise.all(batch.map((t) => getEmbedding(t)));
		results.push(...batchResults);
	}

	const success = results.filter((r) => r !== null).length;
	logForDebugging(`embedder: ${success}/${texts.length} embeddings generated`);
	return results;
}

export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) return 0;
	let dotProduct = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	if (normA === 0 || normB === 0) return 0;
	return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
