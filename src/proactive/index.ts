/**
 * Proactive Mode — proactive mode
 *
 * In proactive mode, the AI model takes action on its own without waiting for user instructions.
 * The system periodically sends <tick> prompts and the AI can autonomously decide what to do.
 * SleepTool is used to sleep when there is nothing to do.
 *
 * Main features:
 * - Proactive mode activation/deactivation
 * - Tick scheduling
 * - Pause/resume
 * - System prompt extension
 *
 * gated by feature('PROACTIVE') or feature('KAIROS')
 */

import { feature } from "bun:bundle";
import { logForDebugging } from "../utils/debug.js";
import { isEnvTruthy } from "../utils/envUtils.js";

let _proactiveActive = false;
let _proactivePaused = false;
let _activationSource: string | undefined;
let _tickInterval: ReturnType<typeof setInterval> | undefined;
let _lastTickAt: number | null = null;

/**
 * Check if proactive mode is currently active.
 */
export function isProactiveActive(): boolean {
	if (!(feature("PROACTIVE") || feature("KAIROS"))) return false;
	return _proactiveActive;
}

/**
 * Check if proactive mode is paused.
 * When paused, ticks are suppressed but the mode remains active.
 */
export function isProactivePaused(): boolean {
	return _proactivePaused;
}

/**
 * Activate proactive mode.
 * @param source The source of activation: 'command', 'env', 'startup'
 */
export function activateProactive(source: string = "command"): void {
	if (!(feature("PROACTIVE") || feature("KAIROS"))) return;

	_proactiveActive = true;
	_proactivePaused = false;
	_activationSource = source;
	_lastTickAt = Date.now();

	logForDebugging(`[Proactive] Activated from: ${source}`);

	// Start sending ticks
	startTickScheduler();
}

/**
 * Deactivate proactive mode.
 */
export function deactivateProactive(): void {
	_proactiveActive = false;
	_proactivePaused = false;
	_activationSource = undefined;

	stopTickScheduler();
	logForDebugging("[Proactive] Deactivated");
}

/**
 * Pause proactive mode temporarily.
 */
export function pauseProactive(): void {
	_proactivePaused = true;
	stopTickScheduler();
	logForDebugging("[Proactive] Paused");
}

/**
 * Resume proactive mode after pause.
 */
export function resumeProactive(): void {
	if (!_proactiveActive) return;
	_proactivePaused = false;
	_lastTickAt = Date.now();
	startTickScheduler();
	logForDebugging("[Proactive] Resumed");
}

/**
 * Get the proactive system prompt section.
 * Appended to the base system prompt when proactive is active.
 */
export function getProactiveSection(): string | null {
	if (!isProactiveActive()) return null;

	return `# Autonomous work

You are in proactive mode. Take initiative — explore, act, and make progress without waiting for instructions.

Start by briefly greeting the user.

You will receive periodic <tick> prompts. These are check-ins. Do whatever seems most useful, or call Sleep if there's nothing to do.`;
}

/**
 * Check if FUSION_CODE_PROACTIVE env var is set and trigger activation.
 * Called during startup to auto-activate proactive mode.
 */
export function maybeActivateFromEnv(): void {
	if (_proactiveActive) return;
	if (isEnvTruthy(process.env.FUSION_CODE_PROACTIVE)) {
		activateProactive("env");
	}
}

/**
 * Record the last tick time.
 */
export function recordTick(): void {
	_lastTickAt = Date.now();
}

/**
 * Get the time since the last tick in ms.
 */
export function timeSinceLastTick(): number {
	if (!_lastTickAt) return Infinity;
	return Date.now() - _lastTickAt;
}

/**
 * Get the tick interval in ms.
 * Default: 30000ms (30 seconds), configurable via env var.
 */
export function getTickIntervalMs(): number {
	return parseInt(
		process.env.FUSION_CODE_PROACTIVE_TICK_INTERVAL || "30000",
		10,
	);
}

/**
 * Get the activation source.
 */
export function getActivationSource(): string | undefined {
	return _activationSource;
}

/**
 * Get the proactive state for debugging.
 */
export function getProactiveState(): {
	active: boolean;
	paused: boolean;
	source: string | undefined;
	lastTickAt: number | null;
	tickIntervalMs: number;
} {
	return {
		active: _proactiveActive,
		paused: _proactivePaused,
		source: _activationSource,
		lastTickAt: _lastTickAt,
		tickIntervalMs: getTickIntervalMs(),
	};
}

// ─── Internal ───────────────────────────────────────────────

function startTickScheduler(): void {
	stopTickScheduler();
	const intervalMs = getTickIntervalMs();
	_tickInterval = setInterval(() => {
		if (_proactiveActive && !_proactivePaused) {
			_lastTickAt = Date.now();
			logForDebugging("[Proactive] Tick");
		}
	}, intervalMs);
	if (_tickInterval) {
		_tickInterval.unref();
	}
}

function stopTickScheduler(): void {
	if (_tickInterval) {
		clearInterval(_tickInterval);
		_tickInterval = undefined;
	}
}
