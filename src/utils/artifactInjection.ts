import { roughTokenCountEstimation } from "../services/tokenEstimation.js";
import type { Message } from "../types/message.js";
import { getArtifactEngineURL } from "./artifactConfig.js";
import { getContextWindowForModel } from "./context.js";
import { logError } from "./log.js";

const REF_PATTERN = /\[Artifact:\s*[^\]]*?\|\s*ID:\s*(art_\w+)\s*\|[^\]]*\]/g;

const BUDGET_WARN_PCT = 0.7;
const BUDGET_HARD_PCT = 0.9;

interface InjectionResult {
	messages: Message[];
	injectedCount: number;
	totalTokensInjected: number;
}

interface ArtifactBudget {
	usedTokens: number;
	windowSize: number;
	usageRatio: number;
}

async function artifactsRPC(
	method: string,
	params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
	const body = JSON.stringify({
		jsonrpc: "2.0",
		id: Date.now(),
		method,
		params,
	});
	const resp = await fetch(getArtifactEngineURL(), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body,
		signal: AbortSignal.timeout(10000),
	});
	if (!resp.ok) return {};
	const json = (await resp.json()) as Record<string, unknown>;
	if (json.error) return {};
	return (json.result as Record<string, unknown>) ?? {};
}

function isArtifactsEngineAvailable(): boolean {
	return process.env.ARTIFACT_ENGINE_DISABLED !== "1";
}

function extractArtifactIds(text: string): string[] {
	const ids: string[] = [];
	const pattern = new RegExp(REF_PATTERN.source, "g");
	let match = pattern.exec(text);
	while (match !== null) {
		ids.push(match[1]);
		match = pattern.exec(text);
	}
	return ids;
}

function estimateMessageTokens(messages: Message[]): number {
	let total = 0;
	for (const msg of messages) {
		if (msg.type === "user" || msg.type === "assistant") {
			const content = msg.message.content;
			if (typeof content === "string") {
				total += roughTokenCountEstimation(content);
			} else if (Array.isArray(content)) {
				for (const block of content) {
					if (
						typeof block === "object" &&
						block !== null &&
						"text" in block &&
						typeof block.text === "string"
					) {
						total += roughTokenCountEstimation(block.text);
					}
				}
			}
		}
	}
	return total;
}

async function fetchRemoteBudget(): Promise<ArtifactBudget | null> {
	try {
		const windowSize = getContextWindowForModel("default");
		const result = await artifactsRPC("context.budget", {
			context_window: windowSize,
		});
		if (result && typeof result.total_artifact_tokens === "number") {
			const totalArtifactTokens = result.total_artifact_tokens as number;
			const usedTokens = estimateMessageTokens([]) + totalArtifactTokens;
			const usageRatio = windowSize > 0 ? usedTokens / windowSize : 0;
			return { usedTokens, windowSize, usageRatio };
		}
	} catch {
		// fallback to local estimation
	}
	return null;
}

function computeBudget(messages: Message[]): ArtifactBudget {
	const windowSize = getContextWindowForModel("default");
	const usedTokens = estimateMessageTokens(messages);
	const usageRatio = windowSize > 0 ? usedTokens / windowSize : 0;
	return { usedTokens, windowSize, usageRatio };
}

async function fetchArtifactContent(
	artifactId: string,
	previewOnly: boolean,
): Promise<{
	content: string | null;
	name: string;
	type: string;
	tokenCount: number;
	sections?: Array<{ anchor: string; tokens: number }>;
	summary?: string;
} | null> {
	try {
		const params: Record<string, unknown> = {
			artifact_id: artifactId,
			preview_only: previewOnly,
		};
		const result = await artifactsRPC("artifact.load", params);
		if (result && (result.content !== undefined || result.sections)) {
			return {
				content: (result.content as string | null) ?? null,
				name: (result.title as string) ?? artifactId,
				type: (result.type as string) ?? "code",
				tokenCount: (result.total_tokens as number) ?? 0,
				sections: result.sections as
					| Array<{ anchor: string; tokens: number }>
					| undefined,
				summary: result.summary as string | undefined,
			};
		}
		return null;
	} catch (err) {
		logError(
			new Error(`artifact injection fetch failed for ${artifactId}: ${err}`),
		);
		return null;
	}
}

function wrapContentInCodeBlock(
	content: string,
	name: string,
	type: string,
): string {
	const langMap: Record<string, string> = {
		code: "",
		markdown: "markdown",
		html: "html",
		react: "jsx",
		data: "json",
	};
	const lang = langMap[type] ?? "";
	return `\n\`\`\`${lang}\n// Artifact: ${name}\n${content}\n\`\`\`\n`;
}

function wrapPreviewOnly(
	artifactId: string,
	name: string,
	type: string,
	tokenCount: number,
	firstLines: string,
): string {
	return `\n[Artifact preview (budget mode): ${name} | ID: ${artifactId} | Type: ${type} | Tokens: ${tokenCount}]\n${firstLines}\n[...content truncated — use LoadArtifact to view full content]\n`;
}

export async function injectArtifactsIntoMessages(
	messages: Message[],
): Promise<InjectionResult> {
	if (!isArtifactsEngineAvailable()) {
		return { messages, injectedCount: 0, totalTokensInjected: 0 };
	}

	let budget = await fetchRemoteBudget();
	if (!budget) {
		budget = computeBudget(messages);
	}
	let injectedCount = 0;
	let totalTokensInjected = 0;
	const contentCache = new Map<
		string,
		{ replacement: string; tokens: number }
	>();

	const processedMessages = await Promise.all(
		messages.map(async (msg): Promise<Message> => {
			if (msg.type !== "user" && msg.type !== "assistant") return msg;

			const rawContent =
				msg.type === "user" ? msg.message.content : msg.message.content;
			const content = typeof rawContent === "string" ? rawContent : "";
			const artifactIds = extractArtifactIds(content);
			if (artifactIds.length === 0) return msg;

			let newContent = content;
			for (const artId of artifactIds) {
				if (!contentCache.has(artId)) {
					const needPreview =
						budget.usageRatio >= BUDGET_WARN_PCT ||
						budget.usageRatio >= BUDGET_HARD_PCT;
					const artifact = await fetchArtifactContent(artId, needPreview);
					if (artifact) {
						const artifactTokens = artifact.tokenCount;
						const projectedRatio =
							budget.windowSize > 0
								? (budget.usedTokens + totalTokensInjected + artifactTokens) /
									budget.windowSize
								: 0;

						if (budget.usageRatio >= BUDGET_HARD_PCT) {
							const sectionList = artifact.sections
								? artifact.sections
										.map((s) => `${s.anchor} (${s.tokens}t)`)
										.join(", ")
								: "N/A";
							contentCache.set(artId, {
								replacement: `[Artifact: ${artifact.name} | ID: ${artId} | Type: ${artifact.type} | Tokens: ${artifactTokens} — injection blocked: context >${Math.round(BUDGET_HARD_PCT * 100)}% full]\nSections: ${sectionList}\nUse LoadArtifact with section parameter to load specific parts.`,
								tokens: 0,
							});
						} else if (
							budget.usageRatio >= BUDGET_WARN_PCT ||
							projectedRatio >= BUDGET_HARD_PCT
						) {
							if (artifact.content) {
								const lines = artifact.content.split("\n");
								const previewLines = lines.slice(0, 10).join("\n");
								contentCache.set(artId, {
									replacement: wrapPreviewOnly(
										artId,
										artifact.name,
										artifact.type,
										artifactTokens,
										previewLines,
									),
									tokens: roughTokenCountEstimation(previewLines),
								});
							} else {
								const sectionList = artifact.sections
									? artifact.sections
											.map((s) => `${s.anchor} (${s.tokens}t)`)
											.join(", ")
									: "N/A";
								const summary = artifact.summary ?? "";
								contentCache.set(artId, {
									replacement: `\n[Artifact preview (budget mode): ${artifact.name} | ID: ${artId} | Type: ${artifact.type} | Tokens: ${artifactTokens}]\nSections: ${sectionList}\n${summary ? `Summary: ${summary}\n` : ""}[...use LoadArtifact with section parameter to load specific parts]\n`,
									tokens: roughTokenCountEstimation(
										sectionList + (summary ?? ""),
									),
								});
							}
						} else {
							const fullContent = artifact.content ?? "";
							const full = wrapContentInCodeBlock(
								fullContent,
								artifact.name,
								artifact.type,
							);
							contentCache.set(artId, {
								replacement: full,
								tokens: artifactTokens,
							});
						}
					}
				}
				const cached = contentCache.get(artId);
				if (cached) {
					const refRegex = new RegExp(
						`\\[Artifact:\\s*[^\\]]*?\\|\\s*ID:\\s*${artId}\\s*\\|[^\\]]*\\]`,
						"g",
					);
					newContent = newContent.replace(refRegex, cached.replacement);
					injectedCount++;
					totalTokensInjected += cached.tokens;
				}
			}

			if (newContent === content) return msg;

			if (msg.type === "user" && Array.isArray(msg.message.content)) {
				const blocks = msg.message.content.map((block) => {
					if (block.type === "text" && typeof block.text === "string") {
						const ids = extractArtifactIds(block.text);
						if (ids.length === 0) return block;
						let text = block.text;
						for (const artId2 of ids) {
							const cached = contentCache.get(artId2);
							if (cached) {
								const refRegex = new RegExp(
									`\\[Artifact:\\s*[^\\]]*?\\|\\s*ID:\\s*${artId2}\\s*\\|[^\\]]*\\]`,
									"g",
								);
								text = text.replace(refRegex, cached.replacement);
							}
						}
						return { ...block, text };
					}
					return block;
				});
				return {
					...msg,
					message: { ...msg.message, content: blocks },
				} as Message;
			}

			return {
				...msg,
				message: { ...msg.message, content: newContent },
			} as Message;
		}),
	);

	return { messages: processedMessages, injectedCount, totalTokensInjected };
}
