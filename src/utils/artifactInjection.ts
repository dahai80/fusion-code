import type { Message } from "../types/message.js";
import { getArtifactEngineURL } from "./artifactConfig.js";
import { getContextWindowForModel } from "./context.js";
import { logError } from "./log.js";
import { roughTokenCountEstimation } from "../services/tokenEstimation.js";

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
	let match: RegExpExecArray | null;
	const pattern = new RegExp(REF_PATTERN.source, "g");
	while ((match = pattern.exec(text)) !== null) {
		ids.push(match[1]);
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

function computeBudget(messages: Message[]): ArtifactBudget {
	const windowSize = getContextWindowForModel("default");
	const usedTokens = estimateMessageTokens(messages);
	const usageRatio = windowSize > 0 ? usedTokens / windowSize : 0;
	return { usedTokens, windowSize, usageRatio };
}

async function fetchArtifactContent(
	artifactId: string,
): Promise<{
	content: string;
	name: string;
	type: string;
	tokenCount: number;
} | null> {
	try {
		const result = await artifactsRPC("artifact.get_content", {
			artifact_id: artifactId,
		});
		if (result.content && typeof result.content === "string") {
			return {
				content: result.content as string,
				name: (result.name as string) ?? artifactId,
				type: (result.type as string) ?? "code",
				tokenCount: (result.token_count as number) ?? 0,
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

	const budget = computeBudget(messages);
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
					const artifact = await fetchArtifactContent(artId);
					if (artifact) {
						const artifactTokens =
							artifact.tokenCount ||
							roughTokenCountEstimation(artifact.content);
						const projectedRatio =
							budget.windowSize > 0
								? (budget.usedTokens +
										totalTokensInjected +
										artifactTokens) /
									budget.windowSize
								: 0;

						if (budget.usageRatio >= BUDGET_HARD_PCT) {
							contentCache.set(artId, {
								replacement: `[Artifact: ${artifact.name} | ID: ${artId} | Type: ${artifact.type} | Tokens: ${artifactTokens} — injection blocked: context >${Math.round(BUDGET_HARD_PCT * 100)}% full]`,
								tokens: 0,
							});
						} else if (
							budget.usageRatio >= BUDGET_WARN_PCT ||
							projectedRatio >= BUDGET_HARD_PCT
						) {
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
							const full = wrapContentInCodeBlock(
								artifact.content,
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
						for (const artId of ids) {
							const cached = contentCache.get(artId);
							if (cached) {
								const refRegex = new RegExp(
									`\\[Artifact:\\s*[^\\]]*?\\|\\s*ID:\\s*${artId}\\s*\\|[^\\]]*\\]`,
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
