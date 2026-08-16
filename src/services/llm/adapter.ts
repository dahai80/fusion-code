// LLM 接缝 — Anthropic Wire Adapter
//
// 把 provider 中立的 GenerateOptions 翻译成 POST /v1/messages 的 JSON body,
// 并把 SSE 事件流 (parseSseStream 产出) 翻译成 provider 中立的 StreamChunk。
// 替代 @anthropic-ai/sdk 的 beta.messages.create({stream:true}) + BetaMessageStream。
//
// 本适配器只做协议翻译, 不做领域逻辑 (contentBlocks 累积/usage 合并/stop_reason
// 处理仍在 claude.ts 主循环, Phase 4 把它的 switch 从 SDK part 改为消费 StreamChunk)。
//
// 请求体字段映射依据 src/services/api/claude.ts:1539 paramsFromContext 的实际形状。

import { type PostMessagesOptions, postMessages } from "./httpClient.js";
import { parseSseStream } from "./sseStream.js";
import type {
	FinishReason,
	GenerateOptions,
	LlmAdapter,
	NeutralContentBlock,
	NeutralMessage,
	NeutralSystemBlock,
	RawContentBlock,
	StreamChunk,
	ToolSchema,
} from "./types.js";

// 把 NeutralMessage[] 翻译成 Anthropic messages 数组 (string content 直传,
// 块数组按类型映射; tool_result 的 content 透传)。
function toAnthropicMessages(
	messages: NeutralMessage[],
): Record<string, unknown>[] {
	return messages.map((m) => {
		if (typeof m.content === "string") {
			return { role: m.role, content: m.content };
		}
		const blocks = m.content.map(toAnthropicBlock);
		return { role: m.role, content: blocks };
	});
}

// 单个 NeutralContentBlock -> Anthropic content block。
function toAnthropicBlock(b: NeutralContentBlock): Record<string, unknown> {
	switch (b.type) {
		case "text":
			return { type: "text", text: b.text };
		case "thinking":
			return {
				type: "thinking",
				thinking: b.thinking,
				...(b.signature !== undefined && { signature: b.signature }),
			};
		case "tool_use":
			// input 可能是 string (部分 JSON) 或对象; 透传给服务端
			return {
				type: "tool_use",
				id: b.id,
				name: b.name,
				input: b.input,
			};
		case "tool_result":
			return {
				type: "tool_result",
				tool_use_id: b.tool_use_id,
				content: b.content,
				...(b.is_error !== undefined && { is_error: b.is_error }),
			};
	}
}

function toAnthropicTool(t: ToolSchema): Record<string, unknown> {
	return {
		name: t.name,
		description: t.description,
		input_schema: t.parameters,
	};
}

// 把 GenerateOptions 翻译成 /v1/messages 请求体。
// 仅映射中立类型能表达的字段; betas/metadata/tool_choice/output_config/speed/
// context_management 等扩展字段由调用方通过 extraBody 透传 (Phase 4 接入时补)。
export function buildRequestBody(
	options: GenerateOptions,
	extraBody?: Record<string, unknown>,
): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model: options.model,
		messages: toAnthropicMessages(options.messages),
		max_tokens: options.maxTokens ?? 4096,
		stream: true,
	};
	if (options.system !== undefined) {
		body.system =
			typeof options.system === "string"
				? options.system
				: options.system.map((b: NeutralSystemBlock) => ({
						type: "text",
						text: b.text,
						...(b.cache_control !== undefined && {
							cache_control: b.cache_control,
						}),
					}));
	}
	if (options.tools && options.tools.length > 0) {
		body.tools = options.tools.map(toAnthropicTool);
	}
	if (options.temperature !== undefined) {
		body.temperature = options.temperature;
	}
	if (options.stop && options.stop.length > 0) {
		body.stop_sequences = options.stop;
	}
	if (options.thinking && options.thinking.type === "enabled") {
		body.thinking = {
			type: "enabled",
			budget_tokens: options.thinking.budgetTokens,
		};
	}
	if (extraBody) {
		Object.assign(body, extraBody);
	}
	return body;
}

// SSE 翻译的累加状态 (仅本模块内部用, 持有最近 usage 与 stop_reason)。
export interface SseState {
	lastUsage?: { inputTokens: number; outputTokens: number };
	stopReason?: string;
}

// content_block_start 的 content_block -> RawContentBlock (中立)。
function toRawBlock(block: Record<string, unknown>): RawContentBlock {
	const type = (block.type as string) ?? "text";
	const out: RawContentBlock = {
		type: type as RawContentBlock["type"],
	};
	if (typeof block.text === "string") out.text = block.text;
	if (typeof block.thinking === "string") out.thinking = block.thinking;
	if (typeof block.signature === "string") out.signature = block.signature;
	if (typeof block.id === "string") out.id = block.id;
	if (typeof block.name === "string") out.name = block.name;
	// tool_use 的 input 在 block-start 常为 {}, 累积由 input_json_delta 完成
	if (block.input !== undefined) out.input = block.input as string;
	return out;
}

function usageFrom(u: unknown): { inputTokens: number; outputTokens: number } {
	const r = (u ?? {}) as {
		input_tokens?: number;
		output_tokens?: number;
	};
	return {
		inputTokens: r.input_tokens ?? 0,
		outputTokens: r.output_tokens ?? 0,
	};
}

// 从 stop_reason 推断 FinishReason。
function toFinishReason(stopReason: string | undefined): FinishReason {
	switch (stopReason) {
		case "end_turn":
		case "tool_use":
		case "max_tokens":
		case "stop_sequence":
			return stopReason;
		case "model_context_window_exceeded":
			return "max_tokens";
		default:
			return "end_turn";
	}
}

// SSE 事件 data (JSON 字符串) -> StreamChunk。返回 null 表示忽略 (ping/citations 等)。
// 事件类型与字段依据 claude.ts:1975 switch。
// 导出供单测直接验证 SSE->chunk 映射 (不经过网络)。
export function sseToChunk(
	event: string,
	data: string,
	state: SseState,
): StreamChunk | null {
	let p: Record<string, unknown> = {};
	if (data !== "") {
		try {
			p = JSON.parse(data) as Record<string, unknown>;
		} catch {
			// log: 非 JSON 的 error 事件仍须抛出 (SDK 用 safeJSON ?? raw 兜底),
			// 其他事件 (message_start 等) 解析失败则忽略, 维持原行为。
			if (event === "error") {
				const thrown = new Error(data || "stream error");
				thrown.name = "APIError";
				throw thrown;
			}
			return null;
		}
	}

	switch (event) {
		case "message_start": {
			const message = (p.message ?? {}) as Record<string, unknown>;
			if (message.usage) state.lastUsage = usageFrom(message.usage);
			return {
				type: "message-start",
				usage: state.lastUsage,
			};
		}
		case "content_block_start": {
			const index = (p.index as number) ?? 0;
			const block = (p.content_block ?? {}) as Record<string, unknown>;
			return {
				type: "block-start",
				index,
				block: toRawBlock(block),
			};
		}
		case "content_block_delta": {
			const index = (p.index as number) ?? 0;
			const delta = (p.delta ?? {}) as Record<string, unknown>;
			switch (delta.type as string) {
				case "text_delta":
					return {
						type: "text-delta",
						index,
						text: (delta.text as string) ?? "",
					};
				case "thinking_delta":
					return {
						type: "thinking-delta",
						index,
						text: (delta.thinking as string) ?? "",
					};
				case "signature_delta":
					// signature 归到 thinking 块; 零宽 thinking-delta 携带 signature
					return {
						type: "thinking-delta",
						index,
						text: "",
						signature: (delta.signature as string) ?? "",
					};
				case "input_json_delta":
					return {
						type: "tool-call-delta",
						index,
						argumentsDelta: (delta.partial_json as string) ?? "",
					};
				case "connector_text_delta":
					return {
						type: "connector-delta",
						index,
						text: (delta.connector_text as string) ?? "",
					};
				case "citations_delta":
				default:
					return null;
			}
		}
		case "content_block_stop":
			return { type: "block-end", index: (p.index as number) ?? 0 };
		case "message_delta": {
			const usage = p.usage
				? usageFrom(p.usage)
				: (state.lastUsage ?? { inputTokens: 0, outputTokens: 0 });
			state.lastUsage = usage;
			const delta = (p.delta ?? {}) as Record<string, unknown>;
			let stopReason: string | undefined;
			if (typeof delta.stop_reason === "string") {
				state.stopReason = delta.stop_reason;
				stopReason = delta.stop_reason;
			}
			return { type: "usage", usage, stopReason };
		}
		case "message_stop":
			return { type: "finish", reason: toFinishReason(state.stopReason) };
		case "ping":
			return null;
		case "error": {
			// log: 流中 error 事件 — SDK 在 core/streaming.js:62 对此抛 APIError, withRetry
			// 据此重试/分类。这里同样抛出, 避免 mid-stream 错误被静默吞掉导致流无 finish 地截断。
			// 错误体形如 {"type":"error","error":{"type":"overloaded_error","message":"..."}}。
			const errBody = p as {
				error?: { type?: string; message?: string };
				message?: string;
			};
			const msg =
				errBody?.error?.message ?? errBody?.message ?? data ?? "stream error";
			const thrown = new Error(msg) as Error & { status?: number };
			thrown.name = "APIError";
			// 透传 status (若有) 供 withRetry isApiErrorLike + classifyByStatus 重试分类。
			if (typeof p.status === "number") thrown.status = p.status;
			throw thrown;
		}
		default:
			return null;
	}
}

// Anthropic Wire Adapter — 通过 httpClient POST /v1/messages, SSE -> StreamChunk。
export class AnthropicWireAdapter implements LlmAdapter {
	private readonly postOpts: Omit<PostMessagesOptions, "body" | "signal">;

	constructor(postOpts: Omit<PostMessagesOptions, "body" | "signal">) {
		this.postOpts = postOpts;
	}

	providerInfo(): { id: string; name: string } {
		return { id: "anthropic", name: "Anthropic" };
	}

	async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
		const body = buildRequestBody(options);
		const { response } = await postMessages({
			...this.postOpts,
			body: JSON.stringify(body),
			signal: options.signal,
		});
		if (!response.body) {
			throw new Error("AnthropicWireAdapter: response body missing");
		}
		const state: SseState = {};
		for await (const evt of parseSseStream(response.body, options.signal)) {
			const chunk = sseToChunk(evt.event, evt.data, state);
			if (chunk) yield chunk;
		}
	}
}

// 接缝开关: 仅在 LLM_ADAPTER_SEAM feature 开启时启用新适配器路径。
// 关闭时 (默认) 走 SDK, 相关代码被 DCE 消除。
// 注意: feature() 是 Bun bundle DCE 宏, 只能直接用在 if/三元里, 不能包在返回它的
// 函数中 (否则运行时抛错)。调用方需直接写 feature("LLM_ADAPTER_SEAM") 判定。
