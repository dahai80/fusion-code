import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { retrieveMemorySection } from "./retrieveContext.js";

const ENV_KEYS = [
	"FUSION_MEMORY_BASE_URL",
	"FUSION_MEMORY_API_KEY",
	"FUSION_MEMORY_RETRIEVE_TOP_K",
	"FUSION_MEMORY_RETRIEVE_BUDGET",
] as const;

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

function makeFormatted(blocks: number) {
	return {
		jsonrpc: "2.0",
		result: {
			blocks: Array.from({ length: blocks }, (_, i) => ({
				interaction_id: `ix-${i}`,
				turns: [],
				memory_type: "Episodic",
				turns_text: `prior turn ${i}`,
				score: 0.9 - i * 0.1,
				source_entities: [],
			})),
			total_tokens: 100,
		},
		id: 1,
	};
}

describe("retrieveMemorySection", () => {
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
			okFetch(makeFormatted(2)),
		);
		fetchSpy = spy;
		const out = await retrieveMemorySection({
			inputText: "hello",
			agentId: "subagent-1" as never,
		});
		expect(out).toBe("");
		expect(spy).not.toHaveBeenCalled();
	});

	it("skips on empty input", async () => {
		const spy = spyOn(globalThis, "fetch").mockImplementation(
			okFetch(makeFormatted(2)),
		);
		fetchSpy = spy;
		const out = await retrieveMemorySection({ inputText: "   " });
		expect(out).toBe("");
		expect(spy).not.toHaveBeenCalled();
	});

	it("returns formatted memory section on success", async () => {
		const spy = spyOn(globalThis, "fetch").mockImplementation(
			okFetch(makeFormatted(2)),
		);
		fetchSpy = spy;
		const out = await retrieveMemorySection({ inputText: "hello rust" });
		expect(out).toContain("<fusion_memory_context>");
		expect(out).toContain("prior turn 0");
		expect(out).toContain("prior turn 1");
		expect(spy).toHaveBeenCalledTimes(1);
		const call = spy.mock.calls[0][0] as string;
		expect(call).toContain("/v1/memory/retrieve");
	});

	it("returns empty on RPC error", async () => {
		const spy = spyOn(globalThis, "fetch").mockImplementation(
			okFetch({
				jsonrpc: "2.0",
				error: { code: -32602, message: "bad params" },
				id: 1,
			}),
		);
		fetchSpy = spy;
		const out = await retrieveMemorySection({ inputText: "hello" });
		expect(out).toBe("");
	});

	it("returns empty on HTTP non-2xx", async () => {
		const spy = spyOn(globalThis, "fetch").mockImplementation((async (
			_input: RequestInfo | URL,
		) => mockResponse("nope", 500)) as typeof fetch);
		fetchSpy = spy;
		const out = await retrieveMemorySection({ inputText: "hello" });
		expect(out).toBe("");
	});

	it("returns empty on fetch throw", async () => {
		const spy = spyOn(globalThis, "fetch").mockImplementation((async () => {
			throw new Error("connection refused");
		}) as unknown as typeof fetch);
		fetchSpy = spy;
		const out = await retrieveMemorySection({ inputText: "hello" });
		expect(out).toBe("");
	});

	it("returns empty when FUSION_MEMORY_API_KEY unset", async () => {
		delete process.env.FUSION_MEMORY_API_KEY;
		const spy = spyOn(globalThis, "fetch").mockImplementation(
			okFetch(makeFormatted(2)),
		);
		fetchSpy = spy;
		const out = await retrieveMemorySection({ inputText: "hello" });
		expect(out).toBe("");
		expect(spy).not.toHaveBeenCalled();
	});

	it("returns empty when no blocks matched", async () => {
		const spy = spyOn(globalThis, "fetch").mockImplementation(
			okFetch({
				jsonrpc: "2.0",
				result: { blocks: [], total_tokens: 0 },
				id: 1,
			}),
		);
		fetchSpy = spy;
		const out = await retrieveMemorySection({ inputText: "hello" });
		expect(out).toBe("");
	});

	it("honors FUSION_MEMORY_RETRIEVE_TOP_K env override", async () => {
		process.env.FUSION_MEMORY_RETRIEVE_TOP_K = "25";
		const spy = spyOn(globalThis, "fetch").mockImplementation(
			okFetch(makeFormatted(1)),
		);
		fetchSpy = spy;
		await retrieveMemorySection({ inputText: "hello" });
		const callBody = JSON.parse(
			(spy.mock.calls[0][1] as RequestInit).body as string,
		);
		expect(callBody.params.top_k).toBe(25);
	});

	it("falls back to default top_k on invalid env", async () => {
		process.env.FUSION_MEMORY_RETRIEVE_TOP_K = "not-a-number";
		const spy = spyOn(globalThis, "fetch").mockImplementation(
			okFetch(makeFormatted(1)),
		);
		fetchSpy = spy;
		await retrieveMemorySection({ inputText: "hello" });
		const callBody = JSON.parse(
			(spy.mock.calls[0][1] as RequestInit).body as string,
		);
		expect(callBody.params.top_k).toBe(10);
	});
});
