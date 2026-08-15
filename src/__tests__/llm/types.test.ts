// LLM 接缝中立类型 — 结构与契约单测
//
// 验证: (1) 中立类型可被适配器实现满足; (2) chunk 联合可按 type 穷举 (exhaustive);
// (3) 错误码集合稳定。纯类型层, 不涉及网络。

import { describe, expect, test } from "bun:test";
import type {
    FinishReason,
    LlmAdapter,
    LlmErrorCode,
    LlmFailure,
    StreamChunk,
} from "../../services/llm/types.js";

// 一个最小可用适配器: 把预设 chunk 流式吐出, 用于验证 LlmAdapter 契约。
function makeFakeAdapter(chunks: StreamChunk[]): LlmAdapter {
    return {
        async *stream(_options) {
            for (const c of chunks) {
                yield c;
            }
        },
    };
}

async function collect(iter: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
    const out: StreamChunk[] = [];
    for await (const c of iter) {
        out.push(c);
    }
    return out;
}

describe("llm neutral types", () => {
    test("adapter.stream yields chunks in order", async () => {
        const adapter = makeFakeAdapter([
            { type: "message-start", usage: { inputTokens: 10, outputTokens: 0 } },
            { type: "block-start", index: 0, block: { type: "text", text: "" } },
            { type: "text-delta", index: 0, text: "hello" },
            { type: "block-end", index: 0 },
            { type: "usage", usage: { inputTokens: 10, outputTokens: 5 } },
            { type: "finish", reason: "end_turn" },
        ]);
        const got = await collect(adapter.stream({ model: "m", messages: [] }));
        expect(got.map((c) => c.type)).toEqual([
            "message-start",
            "block-start",
            "text-delta",
            "block-end",
            "usage",
            "finish",
        ]);
    });

    test("StreamChunk type union is exhaustive over known events", () => {
        const all: StreamChunk["type"][] = [
            "message-start",
            "block-start",
            "text-delta",
            "thinking-delta",
            "tool-call-delta",
            "connector-delta",
            "block-end",
            "usage",
            "finish",
        ];
        // 编译期穷尽性: switch 覆盖所有分支, default 不可达。
        const seen = new Set<string>();
        for (const c of all) {
            switch (c) {
                case "message-start":
                case "block-start":
                case "text-delta":
                case "thinking-delta":
                case "tool-call-delta":
                case "connector-delta":
                case "block-end":
                case "usage":
                case "finish":
                    seen.add(c);
                    break;
                default: {
                    const _exhaustive: never = c;
                    throw new Error(`unhandled chunk type: ${_exhaustive as string}`);
                }
            }
        }
        expect(seen.size).toBe(all.length);
    });

    test("LlmFailure carries stable error codes", () => {
        const codes: LlmErrorCode[] = [
            "AUTH",
            "RATE_LIMIT",
            "INVALID_REQUEST",
            "SERVER",
            "TIMEOUT",
            "TRANSPORT",
            "ABORTED",
        ];
        const f: LlmFailure = {
            code: "RATE_LIMIT",
            message: "429",
            status: 429,
            providerRetryAfterMs: 1000,
        };
        expect(codes).toContain(f.code);
        expect(f.status).toBe(429);
    });

    test("FinishReason covers terminal states including aborted/error", () => {
        const reasons: FinishReason[] = [
            "end_turn",
            "tool_use",
            "max_tokens",
            "stop_sequence",
            "aborted",
            "error",
        ];
        expect(new Set(reasons).size).toBe(reasons.length);
    });
});
