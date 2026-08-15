// AnthropicWireAdapter 单测 — 请求体构造 + SSE->StreamChunk 映射 (不经网络)

import { describe, expect, test } from "bun:test";
import {
    buildRequestBody,
    sseToChunk,
    type SseState,
} from "../../services/llm/adapter.js";
import type { GenerateOptions } from "../../services/llm/types.js";

function baseOptions(over: Partial<GenerateOptions> = {}): GenerateOptions {
    return {
        model: "claude-test",
        messages: [{ role: "user", content: "hi" }],
        ...over,
    };
}

describe("buildRequestBody", () => {
    test("minimal request has model/messages/max_tokens/stream", () => {
        const body = buildRequestBody(baseOptions());
        expect(body.model).toBe("claude-test");
        expect(body.stream).toBe(true);
        expect(body.max_tokens).toBe(4096);
        expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    });

    test("respects custom maxTokens", () => {
        const body = buildRequestBody(baseOptions({ maxTokens: 100 }));
        expect(body.max_tokens).toBe(100);
    });

    test("string system maps to system string", () => {
        const body = buildRequestBody(baseOptions({ system: "be brief" }));
        expect(body.system).toBe("be brief");
    });

    test("block system maps to array with cache_control", () => {
        const body = buildRequestBody({
            model: "m",
            messages: [],
            system: [{ type: "text", text: "sys", cache_control: { type: "ephemeral" } }],
        });
        expect(body.system).toEqual([
            { type: "text", text: "sys", cache_control: { type: "ephemeral" } },
        ]);
    });

    test("tools map to input_schema", () => {
        const body = buildRequestBody(
            baseOptions({
                tools: [
                    {
                        name: "get_weather",
                        description: "weather",
                        parameters: { type: "object", properties: {} },
                    },
                ],
            }),
        );
        expect(body.tools).toEqual([
            {
                name: "get_weather",
                description: "weather",
                input_schema: { type: "object", properties: {} },
            },
        ]);
    });

    test("tool_use block passes input through", () => {
        const body = buildRequestBody({
            model: "m",
            messages: [
                {
                    role: "assistant",
                    content: [
                        { type: "tool_use", id: "t1", name: "f", input: { a: 1 } },
                    ],
                },
            ],
        });
        expect(body.messages).toEqual([
            {
                role: "assistant",
                content: [{ type: "tool_use", id: "t1", name: "f", input: { a: 1 } }],
            },
        ]);
    });

    test("tool_result block maps tool_use_id and is_error", () => {
        const body = buildRequestBody({
            model: "m",
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "tool_result",
                            tool_use_id: "t1",
                            content: "ok",
                            is_error: false,
                        },
                    ],
                },
            ],
        });
        expect(body.messages).toEqual([
            {
                role: "user",
                content: [
                    {
                        type: "tool_result",
                        tool_use_id: "t1",
                        content: "ok",
                        is_error: false,
                    },
                ],
            },
        ]);
    });

    test("thinking enabled maps budget_tokens", () => {
        const body = buildRequestBody(
            baseOptions({ thinking: { type: "enabled", budgetTokens: 2048 } }),
        );
        expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
    });

    test("temperature and stop_sequences mapped", () => {
        const body = buildRequestBody(
            baseOptions({ temperature: 0.5, stop: ["END"] }),
        );
        expect(body.temperature).toBe(0.5);
        expect(body.stop_sequences).toEqual(["END"]);
    });

    test("extraBody merges top-level keys", () => {
        const body = buildRequestBody(baseOptions(), { betas: ["b1"], metadata: { k: "v" } });
        expect(body.betas).toEqual(["b1"]);
        expect(body.metadata).toEqual({ k: "v" });
    });
});

describe("sseToChunk", () => {
    test("message_start yields message-start with usage", () => {
        const st: SseState = {};
        const c = sseToChunk(
            "message_start",
            JSON.stringify({ message: { usage: { input_tokens: 10, output_tokens: 0 } } }),
            st,
        );
        expect(c).toEqual({
            type: "message-start",
            usage: { inputTokens: 10, outputTokens: 0 },
        });
    });

    test("content_block_start tool_use yields block-start", () => {
        const st: SseState = {};
        const c = sseToChunk(
            "content_block_start",
            JSON.stringify({
                index: 0,
                content_block: { type: "tool_use", id: "t1", name: "f", input: {} },
            }),
            st,
        );
        expect(c).toMatchObject({
            type: "block-start",
            index: 0,
            block: { type: "tool_use", id: "t1", name: "f" },
        });
    });

    test("text_delta yields text-delta", () => {
        const c = sseToChunk(
            "content_block_delta",
            JSON.stringify({ index: 0, delta: { type: "text_delta", text: "abc" } }),
            {},
        );
        expect(c).toEqual({ type: "text-delta", index: 0, text: "abc" });
    });

    test("thinking_delta yields thinking-delta", () => {
        const c = sseToChunk(
            "content_block_delta",
            JSON.stringify({ index: 1, delta: { type: "thinking_delta", thinking: "hmm" } }),
            {},
        );
        expect(c).toEqual({ type: "thinking-delta", index: 1, text: "hmm" });
    });

    test("signature_delta yields thinking-delta with signature", () => {
        const c = sseToChunk(
            "content_block_delta",
            JSON.stringify({ index: 1, delta: { type: "signature_delta", signature: "sig" } }),
            {},
        );
        expect(c).toEqual({ type: "thinking-delta", index: 1, text: "", signature: "sig" });
    });

    test("input_json_delta yields tool-call-delta", () => {
        const c = sseToChunk(
            "content_block_delta",
            JSON.stringify({ index: 0, delta: { type: "input_json_delta", partial_json: '{"a":' } }),
            {},
        );
        expect(c).toEqual({ type: "tool-call-delta", index: 0, argumentsDelta: '{"a":' });
    });

    test("connector_text_delta yields connector-delta", () => {
        const c = sseToChunk(
            "content_block_delta",
            JSON.stringify({ index: 2, delta: { type: "connector_text_delta", connector_text: "x" } }),
            {},
        );
        expect(c).toEqual({ type: "connector-delta", index: 2, text: "x" });
    });

    test("citations_delta ignored (null)", () => {
        const c = sseToChunk(
            "content_block_delta",
            JSON.stringify({ index: 0, delta: { type: "citations_delta", citation: {} } }),
            {},
        );
        expect(c).toBeNull();
    });

    test("content_block_stop yields block-end", () => {
        const c = sseToChunk("content_block_stop", JSON.stringify({ index: 0 }), {});
        expect(c).toEqual({ type: "block-end", index: 0 });
    });

    test("message_delta records stop_reason and yields usage", () => {
        const st: SseState = {};
        const c = sseToChunk(
            "message_delta",
            JSON.stringify({
                usage: { input_tokens: 10, output_tokens: 42 },
                delta: { stop_reason: "end_turn" },
            }),
            st,
        );
        expect(c).toEqual({ type: "usage", usage: { inputTokens: 10, outputTokens: 42 } });
        expect(st.stopReason).toBe("end_turn");
    });

    test("message_stop yields finish with recorded reason", () => {
        const st: SseState = { stopReason: "tool_use" };
        const c = sseToChunk("message_stop", "", st);
        expect(c).toEqual({ type: "finish", reason: "tool_use" });
    });

    test("message_stop defaults to end_turn when no reason", () => {
        const c = sseToChunk("message_stop", "", {});
        expect(c).toEqual({ type: "finish", reason: "end_turn" });
    });

    test("model_context_window_exceeded maps to max_tokens", () => {
        const st: SseState = { stopReason: "model_context_window_exceeded" };
        const c = sseToChunk("message_stop", "", st);
        expect(c).toEqual({ type: "finish", reason: "max_tokens" });
    });

    test("ping ignored", () => {
        expect(sseToChunk("ping", "", {})).toBeNull();
    });

    test("malformed JSON ignored", () => {
        expect(sseToChunk("message_start", "{not json", {})).toBeNull();
    });
});
