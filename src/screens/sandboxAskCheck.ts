// audit 1.1.1 slice #49: sandbox network permission ask useCallback body extracted (INLINE-CALLBACK curried-factory, like #46 applyRemoteInit).
// REPL() SandboxManager callback: after receiving hostPattern, decides whether to allow the network connection.
// swarm-worker path: generateSandboxRequestId → sendSandboxPermissionRequestViaMailbox to the leader; sent=false falls back to the local queue; sent=true registerSandboxPermissionCallback + setAppState pending indicator.
// non-worker path: local dialog queue + (BRIDGE_MODE) REPL bridge race — if the bridge onResponse arrives first, resolve all same-host requests + clear sibling subscriptions; if the local one arrives first, cleanup cancels the bridge.
// Original useCallback body. setAppState + store (deps) + setSandboxPermissionRequestQueue + sandboxBridgeCleanupRef (stable refs, omitted from deps) passed via ctx (closure capture), byte-equivalent behavior.
// The useCallback() hook stays as a REPL thin shell (hook rules, cannot move to a plain helper); only the callback body moves out (curried factory returns an async fn, REPL useCallback wraps it once more and passes it through).
// 8 module imports imported directly (not REPL state, per imported-helpers-directly rule; all used multiple times in REPL, REPL imports not removed):
//   isAgentSwarmsEnabled (utils/agentSwarmsEnabled) / generateSandboxRequestId + isSwarmWorker + sendSandboxPermissionRequestViaMailbox (utils/swarm/permissionSync) /
//   registerSandboxPermissionCallback (hooks/useSwarmPermissionPoller).
// No JSX → .ts. Returns Promise<boolean> (SandboxAskCallback signature: (hostPattern) => Promise<boolean>).
// deps [setAppState, store] unchanged (setSandboxPermissionRequestQueue useState setter + sandboxBridgeCleanupRef ref are stable, safe to omit, matching the original).

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { registerSandboxPermissionCallback } from "../hooks/useSwarmPermissionPoller.js";
import type { AppStateStore } from "../state/AppStateStore.js";
import { isAgentSwarmsEnabled } from "../utils/agentSwarmsEnabled.js";
import type {
	NetworkHostPattern,
	SandboxAskCallback,
} from "../utils/sandbox/sandbox-adapter.js";
import {
	generateSandboxRequestId,
	isSwarmWorker,
	sendSandboxPermissionRequestViaMailbox,
} from "../utils/swarm/permissionSync.js";

type SandboxPermissionQueueItem = {
	hostPattern: NetworkHostPattern;
	resolvePromise: (allowConnection: boolean) => void;
};

type SandboxAskCheckCtx = {
	setAppState: AppStateStore["setState"];
	store: AppStateStore;
	setSandboxPermissionRequestQueue: Dispatch<
		SetStateAction<Array<SandboxPermissionQueueItem>>
	>;
	sandboxBridgeCleanupRef: MutableRefObject<Map<string, Array<() => void>>>;
};

// REPL keeps the useCallback thin shell:
//   const sandboxAskCallback: SandboxAskCallback = useCallback(
//     (hostPattern: NetworkHostPattern) => createSandboxAskHandler({ setAppState, store, setSandboxPermissionRequestQueue, sandboxBridgeCleanupRef })(hostPattern),
//     [setAppState, store],
//   );
export function createSandboxAskHandler(
	ctx: SandboxAskCheckCtx,
): SandboxAskCallback {
	return async (hostPattern: NetworkHostPattern) => {
		// If running as a swarm worker, forward the request to the leader via mailbox
		if (isAgentSwarmsEnabled() && isSwarmWorker()) {
			const requestId = generateSandboxRequestId();

			// Send the request to the leader via mailbox
			const sent = await sendSandboxPermissionRequestViaMailbox(
				hostPattern.host,
				requestId,
			);
			return new Promise((resolveShouldAllowHost) => {
				if (!sent) {
					// If we couldn't send via mailbox, fall back to local handling
					ctx.setSandboxPermissionRequestQueue((prev) => [
						...prev,
						{
							hostPattern,
							resolvePromise: resolveShouldAllowHost,
						},
					]);
					return;
				}

				// Register the callback for when the leader responds
				registerSandboxPermissionCallback({
					requestId,
					host: hostPattern.host,
					resolve: resolveShouldAllowHost,
				});

				// Update AppState to show pending indicator
				ctx.setAppState((prev) => ({
					...prev,
					pendingSandboxRequest: {
						requestId,
						host: hostPattern.host,
					},
				}));
			});
		}

		// Normal flow for non-workers: show local UI and optionally race
		// against the REPL bridge (Remote Control) if connected.
		return new Promise((resolveShouldAllowHost) => {
			let resolved = false;
			function resolveOnce(allow: boolean): void {
				if (resolved) return;
				resolved = true;
				resolveShouldAllowHost(allow);
			}

			// Queue the local sandbox permission dialog
			ctx.setSandboxPermissionRequestQueue((prev) => [
				...prev,
				{
					hostPattern,
					resolvePromise: resolveOnce,
				},
			]);
		});
	};
}
