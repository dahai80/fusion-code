/**
 * Fusion-Memory 长期记忆客户端
 *
 * 将 fusion-code 与 fusion-memory 长期记忆中枢集成,
 * 提供跨 session 记忆提交 / 检索 (语义召回 + 认知图谱)。
 *
 * 风格参照 fusion-kb-client.ts: native fetch + AbortSignal.timeout,
 * 失败 logForDebugging + 返回空, 不抛异常中断主流程。
 *
 * 协议: fm-server HTTP JSON-RPC 2.0 (127.0.0.1, Bearer 鉴权)。
 * 端口默认 11435 (fm-server 注册端口, port-registry.yaml; #219 修复 —
 * 旧默认 11440 是 fusion-projects 的端口, 注入管道静默断链)。
 *
 * env (operator):
 *   FUSION_MEMORY_BASE_URL  (默认 http://127.0.0.1:11435)
 *   FUSION_MEMORY_API_KEY   (必配, 对齐 fm-server Bearer B5)
 *   FUSION_MEMORY_DISABLED  (=1 显式关闭, 不探活不告警)
 */

import { logForDebugging } from "../../utils/debug.js";

export const DEFAULT_MEMORY_BASE_URL = "http://127.0.0.1:11435";

// ─── Circuit Breaker (audit 0905 E3) ──────────────────────────
// fusion-memory 故障时每次 rpc 仍等 AbortSignal.timeout (10s) → 主流程被拖死。
// 独立熔断器: 连续失败 ≥ threshold → open, 快速 fail (null, 不等 timeout)。
// cooldown 后 half-open 探测一次。env 覆盖: FUSION_MEMORY_CB_THRESHOLD /
// FUSION_MEMORY_CB_COOLDOWN_MS。默认 threshold=5, cooldown=30s。
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
	// open → cooldown 到了转 half-open (放一个探测请求)
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
		// #219: 每会话只提示一次 (旧实现每次 rpc 都打一条)
		if (!_unconfiguredLoggedOnce) {
			_unconfiguredLoggedOnce = true;
			logForDebugging(
				"[Fusion-Memory] FUSION_MEMORY_API_KEY 未配置, 记忆接入关闭 (每会话仅提示一次)",
			);
		}
		return null;
	}
	return key;
}

// ─── Pipeline status (#219 fail-visible) ─────────────────────
// fail-empty 只对"结果"成立 (agent 永不被记忆故障打断), 状态必须可见:
// 启动告警条 (StatusNotices) + 结构化日志 + audit JSONL 三处落地。

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

// 测试专用: 复位模块级探活状态
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
		// 已连通不重探; unreachable 5min 内不重复探 (每轮 turn 触发一次, 便宜)
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
		// 每次探活一条结构化日志 (不是每请求一条)
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
	// audit 0905 E3: 熔断 open 时快速 fail, 不等 timeout, 避免拖死主流程。
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
 * 写入 Interaction, 返回 turn 级 memory_id 列表 (失败 → null, 不抛)。
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
 * 检索记忆上下文, 返回 {blocks, total_tokens} (失败 → null, 不抛)。
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
 * 触发遗忘 / 合并 saga (远程等价 auto-forget), 返回报告 (失败 → null)。
 */
export async function consolidateMemories(): Promise<ConsolidationReport | null> {
	return rpc<ConsolidationReport>("consolidate", {}, 30_000);
}

// ─── Context → prompt string ──────────────────────────────────

/**
 * 把 retrieveContext 结果格式化为可注入 systemPrompt 的字符串。
 * 空结果 → "" (调用方按 falsy 跳过注入)。
 */
export function formatContextToPrompt(ctx: FormattedContext | null): string {
	if (!ctx?.blocks || ctx.blocks.length === 0) return "";
	const parts = ctx.blocks.map(
		(b, i) =>
			`[记忆 ${i + 1}] (相关度: ${(b.score * 100).toFixed(0)}%, ${b.memory_type})\n${b.turns_text}`,
	);
	return `\n\n<fusion_memory_context>\n${parts.join("\n\n---\n\n")}\n</fusion_memory_context>`;
}
