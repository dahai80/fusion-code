import { logForDebugging } from "../../utils/debug.js";

const MLX_BASE_URL = "http://127.0.0.1:11434";

type ModelInfo = {
	name: string;
	size?: number;
	quant?: string;
	modified_at?: string;
};

type MlxStatus = {
	connected: boolean;
	models: ModelInfo[];
	loaded_model?: string;
	error?: string;
};

async function fetchMlxStatus(): Promise<MlxStatus> {
	try {
		const resp = await fetch(`${MLX_BASE_URL}/api/tags`, {
			signal: AbortSignal.timeout(3000),
		});
		if (!resp.ok) {
			return { connected: false, models: [], error: `HTTP ${resp.status}` };
		}
		const data = (await resp.json()) as {
			models?: Array<{
				name: string;
				size?: number;
				quantization_level?: string;
				modified_at?: string;
			}>;
		};
		const models: ModelInfo[] = (data.models ?? []).map((m) => ({
			name: m.name,
			size: m.size,
			quant: m.quantization_level,
			modified_at: m.modified_at,
		}));
		return { connected: true, models };
	} catch (e) {
		return {
			connected: false,
			models: [],
			error: (e as Error).message,
		};
	}
}

async function fetchMlxPs(): Promise<string[]> {
	try {
		const resp = await fetch(`${MLX_BASE_URL}/api/ps`, {
			signal: AbortSignal.timeout(3000),
		});
		if (!resp.ok) return [];
		const data = (await resp.json()) as {
			models?: Array<{ name: string }>;
		};
		return (data.models ?? []).map((m) => m.name);
	} catch {
		return [];
	}
}

function formatBytes(bytes?: number): string {
	if (!bytes) return "unknown";
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	if (bytes < 1024 * 1024 * 1024)
		return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

export async function execute(_args: string): Promise<string> {
	const status = await fetchMlxStatus();
	if (!status.connected) {
		return [
			"🔴 MLX server not reachable",
			"",
			`Error: ${status.error ?? "connection refused"}`,
			`URL: ${MLX_BASE_URL}`,
			"",
			"Start with: fusion service start mlx",
		].join("\n");
	}

	const loaded = await fetchMlxPs();
	const lines: string[] = [
		"🟢 MLX server connected",
		"",
		`URL: ${MLX_BASE_URL}`,
		`Available models: ${status.models.length}`,
		`Loaded in memory: ${loaded.length > 0 ? loaded.join(", ") : "none"}`,
	];

	if (status.models.length > 0) {
		lines.push("");
		lines.push("Models:");
		for (const m of status.models) {
			const loadTag = loaded.includes(m.name) ? " [LOADED]" : "";
			const sizeStr = m.size ? ` (${formatBytes(m.size)})` : "";
			const quantStr = m.quant ? ` ${m.quant}` : "";
			lines.push(`  • ${m.name}${sizeStr}${quantStr}${loadTag}`);
		}
	}

	logForDebugging(
		`model-status: ${status.models.length} models, ${loaded.length} loaded`,
	);
	return lines.join("\n");
}

export { fetchMlxPs, fetchMlxStatus };
