/**
 * Fusion-MLX 流式响应适配器
 *
 * 将 fusion-mlx 的 SSE 流（OpenAI-compatible /v1/chat/completions）
 * 转换为 Anthropic Messages API 格式的流式事件，
 * 以便复用 fusion-code 现有的流式处理逻辑。
 */

import { logForDebugging } from "../../utils/debug.js";
import { validateToolCall } from "./fusion-mlx-tool-validator.js";
import type {
	MLXResponseToolCall,
	MLXStreamChunk,
	MLXUsage,
} from "./fusion-mlx-types.js";

// ─── Anthropic-compatible stream event types ──────────────────

export type AnthropicStreamEvent =
	| AnthropicMessageStart
	| AnthropicContentBlockStart
	| AnthropicContentBlockDelta
	| AnthropicContentBlockStop
	| AnthropicMessageDelta
	| AnthropicMessageStop
	| AnthropicPing;

export interface AnthropicMessageStart {
	type: "message_start";
	message: {
		id: string;
		type: "message";
		role: "assistant";
		content: [];
		model: string;
		stop_reason: null;
		stop_sequence: null;
		usage: {
			input_tokens: number;
			output_tokens: number;
			cache_creation_input_tokens?: number;
			cache_read_input_tokens?: number;
		};
	};
}

export interface AnthropicContentBlockStart {
	type: "content_block_start";
	index: number;
	content_block:
		| { type: "text"; text: string }
		| {
				type: "tool_use";
				id: string;
				name: string;
				input: Record<string, unknown>;
		  }
		| { type: "thinking"; thinking: string };
}

export interface AnthropicContentBlockDelta {
	type: "content_block_delta";
	index: number;
	delta:
		| { type: "text_delta"; text: string }
		| { type: "input_json_delta"; partial_json: string }
		| { type: "thinking_delta"; thinking: string }
		| { type: "signature_delta"; signature: string };
}

export interface AnthropicContentBlockStop {
	type: "content_block_stop";
	index: number;
}

export interface AnthropicMessageDelta {
	type: "message_delta";
	delta: { stop_reason: string; stop_sequence: string | null };
	usage: {
		input_tokens: number;
		output_tokens: number;
		cache_creation_input_tokens?: number;
		cache_read_input_tokens?: number;
	};
}

export interface AnthropicMessageStop {
	type: "message_stop";
}

export interface AnthropicPing {
	type: "ping";
}

// ─── Stream State ─────────────────────────────────────────────

interface StreamState {
	messageId: string;
	model: string;
	contentIndex: number;
	currentToolCall: {
		index: number;
		id: string;
		name: string;
		arguments: string;
	} | null;
	textBlockOpen: boolean;
	thinkingBlockOpen: boolean;
	textBuffer: string;
	emittedTextLen: number;
	holdMode: boolean;
	holdTrigger: "wrapper" | "bareJson" | "echo" | null;
	toolCalls: MLXResponseToolCall[];
	usage: MLXUsage;
	finishReason: string | null;
}

function createInitialState(model: string): StreamState {
	return {
		messageId: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
		model,
		contentIndex: 0,
		currentToolCall: null,
		textBlockOpen: false,
		thinkingBlockOpen: false,
		textBuffer: "",
		emittedTextLen: 0,
		holdMode: false,
		holdTrigger: null,
		toolCalls: [],
		usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
		finishReason: null,
	};
}

// ─── Tool-call marker detection (smart buffering) ────────────
// Local models often emit tool calls as text markup (<tool_call>, <function=...>)
// or as bare JSON ({"name":"Bash","arguments":{...}}). Plain text is emitted
// immediately for responsiveness; once a marker is detected we switch to hold
// mode and stop emitting so the markup never reaches the UI. The buffered
// markup is parsed into tool_use blocks at stream end.
// - wrapper: explicit tool-call markup -> dropped if extraction fails (malformed)
// - bareJson: bare JSON tool calls -> flushed if extraction fails, because a
//   {"name": ...} object with no "arguments" may be legitimate JSON (e.g. a
//   package.json) that must not be silently dropped.
const TOOL_CALL_MARKERS: { text: string; kind: "wrapper" | "bareJson" }[] = [
	{ text: "<tool_call>", kind: "wrapper" },
	{ text: "<tools>", kind: "wrapper" },
	{ text: "<function=", kind: "wrapper" },
	{ text: '{"name"', kind: "bareJson" },
	{ text: '{"function"', kind: "bareJson" },
];

function findToolCallMarker(
	str: string,
): { index: number; marker: string; kind: "wrapper" | "bareJson" } | null {
	let best: {
		index: number;
		marker: string;
		kind: "wrapper" | "bareJson";
	} | null = null;
	for (const m of TOOL_CALL_MARKERS) {
		const idx = str.indexOf(m.text);
		if (idx >= 0 && (!best || idx < best.index)) {
			best = { index: idx, marker: m.text, kind: m.kind };
		}
	}
	return best;
}

function matchingMarkerPrefixLen(str: string): number {
	let max = 0;
	for (const m of TOOL_CALL_MARKERS) {
		const limit = Math.min(str.length, m.text.length);
		for (let k = limit; k >= 1; k--) {
			if (str.endsWith(m.text.slice(0, k))) {
				if (k > max) max = k;
				break;
			}
		}
	}
	return max;
}

// ─── Tool-definition echo detection ───────────────────────────
// Local models under memory pressure sometimes echo the OpenAI tool-spec
// objects we sent ({"type":"function","function":{"name":...,"parameters":...}})
// back as plain text instead of responding. That signature never appears in
// legitimate assistant output, so a response opening with '{' is held
// tentatively; once the signature is seen the whole echo is suppressed and
// replaced with a diagnostic at stream end.
const ECHO_PROBE_CHAR_LIMIT = 160;
const TOOL_DEFINITION_ECHO_RE =
	/"\s*type"\s*:\s*"function"\s*,\s*"function"\s*:\s*\{/;

function isToolDefinitionEcho(text: string): boolean {
	return TOOL_DEFINITION_ECHO_RE.test(text);
}

const MLX_ECHO_DIAGNOSTIC =
	"⚠️ The local model echoed the tool definitions / system prompt instead of " +
	"producing a response (no valid output). This can happen with local models " +
	"under memory pressure or with very large contexts. Try /compact, reduce the " +
	"context, free memory, or switch to a cloud model (FUSION_BASE_URL / FUSION_API_KEY).";

function pushTextDelta(
	state: StreamState,
	events: AnthropicStreamEvent[],
	text: string,
): void {
	if (!text) return;
	if (!state.textBlockOpen) {
		events.push({
			type: "content_block_start",
			index: state.contentIndex++,
			content_block: { type: "text", text: "" },
		});
		state.textBlockOpen = true;
	}
	events.push({
		type: "content_block_delta",
		index: state.contentIndex - 1,
		delta: { type: "text_delta", text },
	});
}

// ─── Main Stream Transformer ───────────────────────────────────

async function readMLXChunkWithIdleTimeout(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	timeoutMs: number,
): Promise<{ done: boolean; value?: Uint8Array }> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	const TIMEOUT_MSG = "MLX_STREAM_IDLE_TIMEOUT";
	const timeoutPromise = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(TIMEOUT_MSG)), timeoutMs);
	});
	try {
		return await Promise.race([reader.read(), timeoutPromise]);
	} catch (e) {
		const err = e as Error;
		if (err.message === TIMEOUT_MSG) {
			logForDebugging(
				`[Fusion-MLX Stream] Idle timeout: no data for ${timeoutMs / 1000}s, cancelling stream`,
				{ level: "error" },
			);
			await reader.cancel().catch(() => {});
			throw new Error(
				`[Fusion-MLX Stream] Idle timeout: no data for ${timeoutMs / 1000}s, stream cancelled`,
			);
		}
		// AbortError(用户 ESC)或流错误:cancel reader 防泄漏,再原样抛出(与 #1 abort 协调)
		logForDebugging(
			`[Fusion-MLX Stream] read failed (${err.name}: ${err.message}), cancelling reader`,
			{ level: "warn" },
		);
		await reader.cancel().catch(() => {});
		throw e;
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/**
 * 将 fusion-mlx SSE 流转换为 Anthropic 格式的流式事件。
 * 返回一个 AsyncGenerator，产出 AnthropicStreamEvent。
 */
export async function* transformMLXStreamToAnthropic(
	response: Response,
	model: string,
	inputTokens?: number,
): AsyncGenerator<AnthropicStreamEvent> {
	const state = createInitialState(model);

	if (!response.body) {
		throw new Error("MLX stream response has no body");
	}

	// Emit message_start
	yield {
		type: "message_start",
		message: {
			id: state.messageId,
			type: "message",
			role: "assistant",
			content: [],
			model: state.model,
			stop_reason: null,
			stop_sequence: null,
			usage: {
				input_tokens: inputTokens ?? 0,
				output_tokens: 0,
			},
		},
	};

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let chunkIdx = 0;

	const MLX_STREAM_IDLE_TIMEOUT_MS =
		parseInt(process.env.FUSION_MLX_STREAM_IDLE_TIMEOUT_MS || "", 10) || 90_000;

	while (true) {
		const { done, value } = await readMLXChunkWithIdleTimeout(
			reader,
			MLX_STREAM_IDLE_TIMEOUT_MS,
		);
		if (done) break;
		console.error(
		);
		chunkIdx++;

		buffer += decoder.decode(value, { stream: true });

		// Parse SSE events
		const lines = buffer.split("\n");
		buffer = lines.pop() || ""; // Keep incomplete line in buffer

		for (const line of lines) {
			if (line.startsWith("data: ")) {
				const data = line.slice(6).trim();
				if (data === "[DONE]") continue;

				let parsed: MLXStreamChunk;
				try {
					parsed = JSON.parse(data) as MLXStreamChunk;
				} catch {
					// Skip unparseable chunks
					continue;
				}
				// 检测 MLX 流式 error chunk(fusion-mlx 生成中错误时可能发 {error:...}),fail visibly 而非静默跳过
				const errField = (parsed as unknown as Record<string, unknown>).error; // log: intermediate unknown cast
				if (errField) {
					const errObj = errField as { message?: string };
					const errMsg = (errObj && errObj.message) || JSON.stringify(errField);
					logForDebugging(
						`[Fusion-MLX Stream] Mid-stream error chunk: ${errMsg}`,
						{ level: "error" },
					);
					throw new Error(
						`[Fusion-MLX Stream] MLX mid-stream error: ${errMsg}`,
					);
				}
				const events = processChunk(parsed, state);
				for (const event of events) {
					yield event;
				}
			}
		}
	}

	// Process remaining buffer
	if (buffer.startsWith("data: ")) {
		const data = buffer.slice(6).trim();
		if (data !== "[DONE]") {
			try {
				const parsed = JSON.parse(data) as MLXStreamChunk;
				const events = processChunk(parsed, state);
				for (const event of events) {
					yield event;
				}
			} catch {
				// Skip
			}
		}
	}

	// Close any pending thinking block
	if (state.thinkingBlockOpen) {
		yield {
			type: "content_block_stop",
			index: state.contentIndex - 1,
		};
		state.thinkingBlockOpen = false;
	}

	// Close any pending content block (structured tool calls from MLX)
	if (state.currentToolCall) {
		logForDebugging(
			`[Fusion-MLX Stream] Closing pending tool_call: ${state.currentToolCall.name}, args_len=${state.currentToolCall.arguments.length}`,
		);
		// 流式 max_tokens 截断(finish_reason=length)导致 tool_call arguments 不完整:fail visibly 记录
		// 完整修复需 QueryEngine 下一轮 max_tokens 升级联动,流式层只能记录
		if (state.finishReason === "length") {
			logForDebugging(
				`[Fusion-MLX Stream] tool_call truncated by max_tokens (finish_reason=length): ${state.currentToolCall.name}, arguments may be incomplete`,
				{ level: "error" },
			);
		}
		yield {
			type: "content_block_stop",
			index: state.contentIndex - 1,
		};
		state.currentToolCall = null;
	}

	// Check for text-embedded tool calls from local models.
	// This runs regardless of textBlockOpen state because processChunk
	// may have already closed the text block when it saw finish_reason,
	// but we still need to extract tool calls from the textBuffer.
	if (state.textBuffer && !state.currentToolCall) {
		const extractedTools = extractToolCallsFromText(state.textBuffer);
		if (extractedTools.length > 0) {
			// If text block is still open, close it first
			if (state.textBlockOpen) {
				yield {
					type: "content_block_stop",
					index: state.contentIndex - 1,
				};
				state.textBlockOpen = false;
			}

			// Emit each extracted tool call as a proper tool_use block
			for (const tool of extractedTools) {
				const rawArgs = JSON.stringify(tool.input);
				const validation = validateToolCall(rawArgs);
				const finalInput =
					validation.valid && validation.repaired
						? (validation.repaired as Record<string, unknown>)
						: tool.input;
				if (!validation.valid) {
					logForDebugging(
						`[Fusion-MLX Stream] Tool call validation failed for ${tool.name}: ${validation.error}, using raw input`,
					);
				}
				const argsJson = JSON.stringify(finalInput);
				yield {
					type: "content_block_start",
					index: state.contentIndex++,
					content_block: {
						type: "tool_use",
						id: tool.id,
						name: tool.name,
						input: {},
					},
				};
				yield {
					type: "content_block_delta",
					index: state.contentIndex - 1,
					delta: {
						type: "input_json_delta",
						partial_json: argsJson,
					},
				};
				yield {
					type: "content_block_stop",
					index: state.contentIndex - 1,
				};
			}
			// Override stop reason to tool_use
			if (state.finishReason === "stop") {
				state.finishReason = "tool_calls";
			}
		} else {
			// No tool calls extracted.
			if (state.holdTrigger === "echo") {
				// Model echoed tool definitions instead of responding; emit a short
				// diagnostic so the user sees a clear message, not the raw echo.
				if (!state.textBlockOpen) {
					yield {
						type: "content_block_start",
						index: state.contentIndex++,
						content_block: { type: "text", text: "" },
					};
					state.textBlockOpen = true;
				}
				yield {
					type: "content_block_delta",
					index: state.contentIndex - 1,
					delta: { type: "text_delta", text: MLX_ECHO_DIAGNOSTIC },
				};
				state.emittedTextLen = state.textBuffer.length;
			} else if (!state.holdMode || state.holdTrigger === "bareJson") {
				// Flow mode: flush a partial marker prefix held back as a false alarm.
				// Also flush bare-JSON holds whose extraction failed: a {"name": ...}
				// object without "arguments" may be legitimate JSON (e.g. package.json)
				// and must not be silently dropped.
				const held = state.textBuffer.slice(state.emittedTextLen);
				if (held) {
					if (!state.textBlockOpen) {
						yield {
							type: "content_block_start",
							index: state.contentIndex++,
							content_block: { type: "text", text: "" },
						};
						state.textBlockOpen = true;
					}
					yield {
						type: "content_block_delta",
						index: state.contentIndex - 1,
						delta: { type: "text_delta", text: held },
					};
					state.emittedTextLen = state.textBuffer.length;
				}
			}
			// wrapper holdMode + extraction failed (e.g. unknown tool name): drop the
			// buffered markup rather than leaking it to the UI as plain text.
			if (state.textBlockOpen) {
				yield {
					type: "content_block_stop",
					index: state.contentIndex - 1,
				};
				state.textBlockOpen = false;
			}
		}
	} else if (state.textBlockOpen) {
		yield {
			type: "content_block_stop",
			index: state.contentIndex - 1,
		};
		state.textBlockOpen = false;
	}

	// Emit message_delta
	const stopReason = mapFinishReason(state.finishReason);
	yield {
		type: "message_delta",
		delta: {
			stop_reason: stopReason,
			stop_sequence: null,
		},
		usage: {
			input_tokens: state.usage.prompt_tokens,
			output_tokens: state.usage.completion_tokens,
		},
	};

	yield { type: "message_stop" };
}

function processChunk(
	chunk: MLXStreamChunk,
	state: StreamState,
): AnthropicStreamEvent[] {
	const events: AnthropicStreamEvent[] = [];

	if ("choices" in chunk && chunk.choices?.length > 0) {
		const choice = chunk.choices[0];

		// Narrow the type — only stream-chunk choices have delta
		if (!("delta" in choice) || !choice.delta) return events;
		const delta = choice.delta;

		// Handle reasoning_content (Qwen3 thinking mode)
		// Emit as thinking_delta events — NOT added to textBuffer
		if (delta.reasoning_content) {
			if (!state.thinkingBlockOpen) {
				events.push({
					type: "content_block_start",
					index: state.contentIndex++,
					content_block: { type: "thinking", thinking: "" },
				});
				state.thinkingBlockOpen = true;
			}
			events.push({
				type: "content_block_delta",
				index: state.contentIndex - 1,
				delta: { type: "thinking_delta", thinking: delta.reasoning_content },
			});
		}

		// Close thinking block when non-thinking content arrives
		if ((delta.content || delta.tool_calls) && state.thinkingBlockOpen) {
			events.push({
				type: "content_block_stop",
				index: state.contentIndex - 1,
			});
			state.thinkingBlockOpen = false;
		}

		// Handle content text — buffer to detect text-embedded tool calls
		// Local models often emit tool calls as text markup (<tool_call>, <function=...>).
		// Plain text emits immediately; on marker detection we hold back the markup.
		if (delta.content) {
			state.textBuffer += delta.content;

			// If we have a pending tool call block, close it first
			if (state.currentToolCall) {
				logForDebugging(
					`[Fusion-MLX Stream] Text after tool_call, closing: ${state.currentToolCall.name}`,
				);
				events.push({
					type: "content_block_stop",
					index: state.contentIndex - 1,
				});
				state.currentToolCall = null;
			}

			if (state.holdMode) {
				// Markup detected earlier; keep buffering silently until stream end.
			} else {
				const pending = state.textBuffer.slice(state.emittedTextLen);
				// Echo probe: a response opening with '{' may be the model echoing
				// the OpenAI tool-spec objects. Hold tentatively so the echo never
				// reaches the UI; classify once enough text has arrived.
				const echoProbe = state.emittedTextLen === 0 && pending.startsWith("{");
				if (echoProbe && isToolDefinitionEcho(state.textBuffer)) {
					state.holdMode = true;
					state.holdTrigger = "echo";
					logForDebugging(
						`[Fusion-MLX Stream] Hold mode on (tool-definition echo), suppressing`,
						{ level: "warn" },
					);
				} else {
					const marker = findToolCallMarker(pending);
					if (marker) {
						if (marker.index > 0) {
							pushTextDelta(state, events, pending.slice(0, marker.index));
							state.emittedTextLen += marker.index;
						}
						state.holdMode = true;
						state.holdTrigger = marker.kind;
						logForDebugging(
							`[Fusion-MLX Stream] Hold mode on (suppressing ${marker.kind} markup): ${marker.marker}`,
						);
					} else if (
						echoProbe &&
						state.textBuffer.length < ECHO_PROBE_CHAR_LIMIT
					) {
						// Hold the opening '{' tentatively; decide once more text arrives.
					} else {
						const plen = matchingMarkerPrefixLen(pending);
						const safeLen = pending.length - plen;
						if (safeLen > 0) {
							pushTextDelta(state, events, pending.slice(0, safeLen));
							state.emittedTextLen += safeLen;
						}
					}
				}
			}
		}

		// Handle tool calls
		if (delta.tool_calls) {
			for (const tc of delta.tool_calls) {
				if (tc.function?.name) {
					// New tool call — close text block if open, emit tool_use start
					logForDebugging(
						`[Fusion-MLX Stream] New tool_call: ${tc.function.name} id=${tc.id}`,
					);
					if (state.textBlockOpen) {
						events.push({
							type: "content_block_stop",
							index: state.contentIndex - 1,
						});
						state.textBlockOpen = false;
						state.textBuffer = "";
					}

					state.currentToolCall = {
						index: tc.index,
						id: tc.id,
						name: tc.function.name,
						arguments: tc.function.arguments || "",
					};

					events.push({
						type: "content_block_start",
						index: state.contentIndex++,
						content_block: {
							type: "tool_use",
							id: tc.id,
							name: tc.function.name,
							input: {},
						},
					});

					// 如果第一个 chunk 就带有 arguments，立即发出 input_json_delta
					if (tc.function?.arguments) {
						events.push({
							type: "content_block_delta",
							index: state.contentIndex - 1,
							delta: {
								type: "input_json_delta",
								partial_json: tc.function.arguments,
							},
						});
					}
				} else if (state.currentToolCall && tc.function?.arguments) {
					// Accumulate tool call arguments
					state.currentToolCall.arguments += tc.function.arguments;
					events.push({
						type: "content_block_delta",
						index: state.contentIndex - 1,
						delta: {
							type: "input_json_delta",
							partial_json: tc.function.arguments,
						},
					});
				}
			}
		}

		// Handle finish reason
		if (choice.finish_reason) {
			state.finishReason = choice.finish_reason;

			// Close pending structured tool call blocks only.
			// Text blocks are left open for the generator's end-of-stream
			// logic to check for text-embedded tool calls before closing.
			if (state.currentToolCall) {
				events.push({
					type: "content_block_stop",
					index: state.contentIndex - 1,
				});
				state.currentToolCall = null;
			}
		}
	}

	// Handle usage from final chunk
	if ("usage" in chunk && chunk.usage) {
		state.usage = chunk.usage;
	}

	return events;
}

// ─── Non-streaming response converter ─────────────────────────

export interface AnthropicNonStreamingResponse {
	id: string;
	type: "message";
	role: "assistant";
	content: Array<
		| { type: "text"; text: string }
		| {
				type: "tool_use";
				id: string;
				name: string;
				input: Record<string, unknown>;
		  }
	>;
	model: string;
	stop_reason: string | null;
	stop_sequence: string | null;
	usage: {
		input_tokens: number;
		output_tokens: number;
		cache_creation_input_tokens?: number;
		cache_read_input_tokens?: number;
	};
}

/**
 * 将 fusion-mlx 非流式响应转换为 Anthropic Messages API 格式。
 */
export function transformMLXResponseToAnthropic(mlxResponse: {
	id: string;
	model: string;
	choices: Array<{
		message: {
			role: string;
			content: string | null;
			reasoning_content?: string | null;
			tool_calls?: MLXResponseToolCall[];
		};
		finish_reason: string | null;
	}>;
	usage: MLXUsage;
}): AnthropicNonStreamingResponse {
	const choice = mlxResponse.choices[0];
	const content: AnthropicNonStreamingResponse["content"] = [];

	// Qwen3 thinking mode: reasoning_content is the thinking block, separate from content
	const reasoningContent =
		choice.message.reasoning_content ||
		(choice.message as any).reasoning_content;
	if (reasoningContent) {
		content.push({
			type: "thinking",
			thinking: reasoningContent,
		} as any);
	}

	const rawContent = choice.message.content || "";

	// First: extract structured tool_calls from OpenAI format
	if (choice.message.tool_calls) {
		for (const tc of choice.message.tool_calls) {
			let parsedInput: Record<string, unknown>;
			const rawArgs = tc.function.arguments || "{}";
			const validation = validateToolCall(rawArgs);
			if (validation.valid) {
				parsedInput = validation.repaired as Record<string, unknown>;
				if (validation.error) {
					logForDebugging(
						`[Fusion-MLX] Tool call auto-repaired for ${tc.function.name}: ${validation.error}`,
					);
				}
			} else {
				logForDebugging(
					`[Fusion-MLX] Tool call validation failed for ${tc.function.name}: ${validation.error}, attempting legacy repair`,
				);
				const repaired = repairToolCallJson(rawArgs);
				try {
					parsedInput = JSON.parse(repaired);
				} catch {
					logForDebugging(
						`[Fusion-MLX] Tool call repair also failed for ${tc.function.name}, skipping malformed tool call`,
					);
					continue;
				}
			}
			content.push({
				type: "tool_use",
				id: tc.id,
				name: tc.function.name,
				input: parsedInput,
			});
		}
	}

	// Second: if no structured tool_calls, try extracting from text content
	// Many local models output tool calls as text like:
	//   <tools>{"name": "Read", "arguments": {"file_path": "/tmp/test.txt"}}</tools>
	//   or: ```json\n{"name": "Read", "arguments": {...}}\n```
	if (!choice.message.tool_calls && rawContent) {
		const extractedTools = extractToolCallsFromText(rawContent);
		if (extractedTools.length > 0) {
			for (const tool of extractedTools) {
				content.push({
					type: "tool_use",
					id: tool.id,
					name: tool.name,
					input: tool.input,
				});
			}
			// Remove the raw tool text from the text content
			let cleanedText = rawContent;
			for (const tool of extractedTools) {
				cleanedText = cleanedText.replace(tool._rawMatch, "").trim();
			}
			// Only include text if there's meaningful content left
			if (cleanedText && cleanedText.length > 5) {
				content.unshift({ type: "text", text: cleanedText });
			}
		} else {
			content.push({ type: "text", text: rawContent });
		}
	} else if (rawContent && choice.message.tool_calls) {
		// Both text content and structured tool_calls
		content.unshift({ type: "text", text: rawContent });
	}

	return {
		id: mlxResponse.id,
		type: "message",
		role: "assistant",
		content,
		model: mlxResponse.model,
		stop_reason: content.some((c) => c.type === "tool_use")
			? "tool_use"
			: mapFinishReason(choice.finish_reason),
		stop_sequence: null,
		usage: {
			input_tokens: mlxResponse.usage.prompt_tokens,
			output_tokens: mlxResponse.usage.completion_tokens,
		},
	};
}

// ─── Helpers ──────────────────────────────────────────────────

function mapFinishReason(
	reason: string | null,
): "end_turn" | "max_tokens" | "tool_use" | "stop_sequence" | null {
	switch (reason) {
		case "stop":
			return "end_turn";
		case "length":
			return "max_tokens";
		case "tool_calls":
			return "tool_use";
		default:
			return null;
	}
}

const KNOWN_TOOL_NAMES = [
	"Read",
	"Edit",
	"Write",
	"Glob",
	"Grep",
	"Bash",
	"Agent",
	"TaskCreate",
	"TaskUpdate",
	"TaskGet",
	"TaskList",
	"WebSearch",
	"WebFetch",
	"LSP",
	"NotebookEdit",
	"Skill",
	"EnterPlanMode",
	"ExitPlanMode",
	"SendMessage",
	"CronCreate",
	"CronDelete",
	"CronList",
	"AskUserQuestion",
	"ReportFindings",
] as const;

const KNOWN_TOOL_NAME_SET = new Set<string>(KNOWN_TOOL_NAMES);
const KNOWN_TOOL_LOWER_MAP = new Map<string, string>();
for (const name of KNOWN_TOOL_NAMES) {
	KNOWN_TOOL_LOWER_MAP.set(name.toLowerCase(), name);
}

function extractBalancedJson(text: string, startIdx: number): string | null {
	let depth = 0;
	let inString = false;
	let escape = false;
	for (let i = startIdx; i < text.length; i++) {
		const ch = text[i];
		if (escape) {
			escape = false;
			continue;
		}
		if (ch === "\\" && inString) {
			escape = true;
			continue;
		}
		if (ch === '"') {
			inString = !inString;
			continue;
		}
		if (inString) continue;
		if (ch === "{" || ch === "[") depth++;
		if (ch === "}" || ch === "]") {
			depth--;
			if (depth === 0) return text.slice(startIdx, i + 1);
		}
	}
	return null;
}

function normalizeToolName(raw: string): string | null {
	if (KNOWN_TOOL_NAME_SET.has(raw)) return raw;
	const lower = raw.toLowerCase();
	const mapped = KNOWN_TOOL_LOWER_MAP.get(lower);
	if (mapped) return mapped;
	const stripSuffix = lower.replace(/_?(file|tool|command|action)$/i, "");
	const suffixMapped = KNOWN_TOOL_LOWER_MAP.get(stripSuffix);
	if (suffixMapped) return suffixMapped;
	return null;
}

/**
 * Extract tool calls embedded in text output by local models.
 *
 * Supported formats:
 *   <tools>{"name": "Read", "arguments": {...}}</tools>
 *   Function call syntax: Read({file_path: "/path"})
 *   JSON code blocks with name + arguments
 *   Bare JSON object with "name" and "arguments" keys
 *   OpenAI format: {"function": {"name": "Read", "arguments": "..."}}
 *   Case-insensitive tool names: read({file_path: ...}), EDIT({...})
 *
 * Internal return type — no API change.
 */
function extractToolCallsFromText(text: string): Array<{
	id: string;
	name: string;
	input: Record<string, unknown>;
	_rawMatch: string;
}> {
	const results: Array<{
		id: string;
		name: string;
		input: Record<string, unknown>;
		_rawMatch: string;
	}> = [];

	const xmlPattern = /<(?:tools|tool_call)>([\s\S]*?)<\/(?:tools|tool_call)>/g;
	let match: RegExpExecArray | null;
	while ((match = xmlPattern.exec(text)) !== null) {
		const inner = match[1].trim();
		const parsed = tryParseToolCallJson(inner);
		if (parsed) {
			const normalizedName = normalizeToolName(parsed.name);
			if (!normalizedName) continue;
			results.push({
				id: `toolu_${Date.now()}_${results.length}`,
				name: normalizedName,
				input: parsed.arguments || {},
				_rawMatch: match[0],
			});
		}
	}

	if (results.length > 0) return results;

	// Pattern 2: Function call syntax — ToolName({key: value}) or toolName({key: value})
	const funcCallPattern =
		/\b([A-Za-z][A-Za-z_0-9]*)\s*\(\s*(\{[\s\S]*?\})\s*\)/g;
	while ((match = funcCallPattern.exec(text)) !== null) {
		const toolName = normalizeToolName(match[1]);
		if (!toolName) continue;
		const argsStr = match[2];
		const parsed = tryParseArgsJson(argsStr);
		if (parsed) {
			results.push({
				id: `toolu_${Date.now()}_${results.length}`,
				name: toolName,
				input: parsed,
				_rawMatch: match[0],
			});
		}
	}

	if (results.length > 0) return results;

	// Pattern 3: JSON code blocks with name + arguments
	const cbp = /`{3}(?:json)?\s*\n?([\s\S]*?)`{3}/g;
	while ((match = cbp.exec(text)) !== null) {
		const inner = match[1].trim();
		const parsed = tryParseToolCallJson(inner);
		if (parsed) {
			const normalizedName = normalizeToolName(parsed.name);
			if (!normalizedName) continue;
			results.push({
				id: `toolu_${Date.now()}_${results.length}`,
				name: normalizedName,
				input: parsed.arguments || {},
				_rawMatch: match[0],
			});
		}
	}

	if (results.length > 0) return results;

	// Pattern 4: Bare JSON object with "name" and "arguments"/"parameters" keys
	const bjp =
		/\{[\s\S]*?"name"\s*:\s*"(\w+)"[\s\S]*?(?:"arguments"|"parameters")\s*:\s*\{[\s\S]*?\}[\s\S]*?\}/g;
	while ((match = bjp.exec(text)) !== null) {
		const parsed = tryParseToolCallJson(match[0]);
		if (parsed) {
			const normalizedName = normalizeToolName(parsed.name);
			if (!normalizedName) continue;
			results.push({
				id: `toolu_${Date.now()}_${results.length}`,
				name: normalizedName,
				input: parsed.arguments || {},
				_rawMatch: match[0],
			});
		}
	}

	if (results.length > 0) return results;

	// Pattern 5: OpenAI-style {"function": {"name": "...", "arguments": "..."}}
	// Regex can't handle nested JSON in arguments, so extract balanced JSON objects
	const oaiStartPattern = /\{\s*"function"\s*:\s*\{/g;
	let oaiStart: RegExpExecArray | null;
	while ((oaiStart = oaiStartPattern.exec(text)) !== null) {
		const jsonStr = extractBalancedJson(text, oaiStart.index);
		if (jsonStr) {
			const parsed = tryParseToolCallJson(jsonStr);
			if (parsed) {
				const toolName = normalizeToolName(parsed.name);
				if (!toolName) continue;
				results.push({
					id: `toolu_${Date.now()}_${results.length}`,
					name: toolName,
					input: parsed.arguments || {},
					_rawMatch: jsonStr,
				});
			}
		}
	}

	if (results.length > 0) return results;

	// Pattern 6: <function=Name><parameter=key>value</parameter>... </function>
	// Qwen models output this format when tool_call_style is not structured
	const funcXmlPattern =
		/<function=([A-Za-z_][A-Za-z0-9_]*)>([\s\S]*?)<\/function>/g;
	while ((match = funcXmlPattern.exec(text)) !== null) {
		const toolName = normalizeToolName(match[1]);
		if (!toolName) continue;
		const inner = match[2].trim();
		const args: Record<string, unknown> = {};
		const paramPattern =
			/<parameter=([A-Za-z_][A-Za-z0-9_]*)>([\s\S]*?)<\/parameter>/g;
		let paramMatch: RegExpExecArray | null;
		while ((paramMatch = paramPattern.exec(inner)) !== null) {
			args[paramMatch[1]] = paramMatch[2].trim();
		}
		if (Object.keys(args).length > 0) {
			results.push({
				id: `toolu_${Date.now()}_${results.length}`,
				name: toolName,
				input: args,
				_rawMatch: match[0],
			});
		}
	}

	return results;
}

function tryParseToolCallJson(
	raw: string,
): { name: string; arguments: Record<string, unknown> } | null {
	try {
		const obj = JSON.parse(raw);
		if (
			obj &&
			typeof obj.name === "string" &&
			typeof obj.arguments === "object"
		) {
			return obj as { name: string; arguments: Record<string, unknown> };
		}
		if (obj?.function?.name && obj?.function?.arguments) {
			const args =
				typeof obj.function.arguments === "string"
					? JSON.parse(obj.function.arguments)
					: obj.function.arguments;
			return { name: obj.function.name, arguments: args };
		}
		if (
			obj &&
			typeof obj.tool_name === "string" &&
			typeof obj.arguments === "object"
		) {
			return { name: obj.tool_name, arguments: obj.arguments };
		}
		if (
			obj &&
			typeof obj.name === "string" &&
			typeof obj.parameters === "object"
		) {
			return {
				name: obj.name,
				arguments: obj.parameters as Record<string, unknown>,
			};
		}
		return null;
	} catch {
		const repaired = repairToolCallJson(raw);
		try {
			const obj = JSON.parse(repaired);
			if (
				obj &&
				typeof obj.name === "string" &&
				typeof obj.arguments === "object"
			) {
				return obj as { name: string; arguments: Record<string, unknown> };
			}
			if (obj?.function?.name && obj?.function?.arguments) {
				const args =
					typeof obj.function.arguments === "string"
						? JSON.parse(obj.function.arguments)
						: obj.function.arguments;
				return { name: obj.function.name, arguments: args };
			}
			return null;
		} catch {
			return null;
		}
	}
}

function tryParseArgsJson(raw: string): Record<string, unknown> | null {
	try {
		const obj = JSON.parse(raw);
		if (obj && typeof obj === "object" && !Array.isArray(obj)) {
			return obj as Record<string, unknown>;
		}
		return null;
	} catch {
		const repaired = repairToolCallJson(raw);
		try {
			const obj = JSON.parse(repaired);
			if (obj && typeof obj === "object" && !Array.isArray(obj)) {
				return obj as Record<string, unknown>;
			}
			return null;
		} catch {
			return null;
		}
	}
}

function repairToolCallJson(raw: string): string {
	let s = raw.trim();
	s = s.replace(/^`{3}(?:json)?\s*/i, "").replace(/\s*`{3}$/i, "");
	const openBraces = (s.match(/\{/g) || []).length;
	const closeBraces = (s.match(/\}/g) || []).length;
	for (let i = 0; i < openBraces - closeBraces; i++) s += "}";
	const openParens = (s.match(/\[/g) || []).length;
	const closeParens = (s.match(/\]/g) || []).length;
	for (let i = 0; i < openParens - closeParens; i++) s += "]";
	s = s.replace(/,\s*([}\]])/g, "$1");
	s = s.replace(/'/g, '"');
	s = s.replace(/:\s*([a-zA-Z_][a-zA-Z0-9_]*)\s([,}\]])/g, ': "$1"$2');
	s = s.replace(/:\s*([a-zA-Z_][a-zA-Z0-9_]*)$/g, ': "$1"');
	return s;
}

// ─── SSE Encode (for fetch adapter) ───────────────────────────

/**
 * Encode AnthropicStreamEvent AsyncGenerator to SSE stream Response.
 */
export async function encodeStreamToAnthropicSSE(
	stream: AsyncGenerator<AnthropicStreamEvent>,
	originalResponse: Response,
): Promise<Response> {
	const encoder = new TextEncoder();
	const STREAM_TIMEOUT_MS = 300_000;

	const streamBody = new ReadableStream({
		async start(controller) {
			const timeoutHandle = setTimeout(() => {
				try {
					const errorEvent = {
						type: "error",
						error: {
							type: "timeout_error",
							message: "Stream timed out after 5 minutes",
						},
					};
					controller.enqueue(
						encoder.encode(
							`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`,
						),
					);
				} catch {
					// controller may already be closed
				} finally {
					try {
						controller.close();
					} catch {
						/* ignore */
					}
				}
			}, STREAM_TIMEOUT_MS);

			try {
				for await (const event of stream) {
					const line = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
					controller.enqueue(encoder.encode(line));
				}
			} catch (error) {
				const errorEvent = {
					type: "error",
					error: {
						type: "api_error",
						message: `Stream error: ${(error as Error).message}`,
					},
				};
				try {
					controller.enqueue(
						encoder.encode(
							`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`,
						),
					);
				} catch {
					// controller may already be closed
				}
			} finally {
				clearTimeout(timeoutHandle);
				try {
					controller.close();
				} catch {
					/* ignore */
				}
			}
		},
	});

	return new Response(streamBody, {
		status: 200,
		headers: {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			connection: "keep-alive",
			...Object.fromEntries(originalResponse.headers.entries()),
		},
	});
}
