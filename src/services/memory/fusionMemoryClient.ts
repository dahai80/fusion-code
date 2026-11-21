/**
 * Fusion-Memory long-term memory client
 *
 * Integrates fusion-code with the fusion-memory long-term memory hub,
 * providing cross-session memory commit / retrieval (semantic recall + cognitive graph).
 *
 * Style follows fusion-kb-client.ts: native fetch + AbortSignal.timeout,
 * failures logForDebugging + return empty, never throw to interrupt the main flow.
 *
 * Protocol: fm-server HTTP JSON-RPC 2.0 (127.0.0.1, Bearer auth).
 * Port defaults to 11435 (fm-server registered port, port-registry.yaml; #219 fix —
 * the old default 11440 belonged to fusion-projects, silently breaking the injection pipeline).
 *
 * env (operator):
 *   FUSION_MEMORY_BASE_URL  (default http://127.0.0.1:11435)
 *   FUSION_MEMORY_API_KEY   (required, aligns with fm-server Bearer B5)
 *   FUSION_MEMORY_DISABLED  (=1 explicitly disables, no probing no warning)
 */

import { logForDebugging } from "../../utils/debug.js";

export const DEFAULT_MEMORY_BASE_URL = "http://127.0.0.1:11435";

// ─── Circuit Breaker (audit 0905 E3) ──────────────────────────
// When fusion-memory is down, every rpc still waits for AbortSignal.timeout (10s) → main flow dragged down.
// Standalone circuit breaker: consecutive failures ≥ threshold → open, fast fail (null, no timeout wait).
// After cooldown, half-open probes once. env overrides: FUSION_MEMORY_CB_THRESHOLD /
// FUSION_MEMORY_CB_COOLDOWN_MS. Defaults threshold=5, cooldown=30s.
function memCbThreshold(): number {
	const raw = process.env.FUSION_MEMORY_CB_THRESHOLD;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}
function memCbCooldownMs(): number {
	const raw = process.env.FUSION_MEMORY_CB_COOLDOWN_MS;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30_000;
}

let _cbFailures = 0;
let _cbOpenSince: number | null = null;

function memCircuitAllow(): boolean {
	if (_cbOpenSince === null) return true;
	// open → cooldown elapsed, switch to half-open (admit one probe request)
	if (Date.now() - _cbOpenSince >= memCbCooldownMs()) {
		logForDebugging("[Fusion-Memory] circuit half-open (probing)");
		_cbOpenSince = null;
		return true;
	}
	return false;
}

function memCircuitRecordSuccess(): void {
	if (_cbFailures > 0) {
		logForDebugging("[Fusion-Memory] circuit closed (recovered)");
	}
	_cbFailures = 0;
	_cbOpenSince = null;
}

function memCircuitRecordFailure(): void {
	_cbFailures += 1;
	if (_cbFailures >= memCbThreshold() && _cbOpenSince === null) {
		_cbOpenSince = Date.now();
		logForDebugging(
			`[Fusion-Memory] circuit OPEN after ${_cbFailures} failures (cooldown ${memCbCooldownMs()}ms)`,
		);
	}
}

export function getMemoryBaseUrl(): string {
	return process.env.FUSION_MEMORY_BASE_URL || DEFAULT_MEMORY_BASE_URL;
}

function getMemoryApiKey(): string | null {
	const key = process.env.FUSION_MEMORY_API_KEY;
	if (!key) {
		// #219: warn once per session (the old implementation logged one line per rpc)
		if (!_unconfiguredLoggedOnce) {
			_unconfiguredLoggedOnce = true;
			logForDebugging(
				"[Fusion-Memory] FUSION_MEMORY_API_KEY not configured, memory integration disabled (warns once per session)",
			);
		}
		return null;
	}
	return key;
}

// ─── Pipeline status (#219 fail-visible) ─────────────────────
// fail-empty holds only for "results" (the agent is never interrupted by memory failures), the status must stay visible:
// it lands in three places — startup warning bar (StatusNotices) + structured logs + audit JSONL.

export type MemoryPipelineStatus =
	| "unknown"
	| "connected"
	| "unreachable"
	| "disabled";

const MEMORY_PROBE_TIMEOUT_MS = 2000;
const MEMORY_REPROBE_INTERVAL_MS = 5 * 60_000;

let _pipelineStatus: MemoryPipelineStatus = "unknown";
let _lastProbeAt = 0;
let _probeInFlight: Promise<void> | null = null;
let _unconfiguredLoggedOnce = false;

export function getMemoryPipelineStatus(): MemoryPipelineStatus {
	return _pipelineStatus;
}

export function isMemoryExplicitlyDisabled(): boolean {
	return process.env.FUSION_MEMORY_DISABLED === "1";
}

// Test-only: reset the module-level probe status
export function resetMemoryPipelineStatusForTest(): void {
	_pipelineStatus = "unknown";
	_lastProbeAt = 0;
	_probeInFlight = null;
	_unconfiguredLoggedOnce = false;
}

export async function probeMemoryPipeline(sessionId: string): Promise<void> {
	if (_probeInFlight) return _probeInFlight;
	const run = (async () => {
		if (isMemoryExplicitlyDisabled()) {
			_pipelineStatus = "disabled";
			return;
		}
		// No re-probe while connected; unreachable not re-probed within 5min (triggered once per turn, cheap)
		const now = Date.now();
		if (_pipelineStatus === "connected") return;
		if (
			_pipelineStatus === "unreachable" &&
			now - _lastProbeAt < MEMORY_REPROBE_INTERVAL_MS
		) {
			return;
		}
		_lastProbeAt = now;
		const started = Date.now();
		let ok = false;
		try {
			const res = await fetch(`${getMemoryBaseUrl()}/healthz`, {
				method: "GET",
				signal: AbortSignal.timeout(MEMORY_PROBE_TIMEOUT_MS),
			});
			ok = res.ok;
		} catch {
			ok = false;
		}
		const latencyMs = Date.now() - started;
		_pipelineStatus = ok ? "connected" : "unreachable";
		// One structured log per probe (not one per request)
		logForDebugging(
			`memory_pipeline status=${_pipelineStatus} url=${getMemoryBaseUrl()} latency_ms=${latencyMs}`,
		);
		try {
			const { appendAuditLog, createAuditEntry } = await import(
				"../audit/index.js"
			);
			await appendAuditLog(
				createAuditEntry(
					sessionId,
					"fusion-memory",
					"memory_probe",
					getMemoryBaseUrl(),
					{
						detail: `memory_pipeline status=${_pipelineStatus} latency_ms=${latencyMs}`,
						success: ok,
						duration_ms: latencyMs,
					},
				),
			);
		} catch (e) {
			logForDebugging(`[Fusion-Memory] audit write failed: ${e}`);
		}
	})();
	_probeInFlight = run.finally(() => {
		_probeInFlight = null;
	});
	return _probeInFlight;
}

// ─── Types ────────────────────────────────────────────────────

export interface ToolCall {
	name: string;
	args: unknown;
	result_summary: string;
}

export interface Turn {
	turn_idx: number;
	user_message: string;
	assistant_message: string;
	tool_calls: ToolCall[];
}

export interface Interaction {
	id: string;
	session_id: string;
	turns: Turn[];
	timestamp: number;
	metadata: Record<string, unknown>;
}

export interface ContextBlock {
	interaction_id: string;
	turns: Turn[];
	memory_type: string;
	turns_text: string;
	score: number;
	source_entities: string[];
}

export interface FormattedContext {
	blocks: ContextBlock[];
	total_tokens: number;
}

export interface ConsolidationReport {
	dropped: number;
	promoted: number;
	merged: number;
	summarized: number;
	reextracted: number;
	reconciled: number;
}

interface RpcResponse<T> {
	jsonrpc: string;
	result?: T;
	error?: { code: number; message: string };
	id: number;
}

// ─── RPC core ─────────────────────────────────────────────────

async function rpc<T>(
	method: string,
	params: Record<string, unknown>,
	timeoutMs: number,
): Promise<T | null> {
	const apiKey = getMemoryApiKey();
	if (!apiKey) return null;
	// audit 0905 E3: fast fail while the circuit is open, no timeout wait, avoiding dragging down the main flow.
	if (!memCircuitAllow()) {
		logForDebugging(`[Fusion-Memory] ${method} skipped (circuit OPEN)`, {
			level: "warn",
		});
		return null;
	}
	try {
		const res = await fetch(`${getMemoryBaseUrl()}/v1/memory/${method}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!res.ok) {
			logForDebugging(
				`[Fusion-Memory] ${method} HTTP ${res.status} ${res.statusText}`,
			);
			memCircuitRecordFailure();
			return null;
		}
		const data = (await res.json()) as RpcResponse<T>;
		if (data.error) {
			logForDebugging(
				`[Fusion-Memory] ${method} RPC ${data.error.code}: ${data.error.message}`,
			);
			memCircuitRecordFailure();
			return null;
		}
		memCircuitRecordSuccess();
		return (data.result ?? null) as T | null;
	} catch (error) {
		logForDebugging(
			`[Fusion-Memory] ${method} error: ${(error as Error).message}`,
		);
		memCircuitRecordFailure();
		return null;
	}
}

// ─── Health ───────────────────────────────────────────────────

export async function checkMemoryHealth(): Promise<boolean> {
	try {
		const res = await fetch(`${getMemoryBaseUrl()}/healthz`, {
			method: "GET",
			signal: AbortSignal.timeout(2000),
		});
		return res.ok;
	} catch {
		return false;
	}
}

// ─── Commit ───────────────────────────────────────────────────

/**
 * Writes an Interaction and returns turn-level memory_id list (failure → null, never throws).
 */
export async function commitEpisodicMemory(
	sessionId: string,
	interaction: Interaction,
): Promise<string[] | null> {
	return rpc<string[]>(
		"commit",
		{ session_id: sessionId, interaction },
		10_000,
	);
}

// ─── Retrieve ─────────────────────────────────────────────────

/**
 * Retrieves memory context, returns {blocks, total_tokens} (failure → null, never throws).
 */
export async function retrieveContext(
	text: string,
	topK = 10,
	tokenBudget = 4096,
	aggregate = true,
): Promise<FormattedContext | null> {
	return rpc<FormattedContext>(
		"retrieve",
		{
			text,
			top_k: topK,
			token_budget: tokenBudget,
			aggregate,
		},
		10_000,
	);
}

// ─── Consolidate ──────────────────────────────────────────────

/**
 * Triggers the forget / consolidation saga (remote equivalent of auto-forget), returns a report (failure → null).
 */
export async function consolidateMemories(): Promise<ConsolidationReport | null> {
	return rpc<ConsolidationReport>("consolidate", {}, 30_000);
}

// ─── Context → prompt string ──────────────────────────────────

/**
 * Formats the retrieveContext result into a string injectable into the systemPrompt.
 * Empty result → "" (callers skip injection on falsy).
 */
export function formatContextToPrompt(ctx: FormattedContext | null): string {
	if (!ctx?.blocks || ctx.blocks.length === 0) return "";
	const parts = ctx.blocks.map(
		(b, i) =>
			`[Memory ${i + 1}] (relevance: ${(b.score * 100).toFixed(0)}%, ${b.memory_type})\n${b.turns_text}`,
	);
	return `\n\n<fusion_memory_context>\n${parts.join("\n\n---\n\n")}\n</fusion_memory_context>`;
}
