import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	drainOtelSpansForTest,
	endOtelSpan,
	flushOtelSpans,
	isOtelTracingEnabled,
	resetOtelTracingForTest,
	startOtelSpan,
} from "../../utils/telemetry/otelTracing";

// Evolution plan P1.3: OTel GenAI trace chain — fully off unless
// FUSION_CODE_OTEL_ENDPOINT is set; off = byte-identical (no spans, no fetch).
// Enabled = OTLP/JSON export with GenAI semconv attrs. Spans flush per end
// (headless runs process.exit before any timer fires), so enabled-state tests
// capture through a mocked fetch.

const ENDPOINT = "http://127.0.0.1:14318";

let capturedBodies: string[] = [];
const originalFetch = globalThis.fetch;

function installMockFetch(): void {
	globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
		capturedBodies.push(String(init?.body ?? ""));
		return new Response("{}", { status: 200 });
	}) as unknown as typeof fetch;
}

type FlatSpan = {
	name: string;
	traceId: string;
	attrs: Record<string, unknown>;
};

function flatSpans(): FlatSpan[] {
	const out: FlatSpan[] = [];
	for (const body of capturedBodies) {
		const parsed = JSON.parse(body) as {
			resourceSpans: Array<{
				scopeSpans: Array<{
					spans: Array<{
						name: string;
						traceId: string;
						attributes: Array<{
							key: string;
							value: Record<string, unknown>;
						}>;
					}>;
				}>;
			}>;
		};
		for (const rs of parsed.resourceSpans) {
			for (const ss of rs.scopeSpans) {
				for (const s of ss.spans) {
					const attrs: Record<string, unknown> = {};
					for (const a of s.attributes) {
						attrs[a.key] =
							a.value.doubleValue ?? a.value.boolValue ?? a.value.stringValue;
					}
					out.push({ name: s.name, traceId: s.traceId, attrs });
				}
			}
		}
	}
	return out;
}

beforeEach(() => {
	resetOtelTracingForTest();
	delete process.env.FUSION_CODE_OTEL_ENDPOINT;
	capturedBodies = [];
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	resetOtelTracingForTest();
	delete process.env.FUSION_CODE_OTEL_ENDPOINT;
});

describe("otelTracing off-state (byte-identical)", () => {
	test("disabled without env", () => {
		expect(isOtelTracingEnabled()).toBe(false);
	});

	test("startOtelSpan returns null and endOtelSpan is a no-op", () => {
		const span = startOtelSpan("fusion.turn", { "session.id": "s1" });
		expect(span).toBeNull();
		expect(() => endOtelSpan(span)).not.toThrow();
		expect(drainOtelSpansForTest()).toEqual([]);
		expect(capturedBodies).toEqual([]);
	});
});

describe("otelTracing enabled", () => {
	test("env enables tracing; endpoint trailing slash trimmed", () => {
		process.env.FUSION_CODE_OTEL_ENDPOINT = `${ENDPOINT}/`;
		expect(isOtelTracingEnabled()).toBe(true);
	});

	test("span exports with attrs to /v1/traces", async () => {
		process.env.FUSION_CODE_OTEL_ENDPOINT = ENDPOINT;
		installMockFetch();
		const span = startOtelSpan("gen_ai.tool", {
			"gen_ai.tool.name": "Bash",
			"session.id": "s1",
		});
		expect(span).not.toBeNull();
		expect(span!.traceId).toHaveLength(32);
		expect(span!.spanId).toHaveLength(16);
		endOtelSpan(span!, { ok: true });
		await flushOtelSpans();
		const spans = flatSpans();
		expect(spans).toHaveLength(1);
		expect(spans[0].name).toBe("gen_ai.tool");
		expect(spans[0].traceId).toMatch(/^[0-9a-f]{32}$/);
		expect(spans[0].attrs["gen_ai.tool.name"]).toBe("Bash");
		expect(spans[0].attrs["ok"]).toBe(true);
	});

	test("endOtelSpan(null) after a disabled start is safe", () => {
		const span = startOtelSpan("fusion.turn");
		endOtelSpan(span);
		expect(drainOtelSpansForTest()).toEqual([]);
	});

	test("OTLP body carries resource + nanosecond timestamps", async () => {
		process.env.FUSION_CODE_OTEL_ENDPOINT = ENDPOINT;
		installMockFetch();
		const span = startOtelSpan("gen_ai.llm", {
			"gen_ai.request.model": "test-model",
			"gen_ai.usage.input_tokens": 10,
			"gen_ai.usage.output_tokens": 5,
		});
		endOtelSpan(span!);
		await flushOtelSpans();
		const body = JSON.parse(capturedBodies[0]);
		const rs = body.resourceSpans[0];
		expect(rs.resource.attributes).toContainEqual({
			key: "service.name",
			value: { stringValue: "fusion-code" },
		});
		const otelSpan = rs.scopeSpans[0].spans[0];
		expect(otelSpan.startTimeUnixNano).toMatch(/^\d+$/);
		expect(otelSpan.endTimeUnixNano).toMatch(/^\d+$/);
	});

	test("export failure is swallowed (fail-open)", async () => {
		process.env.FUSION_CODE_OTEL_ENDPOINT = ENDPOINT;
		globalThis.fetch = (async () => {
			throw new Error("connection refused");
		}) as unknown as typeof fetch;
		const span = startOtelSpan("fusion.turn");
		endOtelSpan(span!);
		await expect(flushOtelSpans()).resolves.toBeUndefined();
	});
});

describe("turn → tool → llm chain linkage", () => {
	test("spans of one turn share fusion.turn.id by attribute", async () => {
		process.env.FUSION_CODE_OTEL_ENDPOINT = ENDPOINT;
		installMockFetch();
		const turnId = "turn-abc";
		endOtelSpan(
			startOtelSpan("fusion.turn", {
				"fusion.turn.id": turnId,
				"session.id": "s1",
			})!,
		);
		endOtelSpan(
			startOtelSpan("gen_ai.tool", {
				"fusion.turn.id": turnId,
				"session.id": "s1",
				"gen_ai.tool.name": "Read",
			})!,
		);
		endOtelSpan(
			startOtelSpan("gen_ai.llm", {
				"fusion.turn.id": turnId,
				"session.id": "s1",
				"gen_ai.request.model": "m",
				"gen_ai.usage.input_tokens": 100,
				"gen_ai.usage.output_tokens": 20,
			})!,
		);
		await flushOtelSpans();
		const spans = flatSpans();
		expect(spans.map((s) => s.name)).toEqual([
			"fusion.turn",
			"gen_ai.tool",
			"gen_ai.llm",
		]);
		const turnIds = new Set(spans.map((s) => s.attrs["fusion.turn.id"]));
		expect(turnIds.size).toBe(1);
		expect(turnIds.has(turnId)).toBe(true);
	});
});
