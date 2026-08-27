import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
	checkMemoryHealth,
	commitEpisodicMemory,
	formatContextToPrompt,
	type Interaction,
	retrieveContext,
} from "./fusionMemoryClient.js";

// env 全局 — 测试必须 snapshot/restore, 否则串扰
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

// 捕获 fetch 调用参数 (url, headers, body) 供断言
interface FetchCall {
	url: string;
	method: string;
	auth: string | null;
	body: unknown;
}
function makeFetchSpy(
	resp: unknown,
	status = 200,
): { spy: ReturnType<typeof spyOn>; calls: FetchCall[] } {
	const calls: FetchCall[] = [];
	const impl: typeof fetch = (async (input, init) => {
		const headers = new Headers(init?.headers);
		calls.push({
			url: String(input),
			method: init?.method ?? "GET",
			auth: headers.get("authorization"),
			body: init?.body ? JSON.parse(init.body as string) : null,
		});
		return Promise.resolve(mockResponse(resp, status));
	}) as typeof fetch;
	const spy = spyOn(globalThis, "fetch").mockImplementation(impl);
	return { spy, calls };
}

function throwingFetch(message: string): typeof fetch {
	const impl = async (_input: RequestInfo | URL) => {
		throw new Error(message);
	};
	return impl as unknown as typeof fetch;
}

describe("fusionMemoryClient", () => {
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

	describe("commitEpisodicMemory", () => {
		it("posts JSON-RPC envelope to /v1/memory/commit with Bearer auth", async () => {
			const { spy, calls } = makeFetchSpy({
				jsonrpc: "2.0",
				result: ["mem-1", "mem-2"],
				id: 1,
			});
			fetchSpy = spy;

			const interaction: Interaction = {
				id: "int-1",
				session_id: "sess-1",
				turns: [
					{
						turn_idx: 0,
						user_message: "hello",
						assistant_message: "hi there",
						tool_calls: [],
					},
				],
				timestamp: 1000,
				metadata: {},
			};
			const ids = await commitEpisodicMemory("sess-1", interaction);

			expect(ids).toEqual(["mem-1", "mem-2"]);
			expect(calls).toHaveLength(1);
			expect(calls[0].url).toContain("/v1/memory/commit");
			expect(calls[0].method).toBe("POST");
			expect(calls[0].auth).toBe("Bearer test-key");
			expect(calls[0].body).toMatchObject({
				jsonrpc: "2.0",
				method: "commit",
				params: { session_id: "sess-1" },
			});
		});

		it("returns null on RPC error (fail-empty, no throw)", async () => {
			const { spy } = makeFetchSpy({
				jsonrpc: "2.0",
				error: { code: -32602, message: "bad params" },
				id: 1,
			});
			fetchSpy = spy;

			const ids = await commitEpisodicMemory("s", {
				id: "i",
				session_id: "s",
				turns: [],
				timestamp: 0,
				metadata: {},
			});
			expect(ids).toBeNull();
		});

		it("returns null when API key unset (skips)", async () => {
			delete process.env.FUSION_MEMORY_API_KEY;
			const { spy } = makeFetchSpy({ jsonrpc: "2.0", result: [], id: 1 });
			fetchSpy = spy;

			const ids = await commitEpisodicMemory("s", {
				id: "i",
				session_id: "s",
				turns: [],
				timestamp: 0,
				metadata: {},
			});
			expect(ids).toBeNull();
			expect(spy).toHaveBeenCalledTimes(0);
		});

		it("returns null on HTTP non-2xx", async () => {
			const { spy } = makeFetchSpy({}, 500);
			fetchSpy = spy;

			const ids = await commitEpisodicMemory("s", {
				id: "i",
				session_id: "s",
				turns: [],
				timestamp: 0,
				metadata: {},
			});
			expect(ids).toBeNull();
		});
	});

	describe("retrieveContext", () => {
		it("returns blocks + total_tokens on success", async () => {
			const ctx = {
				blocks: [
					{
						interaction_id: "int-1",
						turns: [],
						memory_type: "Episodic",
						turns_text: "prior chat",
						score: 0.9,
						source_entities: ["EntityA"],
					},
				],
				total_tokens: 120,
			};
			const { spy, calls } = makeFetchSpy({
				jsonrpc: "2.0",
				result: ctx,
				id: 1,
			});
			fetchSpy = spy;

			const out = await retrieveContext("some query");
			expect(out).toEqual(ctx);
			expect(calls[0].body).toMatchObject({
				method: "retrieve",
				params: { text: "some query", top_k: 10 },
			});
		});

		it("returns null on fetch throw", async () => {
			const spy = spyOn(globalThis, "fetch").mockImplementation(
				throwingFetch("network down"),
			);
			fetchSpy = spy;

			const out = await retrieveContext("q");
			expect(out).toBeNull();
		});
	});

	describe("formatContextToPrompt", () => {
		it("returns empty string for null / empty blocks", () => {
			expect(formatContextToPrompt(null)).toBe("");
			expect(formatContextToPrompt({ blocks: [], total_tokens: 0 })).toBe("");
		});

		it("formats blocks with score + type + text", () => {
			const out = formatContextToPrompt({
				blocks: [
					{
						interaction_id: "i",
						turns: [],
						memory_type: "Semantic",
						turns_text: "fact A",
						score: 0.8,
						source_entities: [],
					},
				],
				total_tokens: 50,
			});
			expect(out).toContain("<fusion_memory_context>");
			expect(out).toContain("[记忆 1]");
			expect(out).toContain("80%");
			expect(out).toContain("Semantic");
			expect(out).toContain("fact A");
		});
	});

	describe("checkMemoryHealth", () => {
		it("returns true on 200", async () => {
			const { spy, calls } = makeFetchSpy({ ok: true });
			fetchSpy = spy;
			const ok = await checkMemoryHealth();
			expect(ok).toBe(true);
			expect(calls[0].url).toContain("/healthz");
		});

		it("returns false on throw", async () => {
			const spy = spyOn(globalThis, "fetch").mockImplementation(
				throwingFetch("refused"),
			);
			fetchSpy = spy;
			const ok = await checkMemoryHealth();
			expect(ok).toBe(false);
		});
	});
});
