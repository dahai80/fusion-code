// StreamChunk -> SDK part 翻译器单测 — 验证逆映射 + usage snake_case + stop_reason 时序

import { describe, expect, test } from "bun:test";
import {
	chunkStreamToSdkParts,
	chunkToSdkPart,
} from "../../services/llm/chunkToPart.js";
import type { StreamChunk } from "../../services/llm/types.js";

async function collect(chunks: StreamChunk[]) {
	const out: { type: string; [k: string]: unknown }[] = [];
	for await (const p of chunkStreamToSdkParts(
		(async function* () {
			for (const c of chunks) yield c;
		})(),
	)) {
		out.push(p);
	}
	return out;
}

describe("chunkToSdkPart", () => {
	test("message-start -> message_start with snake_case usage", () => {
		const p = chunkToSdkPart(
			{ type: "message-start", usage: { inputTokens: 10, outputTokens: 0 } },
			{},
		);
		expect(p).toMatchObject({
			type: "message_start",
			message: { usage: { input_tokens: 10, output_tokens: 0 } },
		});
	});

	test("block-start tool_use -> content_block_start", () => {
		const p = chunkToSdkPart(
			{
				type: "block-start",
				index: 0,
				block: { type: "tool_use", id: "t1", name: "f" },
			},
			{},
		);
		expect(p).toEqual({
			type: "content_block_start",
			index: 0,
			content_block: { type: "tool_use", id: "t1", name: "f" },
		});
	});

	test("text-delta -> text_delta", () => {
		const p = chunkToSdkPart({ type: "text-delta", index: 0, text: "abc" }, {});
		expect(p).toEqual({
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text: "abc" },
		});
	});

	test("thinking-delta (no signature) -> thinking_delta", () => {
		const p = chunkToSdkPart(
			{ type: "thinking-delta", index: 1, text: "hmm" },
			{},
		);
		expect(p).toEqual({
			type: "content_block_delta",
			index: 1,
			delta: { type: "thinking_delta", thinking: "hmm" },
		});
	});

	test("thinking-delta (with signature) -> signature_delta", () => {
		const p = chunkToSdkPart(
			{ type: "thinking-delta", index: 1, text: "", signature: "sig" },
			{},
		);
		expect(p).toEqual({
			type: "content_block_delta",
			index: 1,
			delta: { type: "signature_delta", signature: "sig" },
		});
	});

	test("tool-call-delta -> input_json_delta", () => {
		const p = chunkToSdkPart(
			{ type: "tool-call-delta", index: 0, argumentsDelta: '{"a":' },
			{},
		);
		expect(p).toEqual({
			type: "content_block_delta",
			index: 0,
			delta: { type: "input_json_delta", partial_json: '{"a":' },
		});
	});

	test("connector-delta -> connector_text_delta", () => {
		const p = chunkToSdkPart(
			{ type: "connector-delta", index: 2, text: "x" },
			{},
		);
		expect(p).toEqual({
			type: "content_block_delta",
			index: 2,
			delta: { type: "connector_text_delta", connector_text: "x" },
		});
	});

	test("block-end -> content_block_stop", () => {
		const p = chunkToSdkPart({ type: "block-end", index: 0 }, {});
		expect(p).toEqual({ type: "content_block_stop", index: 0 });
	});

	test("usage with stopReason -> message_delta with delta.stop_reason", () => {
		const st: { stopReason?: string } = {};
		const p = chunkToSdkPart(
			{
				type: "usage",
				usage: { inputTokens: 10, outputTokens: 42 },
				stopReason: "tool_use",
			},
			st,
		);
		expect(p).toEqual({
			type: "message_delta",
			usage: { input_tokens: 10, output_tokens: 42 },
			delta: { stop_reason: "tool_use" },
		});
		expect(st.stopReason).toBe("tool_use");
	});

	test("finish -> message_stop", () => {
		const p = chunkToSdkPart({ type: "finish", reason: "end_turn" }, {});
		expect(p).toEqual({ type: "message_stop" });
	});
});

describe("chunkStreamToSdkParts (full sequence)", () => {
	test("emits parts in order matching SDK event sequence", async () => {
		const chunks: StreamChunk[] = [
			{ type: "message-start", usage: { inputTokens: 5, outputTokens: 0 } },
			{ type: "block-start", index: 0, block: { type: "text" } },
			{ type: "text-delta", index: 0, text: "Hello" },
			{ type: "block-end", index: 0 },
			{
				type: "usage",
				usage: { inputTokens: 5, outputTokens: 3 },
				stopReason: "end_turn",
			},
			{ type: "finish", reason: "end_turn" },
		];
		const parts = await collect(chunks);
		expect(parts.map((p) => p.type)).toEqual([
			"message_start",
			"content_block_start",
			"content_block_delta",
			"content_block_stop",
			"message_delta",
			"message_stop",
		]);
		// message_delta 携带 stop_reason (switch 在 message_delta case 读取 part.delta.stop_reason)
		const md = parts[4];
		expect(md.delta).toEqual({ stop_reason: "end_turn" });
	});

	test("tool_use sequence: block-start + json deltas + block-end", async () => {
		const chunks: StreamChunk[] = [
			{
				type: "block-start",
				index: 0,
				block: { type: "tool_use", id: "t1", name: "get_weather" },
			},
			{ type: "tool-call-delta", index: 0, argumentsDelta: '{"city":"SF"}' },
			{ type: "block-end", index: 0 },
			{
				type: "usage",
				usage: { inputTokens: 0, outputTokens: 0 },
				stopReason: "tool_use",
			},
			{ type: "finish", reason: "tool_use" },
		];
		const parts = await collect(chunks);
		expect(parts.map((p) => p.type)).toEqual([
			"content_block_start",
			"content_block_delta",
			"content_block_stop",
			"message_delta",
			"message_stop",
		]);
		expect(parts[1].delta).toEqual({
			type: "input_json_delta",
			partial_json: '{"city":"SF"}',
		});
	});
});
