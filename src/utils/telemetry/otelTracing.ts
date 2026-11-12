import { randomUUID } from "node:crypto";

// OTel GenAI trace chain (evolution plan P1.3, docs/evolution-plan-2026-11.md).
//
// Minimal OTLP/JSON exporter over fetch — no exporter dependency, keeps the
// single-binary distribution intact. Fully off unless FUSION_CODE_OTEL_ENDPOINT
// is set (e.g. http://127.0.0.1:4318); the endpoint is expected to be local
// (fusion-memory / fusion-supervisor ecosystem). No default remote endpoint —
// the no-telemetry-egress defense line is non-negotiable.
//
// Span set: fusion.turn (QueryEngine turn), gen_ai.tool (tool execution),
// gen_ai.llm (LLM request with token usage). Context propagation: async
// generators make ALS unreliable across yield boundaries, so spans are roots
// linked by shared fusion.turn.id + session.id attributes instead of
// parent span ids — traceable end-to-end by attribute in any trace backend.
//
// Failure-isolated by design: every public function is a no-op or a caught
// no-throw when disabled or when export fails. Tracing never breaks a run.

export type OtelSpanHandle = {
	name: string;
	traceId: string;
	spanId: string;
	turnId: string | undefined;
	sessionId: string;
	startTimeNs: bigint;
	attrs: Record<string, string | number | boolean>;
};

type CompletedSpan = OtelSpanHandle & { endTimeNs: bigint };

const pending: CompletedSpan[] = [];

// Turn propagation: async generators make ALS unreliable across yield
// boundaries, so the active turn id rides on module state — fusion.turn start
// sets it, end restores the previous one. Tool/LLM spans created while a turn
// is active inherit it. Limitation (documented): concurrent engines
// (subagents) attribute to the most recently started turn — acceptable for a
// local-first single-user product; session.id stays the hard linkage.
const turnIdStack: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let endpoint: string | undefined;

export function isOtelTracingEnabled(): boolean {
	return getOtelEndpoint() !== undefined;
}

function getOtelEndpoint(): string | undefined {
	if (endpoint === undefined) {
		const raw = process.env.FUSION_CODE_OTEL_ENDPOINT?.trim();
		endpoint = raw ? raw.replace(/\/+$/, "") : null;
	}
	return endpoint ?? undefined;
}

function newId(bytes: number): string {
	const buf = randomUUID().replace(/-/g, "");
	return buf.slice(0, bytes * 2);
}

// Lazily registered on first span: short headless runs exit before the 3s
// timer fires — beforeExit is the last chance to export the batch.
let exitHookRegistered = false;

function registerExitHook(): void {
	if (exitHookRegistered) return;
	exitHookRegistered = true;
	process.on("beforeExit", () => {
		void flushOtelSpans();
	});
}

export function startOtelSpan(
	name: string,
	attrs: Record<string, string | number | boolean> = {},
): OtelSpanHandle | null {
	if (!isOtelTracingEnabled()) return null;
	registerExitHook();
	const attrs2 = { ...attrs };
	if (name === "fusion.turn") {
		// New turn root — becomes the propagation context for child spans.
		turnIdStack.push(String(attrs2["fusion.turn.id"] ?? ""));
	} else if (attrs2["fusion.turn.id"] === undefined && turnIdStack.length > 0) {
		// Child span — inherit the active turn id.
		const inherited = turnIdStack[turnIdStack.length - 1];
		if (inherited) attrs2["fusion.turn.id"] = inherited;
	}
	const span: OtelSpanHandle = {
		name,
		traceId: newId(16),
		spanId: newId(8),
		turnId: attrs2["fusion.turn.id"] as string | undefined,
		sessionId: String(attrs2["session.id"] ?? ""),
		startTimeNs: BigInt(Date.now()) * 1_000_000n,
		attrs: attrs2,
	};
	return span;
}

export function endOtelSpan(
	span: OtelSpanHandle | null,
	extraAttrs: Record<string, string | number | boolean> = {},
): void {
	if (!span || !isOtelTracingEnabled()) return;
	try {
		if (span.name === "fusion.turn" && turnIdStack.length > 0) {
			turnIdStack.pop();
		}
		pending.push({
			...span,
			attrs: { ...span.attrs, ...extraAttrs },
			endTimeNs: BigInt(Date.now()) * 1_000_000n,
		});
		// Flush per span end — headless runs call process.exit() straight after
		// the result, so timer-based batching loses the whole batch (Bun does
		// not reliably fire beforeExit on explicit exit). Localhost POST, cheap.
		void flushOtelSpans();
	} catch {
		// fail-open: tracing must never break a run
	}
}

function scheduleFlush(): void {
	void flushOtelSpans();
}

// OTLP/JSON: one resourceSpans batch per POST. Fire-and-forget with catch —
// export failures are logged, never surfaced.
export async function flushOtelSpans(): Promise<void> {
	if (flushTimer !== null) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
	if (pending.length === 0) return;
	const ep = getOtelEndpoint();
	if (!ep) return;
	const batch = pending.splice(0, pending.length);
	try {
		const body = JSON.stringify({
			resourceSpans: [
				{
					resource: {
						attributes: [
							{ key: "service.name", value: { stringValue: "fusion-code" } },
							{
								key: "telemetry.sdk.language",
								value: { stringValue: "typescript" },
							},
						],
					},
					scopeSpans: [
						{
							scope: { name: "fusion-code.otel", version: "1" },
							spans: batch.map((s) => ({
								traceId: s.traceId,
								spanId: s.spanId,
								name: s.name,
								kind: 1,
								startTimeUnixNano: s.startTimeNs.toString(),
								endTimeUnixNano: s.endTimeNs.toString(),
								attributes: Object.entries(s.attrs).map(([key, v]) => ({
									key,
									value:
										typeof v === "number"
											? { doubleValue: v }
											: typeof v === "boolean"
												? { boolValue: v }
												: { stringValue: v },
								})),
							})),
						},
					],
				},
			],
		});
		await fetch(`${ep}/v1/traces`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body,
		});
	} catch (error) {
		// Export failure is a tracing concern only — swallow with a debug note.
		console.debug(
			`[otel] span export failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

// Test support: drain without exporting.
export function drainOtelSpansForTest(): CompletedSpan[] {
	return pending.splice(0, pending.length);
}

// GenAI token-usage capture from stream events (duck-typed; stream event
// shapes vary by provider translation layer). Shared by the LLM seam and the
// seam client — any yielded SDK-compatible stream part works.
export type OtelStreamUsage = { input?: number; output?: number };

export function captureOtelStreamUsage(
	part: unknown,
	usage: OtelStreamUsage,
): void {
	try {
		if (!part || typeof part !== "object") return;
		const type = (part as { type?: unknown }).type;
		if (type === "message_start") {
			const msg = (
				part as {
					message?: { usage?: { input_tokens?: unknown; output_tokens?: unknown } };
				}
			).message;
			if (msg?.usage) {
				if (typeof msg.usage.input_tokens === "number") {
					usage.input = msg.usage.input_tokens;
				}
				if (typeof msg.usage.output_tokens === "number") {
					usage.output = msg.usage.output_tokens;
				}
			}
		} else if (type === "message_delta") {
			const u = (part as { usage?: { output_tokens?: unknown } }).usage;
			if (u && typeof u.output_tokens === "number") {
				usage.output = u.output_tokens;
			}
		}
	} catch {
		// usage capture must never affect the stream
	}
}

export function otelUsageAttrs(
	usage: OtelStreamUsage,
): Record<string, number> {
	const attrs: Record<string, number> = {};
	if (usage.input !== undefined) {
		attrs["gen_ai.usage.input_tokens"] = usage.input;
	}
	if (usage.output !== undefined) {
		attrs["gen_ai.usage.output_tokens"] = usage.output;
	}
	return attrs;
}

// Test support: reset memoized endpoint + queue between tests.
export function resetOtelTracingForTest(): void {
	if (flushTimer !== null) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
	pending.length = 0;
	turnIdStack.length = 0;
	endpoint = undefined;
}
