// fusion-executor manager — module-scope singleton + generation counter +
// race-safe initPromise. Mirror lsp/manager.ts. Gate on
// FUSION_CODE_EXECUTOR_ENABLED (default off → byte-identical, init no-op).
// registerCleanup on init so process exit stops the executor subprocess.

import { registerCleanup } from "../../utils/cleanupRegistry.js";
import { logForDebugging } from "../../utils/debug.js";
import { isEnvTruthy } from "../../utils/envUtils.js";
import { errorMessage } from "../../utils/errors.js";
import { logError } from "../../utils/log.js";
import {
	createExecutorInstance,
	type ExecutorInstance,
} from "./ExecutorInstance.js";

type InitializationState = "not-started" | "pending" | "success" | "failed";

let executorInstance: ExecutorInstance | undefined;
let initializationState: InitializationState = "not-started";
let initializationGeneration = 0;
let initializationPromise: Promise<void> | undefined;
let cleanupRegistered = false;

export function _resetExecutorManagerForTesting(): void {
	if (executorInstance) {
		void executorInstance.stop().catch(() => {});
	}
	executorInstance = undefined;
	initializationState = "not-started";
	initializationPromise = undefined;
	initializationGeneration++;
}

// Returns undefined if not initialized / failed / still pending → callers fail-open.
export function getExecutorClient(): ExecutorInstance | undefined {
	if (initializationState === "failed") return undefined;
	if (initializationState !== "success") return undefined;
	return executorInstance;
}

export function getInitializationStatus(): InitializationState {
	return initializationState;
}

export function isExecutorConnected(): boolean {
	return initializationState === "success" && !!executorInstance?.isHealthy;
}

export async function waitForInitialization(): Promise<void> {
	if (initializationPromise) {
		await initializationPromise;
	}
}

export function isExecutorEnabled(): boolean {
	return isEnvTruthy(process.env.FUSION_CODE_EXECUTOR_ENABLED);
}

// Initialize the executor subprocess. No-op when the gate env is unset
// (byte-identical disabled path). Idempotent; retries on prior failure.
export function initializeExecutorManager(): void {
	if (!isExecutorEnabled()) {
		return;
	}
	logForDebugging("[EXECUTOR MANAGER] initializeExecutorManager() called");

	if (executorInstance !== undefined && initializationState !== "failed") {
		logForDebugging(
			"[EXECUTOR MANAGER] Already initialized or initializing, skipping",
		);
		return;
	}

	if (initializationState === "failed") {
		executorInstance = undefined;
	}

	executorInstance = createExecutorInstance("fusion-executor");
	initializationState = "pending";
	const currentGeneration = ++initializationGeneration;
	logForDebugging(
		`[EXECUTOR MANAGER] starting async init (generation ${currentGeneration})`,
	);

	initializationPromise = executorInstance
		.start()
		.then(() => {
			if (currentGeneration === initializationGeneration) {
				initializationState = "success";
				logForDebugging("executor manager initialized successfully");
				if (!cleanupRegistered) {
					registerCleanup(() => shutdownExecutorManager());
					cleanupRegistered = true;
				}
			}
		})
		.catch((error: unknown) => {
			if (currentGeneration === initializationGeneration) {
				initializationState = "failed";
				executorInstance = undefined;
				logError(error as Error);
				logForDebugging(
					`Failed to initialize executor manager: ${errorMessage(error)}`,
				);
			}
		});
}

export async function shutdownExecutorManager(): Promise<void> {
	if (executorInstance === undefined) {
		return;
	}
	try {
		await executorInstance.stop();
		logForDebugging("executor manager shut down successfully");
	} catch (error: unknown) {
		logError(error as Error);
		logForDebugging(
			`Failed to shutdown executor manager: ${errorMessage(error)}`,
		);
	} finally {
		executorInstance = undefined;
		initializationState = "not-started";
		initializationPromise = undefined;
		initializationGeneration++;
	}
}
