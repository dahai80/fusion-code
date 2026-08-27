import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { UUID } from "node:crypto";
import type { Message } from "src/types/message.js";
import { commitLastTurn } from "./commitTurn.js";

const ENV_KEYS = ["FUSION_MEMORY_BASE_URL", "FUSION_MEMORY_API_KEY"] as const;

function snapshotEnvs(): Record<string, string | undefined> {
	const snap: Record<string, string | undefined> = {};
	for (const k of ENV_KEYS) snap[k] = process.env[k];
	return snap;
}
function restoreEnvs(snap: Record<string, string | undefined>): void {
	for (const k of ENV_KEYS) {
		if (snap[k] === undefined) delete process.env[k];
		else process.env[k] = snap[k];
	}
}

function mockResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function okFetch(resp: unknown): typeof fetch {
	const impl: typeof fetch = (async (_input: RequestInfo | URL) =>
		mockResponse(resp)) as typeof fetch;
	return impl;
}

const DUMMY_UUID = "00000000-0000-4000-8000-000000000000" as UUID;

function makeUser(text: string): Message {
	return {
		type: "user",
		uuid: DUMMY_UUID,
		timestamp: "2026-01-01T00:00:00Z",
		message: { role: "user", content: text },
	};
}

function makeAssistant(text: string): Message {
	return {
		type: "assistant",
		uuid: DUMMY_UUID,
		timestamp: "2026-01-01T00:00:01Z",
		message: {
			role: "assistant",
			content: [{ type: "text", text }],
			model: "test",
			stop_reason: "end_turn",
			stop_sequence: null,
			usage: { input_tokens: 1, output_tokens: 1 },
		} as never,
	};
}

describe("commitLastTurn", () => {
	let envSnap: Record<string, string | undefined>;
	let fetchSpy: ReturnType<typeof spyOn> | null = null;

	beforeEach(() => {
		envSnap = snapshotEnvs();
		process.env.FUSION_MEMORY_API_KEY = "test-key";
	});

	afterEach(() => {
		restoreEnvs(envSnap);
		fetchSpy?.mockRestore();
		fetchSpy = null;
	});

	it("skips when agentId set (subagent)", async () => {
		const spy = spyOn(globalThis, "fetch").mockImplementation(
			okFetch({ jsonrpc: "2.0", result: ["x"], id: 1 }),
		);
		fetchSpy = spy;

		const ids = await commitLastTurn({
			messages: [makeUser("hi"), makeAssistant("hello")],
			agentId: "subagent-1",
		});
		expect(ids).toBeNull();
		expect(spy).toHaveBeenCalledTimes(0);
	});

	it("skips when no completed turn (only user)", async () => {
		const spy = spyOn(globalThis, "fetch").mockImplementation(
			okFetch({ jsonrpc: "2.0", result: ["x"], id: 1 }),
		);
		fetchSpy = spy;

		const ids = await commitLastTurn({ messages: [makeUser("hi")] });
		expect(ids).toBeNull();
		expect(spy).toHaveBeenCalledTimes(0);
	});

	it("skips when messages empty", async () => {
		const ids = await commitLastTurn({ messages: [] });
		expect(ids).toBeNull();
	});

	it("commits last user+assistant pair, returns ids", async () => {
		let capturedBody: {
			params: {
				interaction: {
					turns: Array<{ user_message: string; assistant_message: string }>;
				};
			};
		};
		const impl: typeof fetch = (async (_input, init) => {
			capturedBody = JSON.parse(init?.body as string);
			return Promise.resolve(
				mockResponse({ jsonrpc: "2.0", result: ["mem-a", "mem-b"], id: 1 }),
			);
		}) as typeof fetch;
		const spy = spyOn(globalThis, "fetch").mockImplementation(impl);
		fetchSpy = spy;

		const ids = await commitLastTurn({
			messages: [
				makeUser("old question"),
				makeAssistant("old answer"),
				makeUser("latest question"),
				makeAssistant("latest answer"),
			],
		});

		expect(ids).toEqual(["mem-a", "mem-b"]);
		expect(capturedBody.params.interaction.turns).toHaveLength(1);
		expect(capturedBody.params.interaction.turns[0].user_message).toBe(
			"latest question",
		);
		expect(capturedBody.params.interaction.turns[0].assistant_message).toBe(
			"latest answer",
		);
	});

	it("returns null on commit failure (no throw)", async () => {
		const spy = spyOn(globalThis, "fetch").mockImplementation(
			okFetch({
				jsonrpc: "2.0",
				error: { code: -1, message: "fail" },
				id: 1,
			}),
		);
		fetchSpy = spy;

		const ids = await commitLastTurn({
			messages: [makeUser("q"), makeAssistant("a")],
		});
		expect(ids).toBeNull();
	});
});
