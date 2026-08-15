// SSE 解析单测 — 覆盖多行 data / event / 注释 / 跨 chunk 边界 / 中断

import { describe, expect, test } from "bun:test";
import { parseSseStream } from "../../services/llm/sseStream.js";

// 从字符串序列构造 ReadableStream (每个字符串模拟一个到达的 chunk)。
function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            for (const c of chunks) {
                controller.enqueue(encoder.encode(c));
            }
            controller.close();
        },
    });
}

async function collect(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
    const out: { event: string; data: string }[] = [];
    for await (const e of parseSseStream(body, signal)) {
        out.push({ event: e.event, data: e.data });
    }
    return out;
}

describe("parseSseStream", () => {
    test("single data event", async () => {
        const body = makeStream(["data: hello\n\n"]);
        expect(await collect(body)).toEqual([{ event: "message", data: "hello" }]);
    });

    test("multi-line data joined with newline", async () => {
        const body = makeStream(["data: line1\ndata: line2\n\n"]);
        expect(await collect(body)).toEqual([
            { event: "message", data: "line1\nline2" },
        ]);
    });

    test("event field sets type", async () => {
        const body = makeStream(["event: content_block_start\ndata: {}\n\n"]);
        expect(await collect(body)).toEqual([
            { event: "content_block_start", data: "{}" },
        ]);
    });

    test("comment and heartbeat lines ignored", async () => {
        const body = makeStream([": heartbeat\ndata: a\n\n: comment\n\n"]);
        expect(await collect(body)).toEqual([{ event: "message", data: "a" }]);
    });

    test("exactly one leading space after colon stripped (SSE spec)", async () => {
        // SSE 规范: 冒号后仅剥一个可选空格, 其余保留
        const body = makeStream(["data:   spaced\n\n"]);
        expect(await collect(body)).toEqual([{ event: "message", data: "  spaced" }]);
    });

    test("chunk split across boundary carries buffer", async () => {
        const body = makeStream(["data: hel", "lo\n\n"]);
        expect(await collect(body)).toEqual([{ event: "message", data: "hello" }]);
    });

    test("multiple events in one chunk", async () => {
        const body = makeStream(["data: one\n\ndata: two\n\n"]);
        expect(await collect(body)).toEqual([
            { event: "message", data: "one" },
            { event: "message", data: "two" },
        ]);
    });

    test("trailing event without final empty line still dispatched", async () => {
        const body = makeStream(["event: finish\ndata: done\n\n"]);
        expect(await collect(body)).toEqual([
            { event: "finish", data: "done" },
        ]);
    });

    test("abort signal throws AbortError", async () => {
        const ac = new AbortController();
        const body = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode("data: x"));
                ac.abort();
                controller.close();
            },
        });
        await expect(collect(body, ac.signal)).rejects.toBeInstanceOf(DOMException);
    });

    test("empty data field yields empty string", async () => {
        const body = makeStream(["data:\n\n"]);
        expect(await collect(body)).toEqual([{ event: "message", data: "" }]);
    });
});
