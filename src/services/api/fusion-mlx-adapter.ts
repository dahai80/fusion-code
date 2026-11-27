/**
 * Fusion-MLX adapter
 *
 * Switches fusion-code's AI calls from the Anthropic SDK to the fusion-mlx local inference engine.
 * Provides upper-layer code with an interface compatible with the Anthropic Messages API.
 *
 * fusion-mlx runs through the gateway at 127.0.0.1:11432, compatible with the OpenAI /v1/chat/completions format.
 * This adapter does the format conversion internally while remaining externally compatible with existing code.
 */

import { logForDebugging } from "../../utils/debug.js";
import { isEnvTruthy } from "../../utils/envUtils.js";
import {
	attachResumeRefs,
	isStreamResumeEnabled,
	type StateRef,
	teeCursor,
} from "../llm/streamResume.js";
import {
	type AnthropicNonStreamingResponse,
	type AnthropicStreamEvent,
	transformMLXResponseToAnthropic,
	transformMLXStreamToAnthropic,
	withSilentStreamRetry,
} from "./fusion-mlx-stream.js";
import { cleanToolList } from "./fusion-mlx-tool-validator.js";
import type {
	MLXChatCompletionRequest,
	MLXChatCompletionResponse,
	MLXChatMessage,
	MLXEmbeddingRequest,
	MLXEmbeddingResponse,
	MLXHealthResponse,
	MLXModelInfo,
	MLXModelListResponse,
	MLXToolDefinition,
} from "./fusion-mlx-types.js";

// ─── Configuration ────────────────────────────────────────────

const DEFAULT_MLX_BASE_URL = "http://127.0.0.1:11432";
// fusion-mlx route_guard (#343/#349) Phase 2 enforce by default: requests missing the X-Fusion-Route header are rejected with 403.
// The gateway injects this header; fusion-code must also carry it itself when connecting directly or forwarding through the gateway. The value can be overridden via FUSION_ROUTE_HEADER.
const DEFAULT_FUSION_ROUTE_HEADER = "local";
const DEFAULT_WARMUP_TIMEOUT_MS = 60_000; // 60s for first inference (model loading)
const DEFAULT_STREAM_TIMEOUT_MS = 300_000; // 5 min for streaming
const DEFAULT_QUERY_TIMEOUT_MS = 120_000; // 2 min for non-streaming
const MAX_RETRIES = 1; // retry once on connection failure
// MLX_MAX_TOKENS_ESCALATION_RETRIES // unused // retry once when max_tokens hit
const MLX_MAX_TOKENS_ESCALATION_FACTOR = 2; // double max_tokens on escalation

// ─── Concurrency Semaphore (audit 0905 P0-B) ─────────────────
// audit 0905 P0-B: MLX has a single inference slot, but the client had no concurrency gate → 20 subagents firing 20 concurrent
// requests into 127.0.0.1:11432, the rest queuing in OS sockets or rejected, and connection failures trigger MAX_RETRIES=1
// retries = doubled request rate, a thundering herd. The semaphore caps concurrency; excess requests queue (backpressure).
// Default 2 (MLX can serve 1-2 concurrent); FUSION_MLX_MAX_CONCURRENT=0 = no limit (byte-identical old behavior).
const DEFAULT_MLX_MAX_CONCURRENT = 2;

function mlxMaxConcurrent(): number {
	const raw = process.env.FUSION_MLX_MAX_CONCURRENT;
	if (raw === undefined || raw === "") return DEFAULT_MLX_MAX_CONCURRENT;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) {
		return DEFAULT_MLX_MAX_CONCURRENT;
	}
	return Math.floor(parsed);
}

let _semActive = 0;
const _semQueue: Array<() => void> = [];

async function acquireMlxSlot(): Promise<void> {
	const cap = mlxMaxConcurrent();
	if (cap === 0) return; // unlimited
	if (_semActive < cap) {
		_semActive++;
		return;
	}
	await new Promise<void>((resolve) => {
		_semQueue.push(() => {
			_semActive++;
			resolve();
		});
	});
}

function releaseMlxSlot(): void {
	const cap = mlxMaxConcurrent();
	if (cap === 0) return; // unlimited
	_semActive = Math.max(0, _semActive - 1);
	const next = _semQueue.shift();
	if (next) next();
}

// ─── Circuit Breaker ──────────────────────────────────────────

type CircuitState = "closed" | "open" | "half_open";

interface CircuitBreakerConfig {
	failureThreshold: number; // consecutive failures before opening
	cooldownMs: number; // time before half-open probe
	halfOpenMaxProbes: number; // successful probes to close circuit
}

const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
	failureThreshold: 5,
	cooldownMs: 30_000,
	halfOpenMaxProbes: 2,
};

class CircuitBreaker {
	private state: CircuitState = "closed";
	private failureCount = 0;
	private successCount = 0;
	private lastFailureTime = 0;
	private readonly config: CircuitBreakerConfig;

	constructor(config: CircuitBreakerConfig = DEFAULT_CIRCUIT_CONFIG) {
		this.config = config;
	}

	getState(): CircuitState {
		if (this.state === "open") {
			const elapsed = Date.now() - this.lastFailureTime;
			if (elapsed >= this.config.cooldownMs) {
				this.state = "half_open";
				this.successCount = 0;
				logForDebugging(
					"[Fusion-MLX] Circuit breaker: OPEN → HALF_OPEN (cooldown elapsed)",
				);
			}
		}
		return this.state;
	}

	allowRequest(): boolean {
		const state = this.getState();
		if (state === "closed") return true;
		if (state === "half_open") return true;
		return false;
	}

	recordSuccess(): void {
		if (this.state === "half_open") {
			this.successCount++;
			if (this.successCount >= this.config.halfOpenMaxProbes) {
				this.state = "closed";
				this.failureCount = 0;
				this.successCount = 0;
				logForDebugging(
					"[Fusion-MLX] Circuit breaker: HALF_OPEN → CLOSED (probes passed)",
				);
			}
		} else if (this.state === "closed") {
			this.failureCount = 0;
		}
	}

	recordFailure(): void {
		this.failureCount++;
		this.lastFailureTime = Date.now();

		if (this.state === "half_open") {
			this.state = "open";
			this.successCount = 0;
			logForDebugging(
				"[Fusion-MLX] Circuit breaker: HALF_OPEN → OPEN (probe failed)",
			);
		} else if (
			this.state === "closed" &&
			this.failureCount >= this.config.failureThreshold
		) {
			this.state = "open";
			logForDebugging(
				`[Fusion-MLX] Circuit breaker: CLOSED → OPEN (${this.failureCount} consecutive failures)`,
			);
		}
	}

	// Test seam: reset to initial closed state (isolates test cases from the
	// module-global mlxApiCircuit accumulating failures across prior tests).
	reset(): void {
		this.state = "closed";
		this.failureCount = 0;
		this.successCount = 0;
		this.lastFailureTime = 0;
	}
}

const mlxApiCircuit = new CircuitBreaker();

// ─── Per-Model Inference Parameters ────────────────────────────

export interface ModelInferenceParams {
	temperature: number;
	top_p: number;
	top_k?: number;
	repetition_penalty?: number;
	frequency_penalty?: number;
	presence_penalty?: number;
	enable_thinking?: boolean;
}

export function getModelInferenceParams(modelId: string): ModelInferenceParams {
	const envTemp = process.env.FUSION_MLX_TEMPERATURE;
	const envTopP = process.env.FUSION_MLX_TOP_P;
	const envThinking = process.env.FUSION_MLX_ENABLE_THINKING;
	const envRepPenalty = process.env.FUSION_MLX_REPETITION_PENALTY;

	const id = modelId.toLowerCase();

	// Resolve model-specific defaults first
	let modelDefaults: ModelInferenceParams;
	if (id.includes("qwen3")) {
		const isLargeModel = /\b(27b|32b|70b|72b)\b/.test(id);
		modelDefaults = {
			temperature: isLargeModel ? 0.2 : 0.3,
			top_p: 0.9,
			repetition_penalty: 1.05,
			enable_thinking: isLargeModel,
		};
	} else if (id.includes("deepseek") || id.includes("coder")) {
		modelDefaults = {
			temperature: 0.1,
			top_p: 0.95,
			repetition_penalty: 1.05,
		};
	} else if (id.includes("llama-3") || id.includes("llama3")) {
		modelDefaults = {
			temperature: 0.2,
			top_p: 0.9,
			repetition_penalty: 1.1,
		};
	} else if (id.includes("gemma") || id.includes("phi")) {
		modelDefaults = {
			temperature: 0.2,
			top_p: 0.9,
			repetition_penalty: 1.1,
		};
	} else if (/\b(0\.5b|1b|1\.5b|2b|3b)\b/.test(id)) {
		modelDefaults = {
			temperature: 0.3,
			top_p: 0.95,
		};
	} else {
		modelDefaults = {
			temperature: 0.3,
			top_p: 0.95,
		};
	}

	// Apply env var overrides on top of model defaults
	const hasEnvOverride =
		envTemp || envTopP || envThinking !== undefined || envRepPenalty;
	if (!hasEnvOverride) return modelDefaults;

	return {
		temperature: envTemp ? parseFloat(envTemp) : modelDefaults.temperature,
		top_p: envTopP ? parseFloat(envTopP) : modelDefaults.top_p,
		...(modelDefaults.repetition_penalty || envRepPenalty
			? {
					repetition_penalty: envRepPenalty
						? parseFloat(envRepPenalty)
						: modelDefaults.repetition_penalty,
				}
			: {}),
		...(modelDefaults.top_k ? { top_k: modelDefaults.top_k } : {}),
		...(modelDefaults.frequency_penalty
			? { frequency_penalty: modelDefaults.frequency_penalty }
			: {}),
		...(modelDefaults.presence_penalty
			? { presence_penalty: modelDefaults.presence_penalty }
			: {}),
		enable_thinking:
			envThinking !== undefined
				? isEnvTruthy(envThinking)
				: modelDefaults.enable_thinking,
	};
}

const ALLOWED_MLX_HOSTNAMES = new Set([
	"localhost",
	"127.0.0.1",
	"::1",
	"0.0.0.0",
]);

function isAllowedMlxHostname(hostname: string): boolean {
	if (ALLOWED_MLX_HOSTNAMES.has(hostname)) return true;
	// Allow RFC 1918 private ranges
	if (/^10\./.test(hostname)) return true;
	if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname)) return true;
	if (/^192\.168\./.test(hostname)) return true;
	// Allow .local mDNS hostnames
	if (hostname.endsWith(".local")) return true;
	return false;
}

// PERF-4 (0903 P3): the base URL is env-derived and immutable within the process, but getMlxApiUrl /
// isGatewayBaseUrl / getMlxAuthHeaders are each called per request, causing new URL() parsing
// + the isAllowedMlxHostname regex to repeat 2-3 times per request. Cache after the first parse (same pattern as _cachedMlxApiKey);
// the security warning is emitted only once, on the first call.
let _cachedMlxBaseUrl: string | null = null;
let _cachedMlxBaseUrlSource = "default";
function getMlxBaseUrl(): string {
	if (_cachedMlxBaseUrl !== null) return _cachedMlxBaseUrl;
	const url =
		process.env.FUSION_GATEWAY_URL ||
		process.env.FUSION_MLX_BASE_URL ||
		process.env.MLX_BASE_URL ||
		DEFAULT_MLX_BASE_URL;
	_cachedMlxBaseUrlSource = process.env.FUSION_GATEWAY_URL
		? "FUSION_GATEWAY_URL"
		: process.env.FUSION_MLX_BASE_URL
			? "FUSION_MLX_BASE_URL"
			: process.env.MLX_BASE_URL
				? "MLX_BASE_URL"
				: "default";
	try {
		const parsed = new URL(url);
		if (!isAllowedMlxHostname(parsed.hostname)) {
			// When the user explicitly configures a remote/public fusion-mlx (traveling, remote connection, public large-model fallback), respect that config:
			// no longer force a localhost fallback, just log a prominent security warning. The cloud path ANTHROPIC_BASE_URL never had this
			// restriction and can already point to the public internet, so stay consistent here; MLX optimization features still apply per provider, with no special tuning for public endpoints.
			const msg =
				`[Fusion-MLX] SECURITY: Base URL hostname "${parsed.hostname}" is not a local address. ` +
				`All conversation data will be sent to this external server. ` +
				`Proceeding with user-configured FUSION_MLX_BASE_URL (no fallback).`;
			console.error(msg);
			logForDebugging(msg, { level: "warn" });
		}
	} catch {
		console.error(
			`[Fusion-MLX] Invalid MLX base URL: ${url}, falling back to default`,
		);
		_cachedMlxBaseUrl = DEFAULT_MLX_BASE_URL;
		return DEFAULT_MLX_BASE_URL;
	}
	_cachedMlxBaseUrl = url;
	return url;
}

function getMlxApiUrl(path: string): string {
	const base = getMlxBaseUrl().replace(/\/+$/, "");
	return `${base}${path}`;
}

// #290 diagnostics: surface the ACTUAL endpoint in use (URL + winning env var)
// so health-failure errors stop claiming the hardcoded default. FUSION_GATEWAY_URL
// silently shadows FUSION_MLX_BASE_URL (documented precedence) — users setting
// only FUSION_MLX_BASE_URL must be able to see which var won.
export function getMlxEndpointDebug(): { url: string; source: string } {
	return { url: getMlxBaseUrl(), source: _cachedMlxBaseUrlSource };
}

// MLX server uses "--" as model name separator (HuggingFace org/model → org--model)
function toMlxModelName(model: string): string {
	return model.replace(/\//g, "--");
}

// fusion-mlx supports optional API key auth (see fusion_mlx/middleware/auth.py:
// _verify_api_key_values validates Authorization: Bearer / x-api-key once api_key is configured,
// anonymous allowed when unconfigured). Once configured, requests without credentials are rejected with 401.
//
// Auth consolidation (endpoint-unified semantics, #226): FUSION_CLIENT_KEY is the single canonical credential — regardless
// of whether the endpoint is cloud or local inference, one shared config (FUSION_AUTH_TOKEN is the equivalent
// alias). Historical gateway-specific keys (FUSION_GATEWAY_API_KEY / GATEWAY_API_KEY)
// remain as compatibility fallbacks, emitting a one-time deprecation warning on hit (#221). Engine-specific env aliases
// (legacy mlx key names, removed in #226) are no longer read; the engine layer keeps only
// the ~/.fusion-mlx/settings.json fallback — alias compatibility is fusion-core's responsibility, this repo keeps no chain.
//
// #221 cloud credential isolation: ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN are cloud proxy
// credentials and must not join the local auth chain — a cloud token left in the shell env hitting the local gateway
// gets a direct 401 (live repro). Allowed only with explicit FUSION_ALLOW_ANTHROPIC_TOKEN_LOCAL=1
// (same-shell cloud+local dual-stack scenario).
//
// Also: fusion-mlx route_guard (#343/#349) Phase 2 enforce by default, requests missing the X-Fusion-Route header
// are rejected with 403. Injected uniformly here; the value can be overridden via FUSION_ROUTE_HEADER.

// #221: credential-name deprecation warning — logged once per alias per session
const _warnedAliasKeys = new Set<string>();
function warnDeprecatedKeyAlias(name: string): void {
	if (_warnedAliasKeys.has(name)) return;
	_warnedAliasKeys.add(name);
	logForDebugging(
		`[auth] ${name} is deprecated — set FUSION_CLIENT_KEY instead (single canonical key for gateway + engine)`,
		{ level: "warn" },
	);
}

export function _resetAuthDeprecationWarningsForTest(): void {
	_warnedAliasKeys.clear();
	_authDebugLogged = false;
	_cachedMlxApiKey = null;
}

export function _deprecatedAliasWarningCountForTest(): number {
	return _warnedAliasKeys.size;
}

export interface MlxCredentialResolution {
	value: string | undefined;
	name: string;
}

// Local engine-side credential chain (#226: legacy env aliases removed, only the settings.json fallback remains)
function resolveMlxEngineCredential(): MlxCredentialResolution {
	const fromSettings = getMlxApiKey();
	return {
		value: fromSettings,
		name: fromSettings ? "~/.fusion-mlx/settings.json auth.api_key" : "none",
	};
}

// Full local-mode credential resolution (gateway layer → engine layer), shared by auth headers + debug logging.
export function resolveMlxCredential(): MlxCredentialResolution {
	if (process.env.FUSION_CLIENT_KEY) {
		return { value: process.env.FUSION_CLIENT_KEY, name: "FUSION_CLIENT_KEY" };
	}
	if (process.env.FUSION_AUTH_TOKEN) {
		return { value: process.env.FUSION_AUTH_TOKEN, name: "FUSION_AUTH_TOKEN" };
	}
	// #221: cloud credentials stay out of the local chain by default; admitted only on explicit opt-in
	if (process.env.FUSION_ALLOW_ANTHROPIC_TOKEN_LOCAL === "1") {
		if (process.env.ANTHROPIC_API_KEY) {
			return {
				value: process.env.ANTHROPIC_API_KEY,
				name: "ANTHROPIC_API_KEY (opt-in FUSION_ALLOW_ANTHROPIC_TOKEN_LOCAL)",
			};
		}
		if (process.env.ANTHROPIC_AUTH_TOKEN) {
			return {
				value: process.env.ANTHROPIC_AUTH_TOKEN,
				name: "ANTHROPIC_AUTH_TOKEN (opt-in FUSION_ALLOW_ANTHROPIC_TOKEN_LOCAL)",
			};
		}
	}
	if (isGatewayBaseUrl()) {
		const gwKey = process.env.FUSION_GATEWAY_API_KEY;
		if (gwKey) {
			warnDeprecatedKeyAlias("FUSION_GATEWAY_API_KEY");
			return {
				value: gwKey,
				name: "FUSION_GATEWAY_API_KEY (deprecated)",
			};
		}
		const legacyGwKey = process.env.GATEWAY_API_KEY;
		if (legacyGwKey) {
			warnDeprecatedKeyAlias("GATEWAY_API_KEY");
			return { value: legacyGwKey, name: "GATEWAY_API_KEY (deprecated)" };
		}
	}
	// gateway has no key configured → reuse the engine key (single-machine deployments usually share it)
	return resolveMlxEngineCredential();
}

// #221 req 4: startup debug line — provider / base URL / credential name (value never logged).
// Logged once when the first real request is sent, avoiding cold-start overhead.
let _authDebugLogged = false;
function logAuthResolutionOnce(cred: MlxCredentialResolution): void {
	if (_authDebugLogged) return;
	_authDebugLogged = true;
	logForDebugging(
		`auth resolution: provider=fusionMlx base_url=${getMlxBaseUrl()} credential=${cred.name}`,
	);
}

function getMlxAuthHeaders(): Record<string, string> {
	const headers: Record<string, string> = {
		"X-Fusion-Route":
			process.env.FUSION_ROUTE_HEADER || DEFAULT_FUSION_ROUTE_HEADER,
	};
	const cred = resolveMlxCredential();
	logAuthResolutionOnce(cred);
	if (cred.value) {
		headers.Authorization = `Bearer ${cred.value}`;
	}
	return headers;
}

// Decides whether the current base URL points at the gateway (default 11432) rather than MLX direct (11434).
function isGatewayBaseUrl(): boolean {
	try {
		const parsed = new URL(getMlxBaseUrl());
		return parsed.port === "11432";
	} catch {
		return true; // the default base URL is the gateway
	}
}

let _cachedMlxApiKey: string | undefined | null = null;
function getMlxApiKey(): string | undefined {
	if (_cachedMlxApiKey !== null) return _cachedMlxApiKey;
	try {
		const fs = require("node:fs");
		const path = require("node:path");
		const settingsPath = path.join(
			process.env.HOME || process.env.USERPROFILE || "",
			".fusion-mlx",
			"settings.json",
		);
		if (fs.existsSync(settingsPath)) {
			const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
			if (settings?.auth?.api_key) {
				_cachedMlxApiKey = settings.auth.api_key;
				return _cachedMlxApiKey;
			}
		}
	} catch (_e) {
		// Silently ignore — fall through to no auth
	}
	_cachedMlxApiKey = undefined;
	return undefined;
}

function getMlxTimeout(streaming: boolean): number {
	if (streaming) {
		return parseInt(
			process.env.FUSION_MLX_TIMEOUT_MS || String(DEFAULT_STREAM_TIMEOUT_MS),
			10,
		);
	}
	return parseInt(
		process.env.FUSION_MLX_TIMEOUT_MS || String(DEFAULT_QUERY_TIMEOUT_MS),
		10,
	);
}

/**
 * Fetch with retry on connection failure.
 * Local MLX may be still warming up (loading model weights) on first call.
 * audit 0905 P0-B: the outer acquire/release semaphore caps concurrency; internal recursive retries do not re-enter the semaphore.
 */
async function mlxFetchWithRetry(
	url: string,
	init: RequestInit,
	retries: number = MAX_RETRIES,
): Promise<Response> {
	await acquireMlxSlot();
	try {
		return await mlxFetchWithRetryInner(url, init, retries);
	} finally {
		releaseMlxSlot();
	}
}

async function mlxFetchWithRetryInner(
	url: string,
	init: RequestInit,
	retries: number = MAX_RETRIES,
): Promise<Response> {
	const authHeaders = getMlxAuthHeaders();
	if (Object.keys(authHeaders).length > 0) {
		init = {
			...init,
			headers: { ...(init.headers as Record<string, string>), ...authHeaders },
		};
		logForDebugging(
			`[Fusion-MLX] Attaching Authorization header (credential: ${authHeaders.Authorization ? "resolved" : "none"})`,
		);
	}
	if (!mlxApiCircuit.allowRequest()) {
		throw new Error(
			"[Fusion-MLX] Circuit breaker is OPEN — MLX server unavailable, will retry after cooldown",
		);
	}

	const warmupTimeout = parseInt(
		process.env.FUSION_MLX_WARMUP_TIMEOUT_MS ||
			String(DEFAULT_WARMUP_TIMEOUT_MS),
		10,
	);

	try {
		// P3-9: removed the leftover debug console.error — fired on every MLX request, printing the full URL (some configs
		// carry auth query params) + status to stderr, leaking through the WS chat handler to the client.
		// Replaced with logForDebugging + the FUSION_CODE_DEBUG_MLX_FETCH gate, silent by default.
		if (isEnvTruthy(process.env.FUSION_CODE_DEBUG_MLX_FETCH)) {
			logForDebugging(
				`mlx fetch: origFetch===globalThis.fetch? ${getOriginalFetch() === globalThis.fetch}`,
			);
		}
		const response = await getOriginalFetch()(url, init);
		if (isEnvTruthy(process.env.FUSION_CODE_DEBUG_MLX_FETCH)) {
			logForDebugging(`mlx fetch: ok=${response.ok} status=${response.status}`);
		}
		if (response.ok) {
			mlxApiCircuit.recordSuccess();
		} else if (response.status >= 500) {
			mlxApiCircuit.recordFailure();
		} else if (response.status === 401 || response.status === 403) {
			// Auth/route header failures are not retried (not connection errors); emit a clear diagnosis (issue #52 D2).
			// 401: key tier mismatch or wrong key; 403: missing X-Fusion-Route header rejected by route_guard.
			const layer = isGatewayBaseUrl() ? "gateway" : "MLX";
			const hint =
				response.status === 401
					? `Auth failed (${layer} layer). Check first whether FUSION_CLIENT_KEY / FUSION_AUTH_TOKEN matches the endpoint's auth config; historical gateway-specific keys (FUSION_GATEWAY_API_KEY matching fusion-gateway config.yaml auth.api_keys) are still read as fallback, engine-side fallback ~/.fusion-mlx/settings.json auth.api_key`
					: `route_guard rejection (X-Fusion-Route header missing or value not accepted). Current header: X-Fusion-Route=${process.env.FUSION_ROUTE_HEADER || DEFAULT_FUSION_ROUTE_HEADER}`;
			// ERR-3 (0903 P3): auth/route failure must be observable in production.
			// logForDebugging is gated by debug-mode (shouldLogDebugMessage returns
			// false for non-ant + debug off), so the 401/403 diagnostic was silent
			// in prod — a fail-open gap. Mirror getMlxBaseUrl's security-warn shape:
			// console.error (always visible) + logForDebugging (debug capture).
			console.error(
				`[Fusion-MLX] request rejected with ${response.status} — ${hint}`,
			);
			logForDebugging(
				`[Fusion-MLX] request rejected with ${response.status} — ${hint}`,
				{
					level: "warn",
				},
			);
		}
		return response;
	} catch (error) {
		const err = error as Error;
		// User-initiated interrupt (ESC): no retry, throw immediately so the upper-layer withRetry converts it to APIUserAbortError
		if (init.signal?.aborted) {
			logForDebugging("[Fusion-MLX] Request aborted by user, not retrying");
			throw error;
		}

		const isConnectionError =
			err.message?.includes("ECONNREFUSED") ||
			err.message?.includes("ECONNRESET") ||
			err.message?.includes("fetch failed") ||
			err.message?.includes("socket hang up") ||
			err.name === "AbortError";

		if (isConnectionError) {
			mlxApiCircuit.recordFailure();
		}

		if (retries <= 0 || !isConnectionError) throw error;

		// audit 2.2.3: 3s fixed delay plus jitter. N concurrent instances synchronously retrying on connection failure = a thundering herd,
		// stacking transient impact on the shared MLX service. Same shape as withRetry.getRetryDelay: 25% random jitter of baseDelay,
		// 3000±750ms. Jitter decouples the timing of concurrent retries.
		const baseDelay = 3000;
		const jitter = Math.random() * 0.25 * baseDelay;
		const retryDelay = Math.round(baseDelay + jitter);
		logForDebugging(
			`[Fusion-MLX] Connection failed, retrying in ${retryDelay}ms (retries left: ${retries}): ${err.message}`,
		);

		// Listen for user interrupts during the delay so ESC takes effect immediately instead of waiting out the full delay.
		// P3-1 (audit 0901): when the timer resolves normally the abort listener is not auto-removed ({ once:true }
		// self-removes only when abort fires) → reused/long-lived signals accumulate one listener + closure per retry, O(n) leak
		// until signal GC. holder + finally removeEventListener clean up (no-op on the already-aborted path).
		const promiseHolder: { onAbort?: () => void } = {};
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(resolve, retryDelay);
			const onAbort = () => {
				clearTimeout(timer);
				reject(error);
			};
			if (init.signal) {
				init.signal.addEventListener("abort", onAbort, { once: true });
				promiseHolder.onAbort = onAbort;
			}
		}).finally(() => {
			if (init.signal && promiseHolder.onAbort) {
				init.signal.removeEventListener("abort", promiseHolder.onAbort);
				promiseHolder.onAbort = undefined;
			}
		});

		// Re-check whether the user has interrupted before retrying
		if (init.signal?.aborted) throw error;

		// Combine the original signal (preserving user abort capability) + timeout (prevents hangs)
		const retryInit = {
			...init,
			signal: init.signal
				? AbortSignal.any([init.signal, AbortSignal.timeout(warmupTimeout)])
				: AbortSignal.timeout(warmupTimeout),
		};

		try {
			const retryResponse = await getOriginalFetch()(url, retryInit);
			if (retryResponse.ok) {
				mlxApiCircuit.recordSuccess();
			} else if (retryResponse.status >= 500) {
				mlxApiCircuit.recordFailure();
			}
			return retryResponse;
		} catch (retryError) {
			mlxApiCircuit.recordFailure();
			if (retries - 1 <= 0) throw retryError;
			return mlxFetchWithRetryInner(url, init, retries - 1);
		}
	}
}

// ─── Health Check ─────────────────────────────────────────────

export interface FusionMlxStatus {
	available: boolean;
	version?: string;
	models: string[];
	uptime_seconds?: number;
}

/**
 * Detects whether the fusion-mlx service is available.
 * Probes by calling the /v1/models endpoint (compatible with MLX services that lack /v1/health).
 */
export async function checkFusionMlxHealth(): Promise<FusionMlxStatus> {
	try {
		const response = await getOriginalFetch()(getMlxApiUrl("/v1/models"), {
			method: "GET",
			headers: { ...getMlxAuthHeaders() },
			signal: AbortSignal.timeout(3000),
		});

		if (!response.ok) {
			// 401 = service is running but auth failed (key tier mismatch or wrong key, see issue #52).
			// 403 = route_guard Phase 2 enforce rejection (missing X-Fusion-Route header).
			// Both mean the service is running but the fusion-code-side config needs fixing; still recorded as available
			// but with explicit diagnostic guidance, rather than a silent misjudgment.
			if (response.status === 401) {
				const hint = isGatewayBaseUrl()
					? "gateway-layer auth failed. Check first whether FUSION_CLIENT_KEY / FUSION_AUTH_TOKEN matches the endpoint's auth config; the dedicated historical key FUSION_GATEWAY_API_KEY (matching fusion-gateway config.yaml auth.api_keys) is still read as fallback"
					: "MLX-layer auth failed. Check first FUSION_CLIENT_KEY / FUSION_AUTH_TOKEN; engine-side fallback is ~/.fusion-mlx/settings.json auth.api_key (#226: legacy env aliases removed)";
				logForDebugging(
					`[Fusion-MLX] Health check got 401 — server running, auth failed. ${hint}`,
					{ level: "warn" },
				);
				return {
					available: true,
					version: "unknown",
					models: [],
					uptime_seconds: 0,
				};
			}
			if (response.status === 403) {
				logForDebugging(
					`[Fusion-MLX] Health check got 403 — route_guard rejection (X-Fusion-Route header missing or value not accepted). Current header: X-Fusion-Route=${process.env.FUSION_ROUTE_HEADER || DEFAULT_FUSION_ROUTE_HEADER}. If MLX-side FUSION_ROUTE_ENFORCE is set to warn-only, this 403 can be ignored.`,
					{ level: "warn" },
				);
				return {
					available: true,
					version: "unknown",
					models: [],
					uptime_seconds: 0,
				};
			}
			return { available: false, models: [] };
		}

		const data = (await response.json()) as MLXModelListResponse;
		const models = data.data?.map((m) => m.id) || [];
		return {
			available: true,
			version: "unknown",
			models,
			uptime_seconds: 0,
		};
	} catch (error) {
		logForDebugging(
			`[Fusion-MLX] Health check failed: ${(error as Error).message}`,
		);
		return { available: false, models: [] };
	}
}

// fusion-mlx#564 (PR #581): GET /v1/health reads memory/OOM state, management-gated
// (verify_management_access — requires a valid api_key, loopback not exempt per #350). Used for
// /doctor P4.2 #4 proactive OOM detection + enhance-0819 item 15 OOM recovery.
// 401 = MLX has no key configured (anonymous deployment) or key tier mismatch → management endpoint unavailable,
//   fail-open returns null (does not block /doctor, no false OOM report).
// Network/timeout/non-200 → null fail-open. Called by detectMlxHealth only on the MLX provider.
export async function fetchMlxHealth(): Promise<MLXHealthResponse | null> {
	try {
		const response = await getOriginalFetch()(getMlxApiUrl("/v1/health"), {
			method: "GET",
			headers: { ...getMlxAuthHeaders() },
			signal: AbortSignal.timeout(3000),
		});
		if (!response.ok) {
			logForDebugging(
				`[Fusion-MLX] /v1/health returned ${response.status} (management-gated; ${response.status === 401 ? "MLX has no key configured or key tier mismatch" : "rejected by server"}) — OOM diagnostics skipped`,
				{ level: "debug" },
			);
			return null;
		}
		const data = (await response.json()) as MLXHealthResponse;
		return data;
	} catch (error) {
		logForDebugging(
			`[Fusion-MLX] /v1/health fetch failed: ${(error as Error).message}`,
		);
		return null;
	}
}

// Post-compact GC for MLX: request fusion-mlx backend to release KV cache
// Importers: compact.ts (after compactConversation), hardCompact.ts (after hard compact)
// User instruction: "Study suggest1.md and suggest2.md in depth, draw up a plan, fix the issues, and improve fusion-code competitiveness"
// suggest1.md: "mx.metal.clear_cache() after compact" to prevent memory spike
// API: POST /api/v1/gc → { mem_before, mem_after, freed }
export interface MlxGCResult {
	success: boolean;
	memBefore?: number;
	memAfter?: number;
	freed?: number;
	error?: string;
}

export async function requestMlxGC(): Promise<MlxGCResult> {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 5000);
		const response = await fetch(getMlxApiUrl("/api/v1/gc"), {
			method: "POST",
			headers: { ...getMlxAuthHeaders(), "Content-Type": "application/json" },
			signal: controller.signal,
		});
		clearTimeout(timer);

		if (!response.ok) {
			logForDebugging(`[Fusion-MLX] GC request failed: ${response.status}`, {
				level: "warn",
			});
			return { success: false, error: `HTTP ${response.status}` };
		}

		const data = (await response.json()) as {
			mem_before?: number;
			mem_after?: number;
			freed?: number;
		};
		logForDebugging(
			`[Fusion-MLX] GC completed: freed ${data.freed ?? "unknown"} bytes`,
		);
		return {
			success: true,
			memBefore: data.mem_before,
			memAfter: data.mem_after,
			freed: data.freed,
		};
	} catch (error) {
		logForDebugging(
			`[Fusion-MLX] GC request error: ${(error as Error).message}`,
			{ level: "warn" },
		);
		return { success: false, error: (error as Error).message };
	}
}

/**
 * Lists the models available on fusion-mlx.
 */
export async function getFusionMlxModels(): Promise<MLXModelInfo[]> {
	try {
		const response = await fetch(getMlxApiUrl("/v1/models"), {
			method: "GET",
			headers: { ...getMlxAuthHeaders() },
			signal: AbortSignal.timeout(5000),
		});

		if (!response.ok) {
			return [];
		}

		const data = (await response.json()) as MLXModelListResponse;
		return data.data || [];
	} catch (error) {
		logForDebugging(
			`[Fusion-MLX] Model list fetch failed: ${(error as Error).message}`,
		);
		return [];
	}
}

/**
 * Gets the recommended model ID for code tasks.
 * Prefers code-specific models, falling back to general models.
 */
export async function getRecommendedCodeModel(): Promise<string | null> {
	const models = await getFusionMlxModels();
	if (models.length === 0) return null;

	// Exclude non-chat models: image/video generation, base components like encoders/transformer/vae, base pretrained models
	const excludeKeywords = [
		"flux",
		"skyreels",
		"image",
		"video",
		"ltx",
		"a2v",
		"v2v",
		"r2v",
		"klein",
		"txt2vid",
		"img2vid",
		"tts",
		"whisper",
		"embed",
		"bge",
		"encoder",
		"transformer",
		"vae",
		"base",
		"pretrain",
	];
	const chatModels = models.filter(
		(m) => !excludeKeywords.some((k) => m.id.toLowerCase().includes(k)),
	);
	if (chatModels.length === 0) return models[0].id;

	// Token-split matching, avoiding the 'code' substring falsely matching 'encoder' (e-n-code-r)
	const tokensOf = (id: string): string[] =>
		id
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter(Boolean);
	// Estimate parameter count (billions) from the id, e.g. 32b/1b/0.6b/27b; returns 0 when undeterminable
	const sizeOf = (id: string): number => {
		const m = id.toLowerCase().match(/(\d+(?:\.\d+)?)\s*b\b/);
		return m ? parseFloat(m[1]) : 0;
	};

	// Exclude models that are too small (≤3B): they cannot do reliable tool calling; /init etc. would emit tool definitions instead of calls
	const capable = chatModels.filter((m) => {
		const size = sizeOf(m.id);
		return size === 0 || size > 3;
	});
	const pool = capable.length > 0 ? capable : chatModels;

	// Prefer code-specific models (coder/code/codestral), taking the largest by parameter count in descending order
	const codeTokens = ["coder", "code", "codestral"];
	const codeModels = pool.filter((m) =>
		tokensOf(m.id).some((t) => codeTokens.includes(t)),
	);
	if (codeModels.length > 0) {
		codeModels.sort((a, b) => sizeOf(b.id) - sizeOf(a.id));
		logForDebugging(
			`[Fusion-MLX] Recommended code model: ${codeModels[0].id} (${codeModels.length} code candidates)`,
		);
		return codeModels[0].id;
	}

	// Fallback: take the largest instruction/chat model by parameter count in descending order
	pool.sort((a, b) => sizeOf(b.id) - sizeOf(a.id));
	logForDebugging(
		`[Fusion-MLX] Recommended code model (fallback by size): ${pool[0].id}`,
	);
	return pool[0].id;
}

// ─── Model Capabilities ────────────────────────────────────────────

export interface MlxModelCapabilities {
	supportsToolCalling: boolean;
	supportsStreaming: boolean;
	supportsVision: boolean;
	maxContextTokens: number;
	maxOutputTokens: number;
	isSmallModel: boolean; // ≤3B parameters
	isMediumModel: boolean; // 7-9B parameters
	supportsStructuredOutput: boolean; // json_schema response_format
}

const cachedCapabilities: Map<string, MlxModelCapabilities> = new Map();

/**
 * Detect capabilities of a specific MLX model.
 * Uses model name heuristics + API-reported metadata.
 */
export async function getMlxModelCapabilities(
	modelId: string,
): Promise<MlxModelCapabilities> {
	if (cachedCapabilities.has(modelId)) {
		const cached = cachedCapabilities.get(modelId);
		if (cached !== undefined) return cached;
	}

	const id = modelId.toLowerCase();
	const mlxModelId = toMlxModelName(modelId);
	const models = await getFusionMlxModels();
	const modelInfo = models.find(
		(m) => m.id === mlxModelId || m.id === modelId || m.id.includes(modelId),
	);

	// Size heuristics from model ID
	const isSmallModel = /\b(0\.5b|1b|2b|3b)\b/.test(id);
	const isMediumModel = /\b(7b|8b|9b)\b/.test(id);

	// Tool calling: most instruct/chat models support it; base models don't
	const baseModelKeywords = ["base", "pt", "pretrain"];
	const isBaseModel = baseModelKeywords.some((k) => id.includes(k));
	const supportsToolCalling = !isBaseModel && !isSmallModel;

	// Structured output (json_schema response_format): supported by models with grammar/constraint engines
	const structuredKeywords = [
		"qwen3",
		"qwen2.5",
		"llama-3",
		"llama3",
		"mistral",
		"gemma",
		"phi-4",
		"phi4",
	];
	const supportsStructuredOutput =
		!isBaseModel &&
		!isSmallModel &&
		structuredKeywords.some((k) => id.includes(k));

	// Vision: only models with image/vision keywords
	const visionKeywords = [
		"vision",
		"vl",
		"llava",
		"qwen2-vl",
		"pixtral",
		"minicpm-v",
		"internvl",
	];
	const supportsVision = visionKeywords.some((k) => id.includes(k));

	// Context length from API or heuristics. The engine reports the native
	// window as context_length; max_input_tokens is the older field name.
	const maxContextTokens =
		modelInfo?.max_input_tokens ||
		modelInfo?.context_length ||
		(isSmallModel ? 16384 : 32768);
	const maxOutputTokens =
		modelInfo?.max_output_tokens || (isSmallModel ? 2048 : 4096);

	const caps: MlxModelCapabilities = {
		supportsToolCalling,
		supportsStreaming: true,
		supportsVision,
		maxContextTokens,
		maxOutputTokens,
		isSmallModel,
		isMediumModel,
		supportsStructuredOutput,
	};

	cachedCapabilities.set(modelId, caps);
	logForDebugging(
		`[Fusion-MLX] Capabilities for ${modelId}: ${JSON.stringify(caps)}`,
	);
	return caps;
}

/**
 * Clear cached capabilities (call on model switch).
 */
export function clearMlxCapabilitiesCache(): void {
	cachedCapabilities.clear();
}

// ─── Message Format Conversion ────────────────────────────────

/**
 * Converts Anthropic Messages API format into the OpenAI-compatible MLX message format.
 *
 * System prompts support two forms:
 *   - string (options.system from queryFusionMlx/streamFusionMlx)
 *   - Anthropic array format (body.system from createFusionMlxFetch)
 *
 * Tool calls are uniformly emitted as OpenAI tool_calls format (not embedded in content).
 */
function anthropicToMlxMessages(
	anthropicMessages: Array<{
		role: string;
		content: string | Array<Record<string, unknown>>;
	}>,
	systemPrompt?: string | Array<Record<string, unknown>>,
): MLXChatMessage[] {
	const messages: MLXChatMessage[] = [];

	// System prompt — split on DYNAMIC_BOUNDARY for KV cache prefix reuse
	// audit §1.3.1: preserve Anthropic cache_control from system blocks (array form).
	// fusion-mlx _detect_prefix_cache_boundary reads message-level cache_control on
	// system messages to set the KV prefix boundary. Adapter emits ONE system message,
	// so carry the marker at message level (the only boundary fusion-mlx supports).
	if (systemPrompt) {
		let systemText: string;
		// audit §1.3.1: track cache_control across the array flatten; pass through verbatim.
		let systemCacheControl: Record<string, string> | undefined;
		if (typeof systemPrompt === "string") {
			systemText = systemPrompt;
		} else if (Array.isArray(systemPrompt)) {
			const texts: string[] = [];
			for (const b of systemPrompt) {
				if (b.type === "text") {
					texts.push(b.text as string);
				}
				// audit §1.3.1: capture cache_control from any system block (last one wins,
				// matching Anthropic's "last cache_control = boundary" convention).
				const cc = (b as { cache_control?: Record<string, string> })
					.cache_control;
				if (cc) {
					systemCacheControl = cc;
				}
			}
			systemText = texts.filter(Boolean).join("\n");
		} else {
			systemText = "";
		}

		if (systemText) {
			const boundaryIdx = systemText.indexOf("SYSTEM_PROMPT_DYNAMIC_BOUNDARY");
			if (boundaryIdx !== -1) {
				const staticPrefix = systemText.slice(0, boundaryIdx).trim();
				const dynamicSuffix = systemText
					.slice(boundaryIdx + "SYSTEM_PROMPT_DYNAMIC_BOUNDARY".length)
					.trim();
				// Log prefix boundary for KV cache optimization tracking
				logForDebugging(
					`[Fusion-MLX] System prompt split: static=${staticPrefix.length} chars, dynamic=${dynamicSuffix.length} chars`,
				);
				// Combine — MLX API uses single system message; prefix ordering still benefits KV cache
				// when fusion-mlx server adds cache-aware API, we can send as separate cached/uncached blocks
				messages.push({
					role: "system",
					content: `${staticPrefix}\n${dynamicSuffix}`,
					...(systemCacheControl ? { cache_control: systemCacheControl } : {}),
				});
			} else {
				messages.push({
					role: "system",
					content: systemText,
					...(systemCacheControl ? { cache_control: systemCacheControl } : {}),
				});
			}
			if (systemCacheControl) {
				logForDebugging(
					`[Fusion-MLX] cache_control preserved on system prefix (KV boundary enabled)`,
				);
			}
		}
	}

	for (const msg of anthropicMessages) {
		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				messages.push({ role: "user", content: msg.content });
			} else if (Array.isArray(msg.content)) {
				const parts: Array<{
					type: string;
					text?: string;
					image_url?: { url: string };
					// audit §1.3.1: carry cache_control through content-block translation
					cache_control?: Record<string, string>;
				}> = [];
				for (const block of msg.content) {
					if (block.type === "text") {
						// audit §1.3.1: preserve Anthropic cache_control on text content parts.
						const cc = (block as { cache_control?: Record<string, string> })
							.cache_control;
						parts.push({
							type: "text",
							text: block.text as string,
							...(cc ? { cache_control: cc } : {}),
						});
					} else if (block.type === "image") {
						const source = block.source as {
							type: string;
							media_type?: string;
							data?: string;
						};
						if (source.type === "base64" && source.data && source.media_type) {
							parts.push({
								type: "image_url",
								image_url: {
									url: `data:${source.media_type};base64,${source.data}`,
								},
							});
						}
					} else if (block.type === "tool_result") {
						const toolResult = block as {
							tool_use_id: string;
							content: string | Array<Record<string, unknown>>;
						};
						const content =
							typeof toolResult.content === "string"
								? toolResult.content
								: Array.isArray(toolResult.content)
									? toolResult.content
											.map((c) => (c as { text?: string }).text || "")
											.join("\n")
									: "";
						messages.push({
							role: "tool",
							content,
							tool_call_id: toolResult.tool_use_id,
						});
					}
				}
				if (parts.length > 0) {
					messages.push({
						role: "user",
						content: parts as MLXChatMessage["content"],
					});
				}
			}
		} else if (msg.role === "assistant") {
			if (typeof msg.content === "string") {
				messages.push({ role: "assistant", content: msg.content });
			} else if (Array.isArray(msg.content)) {
				let textContent = "";
				const toolCalls: Array<{
					id: string;
					name: string;
					input: Record<string, unknown>;
				}> = [];

				for (const block of msg.content) {
					if (block.type === "text") {
						textContent += (block as { text: string }).text;
					} else if (block.type === "tool_use") {
						const tb = block as {
							id: string;
							name: string;
							input: Record<string, unknown>;
						};
						toolCalls.push({ id: tb.id, name: tb.name, input: tb.input });
					}
				}

				if (toolCalls.length > 0) {
					messages.push({
						role: "assistant",
						content: textContent || "",
						tool_calls: toolCalls.map((tc) => ({
							id: tc.id,
							type: "function",
							function: {
								name: tc.name,
								arguments: JSON.stringify(tc.input),
							},
						})),
					} as MLXChatMessage);
				} else {
					messages.push({ role: "assistant", content: textContent });
				}
			}
		}
	}

	return messages;
}

/**
 * Converts the Anthropic tool_choice format into the MLX/OpenAI-compatible format.
 * Anthropic: {type: 'auto' | 'any' | 'tool', name?: string}
 * OpenAI:   'auto' | 'any' | 'none' | {type: 'function', function: {name: string}}
 */
/**
 * Converts Anthropic tool definitions into OpenAI-compatible format while sanitizing the Schema.
 */
function anthropicToMlxTools(
	tools: Array<{
		name: string;
		description: string;
		input_schema: Record<string, unknown>;
	}>,
): MLXToolDefinition[] {
	const cleaned = cleanToolList(tools) as Array<{
		name: string;
		description: string;
		input_schema: Record<string, unknown>;
	}>;
	return cleaned.map((tool) => ({
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.input_schema,
		},
	}));
}

// ─── Core API Calls ────────────────────────────────────────────

export interface FusionMlxCallOptions {
	model: string;
	messages: Array<{
		role: string;
		content: string | Array<Record<string, unknown>>;
	}>;
	system?: string;
	max_tokens?: number;
	temperature?: number;
	stream?: boolean;
	tools?: Array<{
		name: string;
		description: string;
		input_schema: Record<string, unknown>;
	}>;
	/**
	 * Structured output Schema (OpenAI response_format).
	 * When set, model output is forcibly constrained to JSON matching this Schema.
	 * Replaces the brittle prompt constraint + regex parsing of tool calls.
	 */
	response_format?: MLXChatCompletionRequest["response_format"];
}

/**
 * Calls fusion-mlx for non-streaming inference.
 * Returns a response compatible with the Anthropic Messages API format.
 */
export async function queryFusionMlx(
	options: FusionMlxCallOptions,
): Promise<AnthropicNonStreamingResponse> {
	const mlxMessages = anthropicToMlxMessages(options.messages, options.system);
	const mlxTools = options.tools
		? anthropicToMlxTools(options.tools)
		: undefined;

	const inferenceParams = getModelInferenceParams(options.model);

	const requestBody: MLXChatCompletionRequest = {
		model: toMlxModelName(options.model),
		messages: mlxMessages,
		max_tokens: options.max_tokens || 8192,
		temperature: options.temperature ?? inferenceParams.temperature,
		top_p: inferenceParams.top_p,
		...(inferenceParams.repetition_penalty
			? { repetition_penalty: inferenceParams.repetition_penalty }
			: {}),
		...(inferenceParams.enable_thinking !== undefined
			? { enable_thinking: inferenceParams.enable_thinking }
			: {}),
		stream: false,
		...(mlxTools && mlxTools.length > 0 ? { tools: mlxTools } : {}),
		...(options.response_format
			? { response_format: options.response_format }
			: {}),
	};

	logForDebugging(
		`[Fusion-MLX] Query model=${options.model} messages=${mlxMessages.length} tools=${mlxTools?.length ?? 0}`,
	);

	try {
		const response = await mlxFetchWithRetry(
			getMlxApiUrl("/v1/chat/completions"),
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(requestBody),
				signal: AbortSignal.timeout(getMlxTimeout(false)),
			},
		);

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`Fusion-MLX API error: ${response.status} ${response.statusText} - ${errorText}`,
			);
		}

		const data = (await response.json()) as MLXChatCompletionResponse;
		return transformMLXResponseToAnthropic(data);
	} catch (error) {
		logForDebugging(`[Fusion-MLX] Query failed: ${(error as Error).message}`);
		throw error;
	}
}

/**
 * Calls fusion-mlx for streaming inference.
 * Returns an AsyncGenerator yielding Anthropic-compatible streaming events.
 */
export async function* streamFusionMlx(
	options: FusionMlxCallOptions,
): AsyncGenerator<AnthropicStreamEvent> {
	const mlxMessages = anthropicToMlxMessages(options.messages, options.system);
	const mlxTools = options.tools
		? anthropicToMlxTools(options.tools)
		: undefined;

	const inferenceParams = getModelInferenceParams(options.model);

	const requestBody: MLXChatCompletionRequest = {
		model: toMlxModelName(options.model),
		messages: mlxMessages,
		max_tokens: options.max_tokens || 8192,
		temperature: options.temperature ?? inferenceParams.temperature,
		top_p: inferenceParams.top_p,
		...(inferenceParams.repetition_penalty
			? { repetition_penalty: inferenceParams.repetition_penalty }
			: {}),
		...(inferenceParams.enable_thinking !== undefined
			? { enable_thinking: inferenceParams.enable_thinking }
			: {}),
		stream: true,
		...(mlxTools && mlxTools.length > 0 ? { tools: mlxTools } : {}),
		...(options.response_format
			? { response_format: options.response_format }
			: {}),
	};

	logForDebugging(
		`[Fusion-MLX] Stream model=${options.model} messages=${mlxMessages.length} tools=${mlxTools?.length ?? 0}`,
	);

	try {
		const makeAttempt = async function* () {
			const response = await mlxFetchWithRetry(
				getMlxApiUrl("/v1/chat/completions"),
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify(requestBody),
					signal: AbortSignal.timeout(getMlxTimeout(true)),
				},
			);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(
					`Fusion-MLX API error: ${response.status} ${response.statusText} - ${errorText}`,
				);
			}

			yield* transformMLXStreamToAnthropic(response, options.model);
		};

		yield* withSilentStreamRetry(makeAttempt);
	} catch (error) {
		logForDebugging(`[Fusion-MLX] Stream failed: ${(error as Error).message}`);
		throw error;
	}
}

// ─── Embeddings (RAG / KB) ─────────────────────────────────────

/**
 * Calls the fusion-mlx embeddings API to vectorize text.
 * Used for knowledge base retrieval (RAG).
 */
export async function getFusionMlxEmbeddings(
	input: string | string[],
	model?: string,
): Promise<number[][]> {
	const requestBody: MLXEmbeddingRequest = {
		model: toMlxModelName(model || "default"),
		input,
	};

	try {
		const response = await fetch(getMlxApiUrl("/v1/embeddings"), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...getMlxAuthHeaders(),
			},
			body: JSON.stringify(requestBody),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			throw new Error(
				`Fusion-MLX embeddings error: ${response.status} ${response.statusText}`,
			);
		}

		const data = (await response.json()) as MLXEmbeddingResponse;
		return data.data.map((item) => item.embedding);
	} catch (error) {
		logForDebugging(
			`[Fusion-MLX] Embeddings failed: ${(error as Error).message}`,
		);
		throw error;
	}
}

// ─── Configuration Helpers ─────────────────────────────────────

/**
 * Decides whether fusion-mlx should be used as the AI backend.
 * Priority: env vars > auto-detection
 */
export function shouldUseFusionMlx(): boolean {
	// env var forces enabled
	if (isEnvTruthy(process.env.FUSION_MLX_ENABLED)) {
		return true;
	}

	// env var forces disabled
	if (isEnvTruthy(process.env.FUSION_MLX_DISABLED)) {
		return false;
	}

	// Default: auto-detect if FUSION_CLIENT_KEY is unset and FUSION_MLX_AUTO is enabled
	if (
		isEnvTruthy(process.env.FUSION_MLX_AUTO) &&
		!process.env.FUSION_CLIENT_KEY
	) {
		return true; // returning true means prefer trying MLX first
	}

	return false;
}

/**
 * Gets the default fusion-mlx model.
 * Prefers the FUSION_MLX_MODEL env var, otherwise returns null (auto-selected by the runtime).
 */
export function getDefaultMlxModel(): string | null {
	return process.env.FUSION_MLX_MODEL || null;
}

// ─── Anthropic SDK Fetch Adapter ───────────────────────────────

/**
 * Creates an Anthropic SDK-compatible fetch function.
 * Proxies Anthropic Messages API requests to fusion-mlx's /v1/chat/completions.
 *
 * This lets upper-layer code keep using the Anthropic SDK interface,
 * while the actual AI inference happens locally in fusion-mlx.
 */
// Capture original global fetch before Anthropic SDK replaces it
let _originalFetch: typeof globalThis.fetch | null = null;
function getOriginalFetch(): typeof globalThis.fetch {
	if (!_originalFetch) _originalFetch = globalThis.fetch;
	return _originalFetch;
}
export function _resetOriginalFetch(): void {
	_originalFetch = null;
}

// Test seam: reset module-global circuit breaker (P3-1 test isolates from
// prior connection-failure tests opening the breaker).
export function _resetMlxCircuitBreaker(): void {
	mlxApiCircuit.reset();
}

// Test seam: reset base URL cache (PERF-4) so env changes in tests are honored
// after a prior test already warmed the cache with a different URL.
export function _resetMlxBaseUrl(): void {
	_cachedMlxBaseUrl = null;
	_cachedMlxBaseUrlSource = "default";
}

export function createFusionMlxFetch(model: string): typeof globalThis.fetch {
	// Let getOriginalFetch() lazy-init so tests can mock globalThis.fetch
	// before the first actual call. The eager assignment would cache the
	// real fetch before spyOn takes effect.
	const fn = async (
		input: RequestInfo | URL,
		init?: RequestInit,
	): Promise<Response> => {
		const url = input instanceof Request ? input.url : String(input);
		const baseUrl = getMlxBaseUrl();

		// count_tokens request: forwarded to fusion-mlx /v1/messages/count_tokens for exact counting (no generation)
		// fusion-mlx counts with the loaded engine tokenizer + the same /v1/messages chat template (F12); claude- aliases pass through
		if (url.includes("/v1/messages/count_tokens")) {
			let countBody: Record<string, unknown> = {};
			if (init?.body) {
				try {
					countBody = JSON.parse(init.body as string);
				} catch (e) {
					logForDebugging(
						`[Fusion-MLX] count_tokens body parse failed: ${(e as Error).message}`,
					);
					return new Response(JSON.stringify({ input_tokens: 0 }), {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
			}
			try {
				// Pass the Anthropic body through: the fusion-mlx count_tokens endpoint uses Anthropic format + the loaded model tokenizer
				const resp = await mlxFetchWithRetry(
					`${baseUrl}/v1/messages/count_tokens`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(countBody),
						signal: init?.signal || AbortSignal.timeout(getMlxTimeout(false)),
					},
				);
				if (resp.ok) {
					const data = (await resp.json()) as { input_tokens?: number };
					logForDebugging(
						`[Fusion-MLX] count_tokens: ${data.input_tokens ?? JSON.stringify(data)}`,
					);
					if (typeof data.input_tokens === "number") {
						return new Response(
							JSON.stringify({ input_tokens: data.input_tokens }),
							{
								status: 200,
								headers: { "content-type": "application/json" },
							},
						);
					}
				}
				// errText // unused
				// const errText = await resp.text().catch(() => "");
				logForDebugging(
					`[Fusion-MLX] count_tokens endpoint failed (${resp.status}), trying chat completions`,
				);
			} catch (e) {
				logForDebugging(
					`[Fusion-MLX] count_tokens endpoint error: ${(e as Error).message}`,
				);
			}
			// fallback 1: /v1/chat/completions with max_tokens=1 to get usage.prompt_tokens (exact, has prefill overhead)
			try {
				const mlxMessages = anthropicToMlxMessages(
					(countBody.messages as Array<{
						role: string;
						content: string | Array<Record<string, unknown>>;
					}>) || [],
					countBody.system as
						| string
						| Array<Record<string, unknown>>
						| undefined,
				);
				const toolsForMlx =
					(countBody.tools as Array<Record<string, unknown>> | undefined)
						?.length > 0
						? anthropicToMlxTools(
								countBody.tools as Array<{
									name: string;
									description: string;
									input_schema: Record<string, unknown>;
								}>,
							) // log: assert tool shape for anthropicToMlxTools
						: undefined;
				const chatResp = await mlxFetchWithRetry(
					`${baseUrl}/v1/chat/completions`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							model,
							messages: mlxMessages,
							max_tokens: 1,
							stream: false,
							...(toolsForMlx ? { tools: toolsForMlx } : {}),
						}),
						signal: init?.signal || AbortSignal.timeout(getMlxTimeout(false)),
					},
				);
				if (chatResp.ok) {
					const chatData = (await chatResp.json()) as {
						usage?: { prompt_tokens?: number };
					};
					const promptTokens = chatData.usage?.prompt_tokens;
					if (typeof promptTokens === "number") {
						logForDebugging(
							`[Fusion-MLX] count_tokens via chat completions: ${promptTokens}`,
						);
						return new Response(
							JSON.stringify({ input_tokens: promptTokens }),
							{
								status: 200,
								headers: { "content-type": "application/json" },
							},
						);
					}
				}
				logForDebugging(
					`[Fusion-MLX] count_tokens chat completions failed (${chatResp.status})`,
				);
			} catch (e) {
				logForDebugging(
					`[Fusion-MLX] count_tokens chat completions error: ${(e as Error).message}`,
				);
			}
			// fallback 2: bytes/4 estimate (final backstop, keeps token budget tracking usable)
			const estInput = Math.ceil(
				JSON.stringify(countBody.messages ?? []).length / 4,
			);
			logForDebugging(
				`[Fusion-MLX] count_tokens fallback bytes/4: ${estInput}`,
			);
			return new Response(JSON.stringify({ input_tokens: estInput }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}

		// Intercept /v1/messages requests (Anthropic Messages API)
		if (url.includes("/v1/messages")) {
			let body: Record<string, unknown> = {};
			if (init?.body) {
				try {
					body = JSON.parse(init.body as string);
				} catch (e) {
					console.error(
						"[Fusion-MLX] Failed to parse request body:",
						(e as Error).message,
					);
					return new Response(
						JSON.stringify({ error: "Invalid request body" }),
						{
							status: 400,
							headers: { "Content-Type": "application/json" },
						},
					);
				}
			}

			// Convert Anthropic format into MLX format
			const mlxMessages = anthropicToMlxMessages(
				(body.messages as Array<{
					role: string;
					content: string | Array<Record<string, unknown>>;
				}>) || [],
				body.system as string | Array<Record<string, unknown>> | undefined,
			);

			// MLX mode: always override with the adapter model, ignoring the model the SDK passed (may be a cloud model name like claude-sonnet-*)
			const resolvedModel = model;
			// Auto-detect image/video models → switch to the recommended code model
			const imageModelKeywords = [
				"flux",
				"skyreels",
				"image",
				"video",
				"ltx",
				"a2v",
				"v2v",
				"r2v",
				"klein",
				"txt2vid",
				"img2vid",
				"tts",
				"whisper",
			];
			const isImageModel = imageModelKeywords.some((k) =>
				resolvedModel.toLowerCase().includes(k),
			);
			const finalModel = isImageModel
				? (await getRecommendedCodeModel()) || resolvedModel
				: resolvedModel;
			// #224: no auto-injected response_format when tools are present.
			// The injected json_schema forced every turn (incl. the final answer)
			// into {"thinking","call"} content that nothing parsed back into
			// tool_use — the agentic loop never executed a tool. Native
			// tool_calls (engine grammar) is the supported path; caller-provided
			// body.response_format still passes through below.
			const caps = await getMlxModelCapabilities(finalModel);
			logForDebugging(
				`[Fusion-MLX] native tool_calls path: tools=${(body.tools as Array<Record<string, unknown>> | undefined)?.length ?? 0} response_format=${body.response_format ? "caller-provided" : "none"}`,
			);
			const toolsForMlx =
				(body.tools as Array<Record<string, unknown>> | undefined)?.length > 0
					? anthropicToMlxTools(
							body.tools as Array<{
								name: string;
								description: string;
								input_schema: Record<string, unknown>;
							}>,
						)
					: undefined; // log: assert tool shape

			const inferenceParams = getModelInferenceParams(finalModel);

			const mlxBody: MLXChatCompletionRequest = {
				model: toMlxModelName(finalModel),
				messages: mlxMessages,
				temperature:
					(body.temperature as number) ?? inferenceParams.temperature, // log: cast unknown to number
				top_p: inferenceParams.top_p,
				...(inferenceParams.repetition_penalty
					? { repetition_penalty: inferenceParams.repetition_penalty }
					: {}),
				stream: body.stream === true,
				...(toolsForMlx ? { tools: toolsForMlx } : {}),
				...convertToolChoice(body.tool_choice),
				// Qwen3 thinking mode: prefer the request's thinking parameter (/think toggle), otherwise fall back to the model heuristic (27B+ auto-enabled)
				...((body.thinking as { type?: string } | undefined)?.type
					? {
							enable_thinking:
								(body.thinking as { type: string }).type === "enabled",
						}
					: inferenceParams.enable_thinking !== undefined
						? { enable_thinking: inferenceParams.enable_thinking }
						: {}),
				// max_tokens: use the value from the caller, default 8192
				// No artificial cap — let the model and context window decide
				max_tokens: (body.max_tokens as number) || 8192, // log: cast unknown to number
				// Structured output: auto-injected or caller-provided
				...((body.response_format as MLXChatCompletionRequest["response_format"])
					? {
							response_format:
								body.response_format as MLXChatCompletionRequest["response_format"],
						}
					: {}),
			};

			// Call fusion-mlx with retry support
			// item 15(a): let — when the OOM gc-retry succeeds, reassign and turn into the OK path, avoiding duplicated conversion logic
			let mlxResponse = await mlxFetchWithRetry(
				`${baseUrl}/v1/chat/completions`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify(mlxBody),
					signal:
						init?.signal || AbortSignal.timeout(getMlxTimeout(mlxBody.stream)),
				},
			);

			if (!mlxResponse.ok) {
				// Return an Anthropic SDK-compatible error format
				const errorBody = await mlxResponse.text();
				// Forward the Retry-After header so upper-layer withRetry backs off precisely (429 and other rate-limit scenarios)
				const errorHeaders: Record<string, string> = {
					"content-type": "application/json",
				};
				const retryAfter = mlxResponse.headers.get("retry-after");
				if (retryAfter) errorHeaders["retry-after"] = retryAfter;
				// item 15(a) MLX OOM auto-recovery: memory_guard hitting the ceiling used to be a deterministic failure
				// (retrying with the same context OOMs again) → flagged x-should-retry:false and gave up immediately. But if
				// a gc first frees VRAM, the same context may fit → gc + resend once; on success turn into the existing OK path
				// (streaming/non-streaming branches reused as-is), on failure fall back to the existing x-should-retry:false error.
				// Like the existing truncate-retry (non-streaming max_tokens escalation :1710), this is adapter-layer
				// pass-through recovery, triggered only in the "same-context OOM = direct failure today" case, not touching
				// higher-level truncate/compact/circuit-breaker paths (no conflict). requestMlxGC / mlxFetchWithRetry
				// already exist in this file (:604 / :372), mirroring the existing retry pattern. Retry once, no loop.
				if (
					errorBody.includes("memory limit exceeded") ||
					errorBody.includes("Reduce context size")
				) {
					logForDebugging(
						`[Fusion-MLX] memory_guard ceiling hit (status ${mlxResponse.status}), attempting gc + retry`,
						{ level: "warn" },
					);
					const gcResult = await requestMlxGC();
					if (gcResult.success) {
						try {
							const retryResp = await mlxFetchWithRetry(
								`${baseUrl}/v1/chat/completions`,
								{
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify(mlxBody),
									signal:
										init?.signal ||
										AbortSignal.timeout(getMlxTimeout(mlxBody.stream)),
								},
							);
							if (retryResp.ok) {
								logForDebugging(
									`[Fusion-MLX] OOM gc-retry succeeded (gc freed ${gcResult.freed ?? "unknown"} bytes), switching to the normal response path`,
								);
								mlxResponse = retryResp;
							} else {
								logForDebugging(
									`[Fusion-MLX] OOM gc-retry still failing (status ${retryResp.status}), fallback x-should-retry:false`,
									{ level: "warn" },
								);
							}
						} catch (retryErr) {
							logForDebugging(
								`[Fusion-MLX] OOM gc-retry exception: ${(retryErr as Error).message}, fallback x-should-retry:false`,
								{ level: "warn" },
							);
						}
					} else {
						logForDebugging(
							`[Fusion-MLX] gc failed (${gcResult.error ?? "unknown"}), fallback x-should-retry:false`,
							{ level: "warn" },
						);
					}
				}
				// gc-retry did not recover → return the existing x-should-retry:false error (prevents futile retry spinning)
				if (!mlxResponse.ok) {
					if (
						errorBody.includes("memory limit exceeded") ||
						errorBody.includes("Reduce context size")
					) {
						errorHeaders["x-should-retry"] = "false";
					}
					return new Response(
						JSON.stringify({
							type: "error",
							error: {
								type: "api_error",
								message: `Fusion-MLX error: ${mlxResponse.status} - ${errorBody}`,
							},
						}),
						{
							status: mlxResponse.status,
							headers: errorHeaders,
						},
					);
				}
			}

			if (body.stream) {
				// Streaming response: convert the MLX SSE stream into an Anthropic SSE stream
				// MLX streaming's first chunk carries no usage; estimate input_tokens as bytes/4 to fill message_start (B task will later improve this to exact counting)
				const inputTokensEst = Math.ceil(
					JSON.stringify(mlxBody.messages).length / 4,
				);
				logForDebugging(
					`[Fusion-MLX] Stream message_start input_tokens estimate: ${inputTokensEst}`,
				);

				// resume awareness: env on + gateway response carries X-Fusion-Stream-ID →
				//   ① teeCursor side-channels id:<sid>:<seq> before the transform → cursorRef
				//   ② stateRef lets the transform attach the live StreamState (deep-cloned to seed continuation on disconnect)
				//   ③ attachResumeRefs attaches to the OUTPUT Response (the encodeStreamToAnthropicSSE return value),
				//      because claude.ts holds streamResponse = that OUTPUT (WeakMap key = the Response object).
				//   off → no wrap/refs, transform takes 3 args, byte-identical original behavior.
				const resumeOn = isStreamResumeEnabled();
				const sid = resumeOn
					? mlxResponse.headers.get("x-fusion-stream-id") || ""
					: "";

				let transformResponse: Response = mlxResponse;
				let cursorRef: { current: string } | undefined;
				let stateRef: StateRef | undefined;
				if (resumeOn && sid && mlxResponse.body) {
					const tee = teeCursor(mlxResponse.body);
					cursorRef = tee.ref;
					stateRef = { current: undefined };
					// transform reads .body → hand it the teed stream (side-channel lifts the id, frames pass through unchanged).
					transformResponse = new Response(tee.stream, {
						status: mlxResponse.status,
						headers: mlxResponse.headers,
					});
				}

				let anthropicStream: AsyncGenerator<AnthropicStreamEvent>;
				if (resumeOn && sid) {
					// Silent-stream retry skipped on the resume path: a re-issued
					// request gets a new stream id and would invalidate the
					// cursor/state side-channels wired to this response.
					anthropicStream = transformMLXStreamToAnthropic(
						transformResponse,
						model,
						inputTokensEst,
						undefined,
						stateRef,
					);
				} else {
					let reusedFirstResponse = true;
					const makeStreamAttempt = async function* () {
						let resp = mlxResponse;
						if (!reusedFirstResponse) {
							resp = await mlxFetchWithRetry(
								`${baseUrl}/v1/chat/completions`,
								{
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify(mlxBody),
									signal:
										init?.signal ||
										AbortSignal.timeout(getMlxTimeout(mlxBody.stream)),
								},
							);
							if (!resp.ok) {
								const errorText = await resp.text();
								throw new Error(
									`Fusion-MLX error: ${resp.status} - ${errorText}`,
								);
							}
						}
						reusedFirstResponse = false;
						yield* transformMLXStreamToAnthropic(resp, model, inputTokensEst);
					};
					anthropicStream = withSilentStreamRetry(makeStreamAttempt);
				}
				const { encodeStreamToAnthropicSSE } = await import(
					"./fusion-mlx-stream.js"
				);
				const output = await encodeStreamToAnthropicSSE(
					anthropicStream,
					mlxResponse,
				);
				if (cursorRef && stateRef && sid) {
					attachResumeRefs(output, {
						cursorRef,
						stateRef,
						sid,
						baseUrl: getMlxBaseUrl(),
						authHeaders: getMlxAuthHeaders(),
					});
				}
				return output;
			}

			// Non-streaming response — max_tokens escalation on truncation
			const data = (await mlxResponse.json()) as MLXChatCompletionResponse;
			const finishReason = data.choices?.[0]?.finish_reason;
			const currentMaxTokens = mlxBody.max_tokens;

			if (finishReason === "length" && currentMaxTokens) {
				const escalatedMaxTokens = Math.min(
					currentMaxTokens * MLX_MAX_TOKENS_ESCALATION_FACTOR,
					caps.maxOutputTokens,
				);
				if (escalatedMaxTokens > currentMaxTokens) {
					logForDebugging(
						`[Fusion-MLX] max_tokens hit (${currentMaxTokens}), escalating to ${escalatedMaxTokens}`,
					);
					const escalatedBody = { ...mlxBody, max_tokens: escalatedMaxTokens };
					try {
						const retryResp = await mlxFetchWithRetry(
							`${baseUrl}/v1/chat/completions`,
							{
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify(escalatedBody),
								signal:
									init?.signal || AbortSignal.timeout(getMlxTimeout(false)),
							},
						);
						if (retryResp.ok) {
							const retryData =
								(await retryResp.json()) as MLXChatCompletionResponse;
							const retryAnthropic = transformMLXResponseToAnthropic(retryData);
							return new Response(JSON.stringify(retryAnthropic), {
								status: 200,
								headers: { "content-type": "application/json" },
							});
						}
						logForDebugging(
							`[Fusion-MLX] Escalation retry failed (${retryResp.status}), returning original`,
						);
					} catch (retryErr) {
						logForDebugging(
							`[Fusion-MLX] Escalation retry error: ${(retryErr as Error).message}`,
						);
					}
				}
			}

			const anthropicResponse = transformMLXResponseToAnthropic(data);
			return new Response(JSON.stringify(anthropicResponse), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}

		// Non-/v1/messages requests pass through (e.g. model list, key detection).
		// P3-4 (audit 0901): do not log the raw url — the query may contain sensitive params (key/token); avoid stderr leakage.
		return getOriginalFetch()(input, init);
	};
	return fn as typeof globalThis.fetch;
}

/**
 * Converts the Anthropic tool_choice format into the MLX/OpenAI-compatible format.
 * Anthropic: {type: 'auto' | 'any' | 'tool', name?: string}
 * OpenAI:   'auto' | 'any' | 'none' | {type: 'function', function: {name: string}}
 */
function convertToolChoice(toolChoice: unknown): Record<string, unknown> {
	if (!toolChoice || typeof toolChoice !== "object") return {};
	const tc = toolChoice as Record<string, unknown>;
	const type = tc.type as string | undefined;

	if (type === "auto" || type === "any") {
		return { tool_choice: type };
	}
	if (type === "tool" && tc.name) {
		return {
			tool_choice: { type: "function", function: { name: tc.name } },
		};
	}
	return {};
}
