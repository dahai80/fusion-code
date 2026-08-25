// fusion-executor instance — state machine wrapping ExecutorClient.
// Mirror LSPServerInstance.ts: stopped→starting→running→stopping→error,
// crash-recovery cap (maxRestarts=3), lazy-require, health gate before requests.
// Executor has no LSP initialize handshake — start() then health() probe.

import { logForDebugging } from "../../utils/debug.js";
import { errorMessage } from "../../utils/errors.js";
import { logError } from "../../utils/log.js";
import { sleep } from "../../utils/sleep.js";
import type { ExecutorClient, ExecutorHealth } from "./ExecutorClient.js";
import type {
	ExecutionRequest,
	ExecutionResult,
	ExecutorStreamChunk,
} from "./types.js";

export type ExecutorState =
	| "stopped"
	| "starting"
	| "running"
	| "stopping"
	| "error";

export type ExecutorInstance = {
	readonly state: ExecutorState;
	readonly isHealthy: boolean;
	start: () => Promise<void>;
	stop: () => Promise<void>;
	restart: () => Promise<void>;
	execute: (req: ExecutionRequest) => Promise<ExecutionResult>;
	executeStream: (
		req: ExecutionRequest,
		onChunk: (chunk: ExecutorStreamChunk) => void,
		signal?: AbortSignal,
	) => Promise<ExecutionResult>;
	health: () => Promise<ExecutorHealth>;
};

const MAX_CRASH_RECOVERY = 3;
// Retry transient errors (socket glitch mid-flight) with exponential backoff.
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 100;

export function createExecutorInstance(name: string): ExecutorInstance {
	// Lazy-require ExecutorClient so the module graph (spawn/net/fs) only loads
	// when an instance is actually created, not when the static import chain
	// reaches this module — mirrors LSPServerInstance lazy-require of LSPClient.
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const { createExecutorClient } = require("./ExecutorClient.js") as {
		createExecutorClient: (onCrash?: (error: Error) => void) => ExecutorClient;
	};

	let state: ExecutorState = "stopped";
	let lastError: Error | undefined;
	let crashRecoveryCount = 0;

	const client = createExecutorClient((error: Error) => {
		state = "error";
		lastError = error;
		crashRecoveryCount++;
		logForDebugging(
			`executor '${name}' crash → error (recovery #${crashRecoveryCount})`,
		);
	});

	async function start(): Promise<void> {
		if (state === "running" || state === "starting") return;
		if (state === "error" && crashRecoveryCount > MAX_CRASH_RECOVERY) {
			const error = new Error(
				`executor '${name}' exceeded max crash recovery attempts (${MAX_CRASH_RECOVERY})`,
			);
			lastError = error;
			logError(error);
			throw error;
		}
		try {
			state = "starting";
			logForDebugging(`Starting executor instance: ${name}`);
			await client.start();
			// Probe health to confirm the server is ready (no LSP init handshake).
			const h = await client.health();
			if (!h.ok) {
				throw new Error(
					`executor '${name}' health check failed: ${JSON.stringify(h)}`,
				);
			}
			state = "running";
			crashRecoveryCount = 0;
			logForDebugging(
				`executor instance started: ${name} (version=${h.version ?? "unknown"})`,
			);
		} catch (error) {
			await client.stop().catch(() => {});
			state = "error";
			lastError = error as Error;
			logError(error);
			throw error;
		}
	}

	async function stop(): Promise<void> {
		if (state === "stopped" || state === "stopping") return;
		try {
			state = "stopping";
			await client.stop();
			state = "stopped";
			logForDebugging(`executor instance stopped: ${name}`);
		} catch (error) {
			state = "error";
			lastError = error as Error;
			logError(error);
			throw error;
		}
	}

	async function restart(): Promise<void> {
		try {
			await stop();
		} catch (error) {
			logError(
				new Error(
					`executor '${name}' stop during restart failed: ${errorMessage(error)}`,
				),
			);
			// Continue to start anyway — stop failure shouldn't block recovery.
		}
		try {
			await start();
		} catch (error) {
			const startError = new Error(
				`executor '${name}' restart start failed: ${errorMessage(error)}`,
			);
			logError(startError);
			throw startError;
		}
	}

	function isHealthyFn(): boolean {
		return state === "running" && client.isRunning;
	}

	async function ensureStarted(): Promise<void> {
		if (isHealthyFn()) return;
		if (state === "error") {
			// Crash-recovery: restart transparently on next use.
			await restart();
			return;
		}
		await start();
	}

	async function execute(req: ExecutionRequest): Promise<ExecutionResult> {
		await ensureStarted();
		if (!isHealthyFn()) {
			const error = new Error(
				`executor '${name}' not healthy (state=${state})` +
					(lastError ? `, last error: ${lastError.message}` : ""),
			);
			logError(error);
			throw error;
		}
		let lastAttemptError: Error | undefined;
		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			try {
				return await client.execute(req);
			} catch (error) {
				lastAttemptError = error as Error;
				if (attempt < MAX_RETRIES) {
					const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
					logForDebugging(
						`executor '${name}' execute failed, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES}): ${errorMessage(error)}`,
					);
					await sleep(delay);
					continue;
				}
				break;
			}
		}
		const wrapped = new Error(
			`executor '${name}' execute failed: ${lastAttemptError?.message ?? "unknown"}`,
		);
		logError(wrapped);
		throw wrapped;
	}

	async function executeStream(
		req: ExecutionRequest,
		onChunk: (chunk: ExecutorStreamChunk) => void,
		signal?: AbortSignal,
	): Promise<ExecutionResult> {
		await ensureStarted();
		if (!isHealthyFn()) {
			const error = new Error(
				`executor '${name}' not healthy for stream (state=${state})`,
			);
			logError(error);
			throw error;
		}
		// No retry for streams — mid-stream retry would duplicate output. Fail loud.
		return client.executeStream(req, onChunk, signal);
	}

	async function health(): Promise<ExecutorHealth> {
		if (!client.isRunning) {
			return { ok: false };
		}
		return client.health();
	}

	return {
		get state(): ExecutorState {
			return state;
		},
		get isHealthy(): boolean {
			return isHealthyFn();
		},
		start,
		stop,
		restart,
		execute,
		executeStream,
		health,
	};
}
