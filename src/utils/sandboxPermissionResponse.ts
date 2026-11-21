// audit 1.1.1: pure routing extracted from REPL.tsx SandboxPermissionRequest.onUserResponse.
// Two helpers (local + worker branches), each with no React hooks, no JSX, no await.
// handleLocalSandboxUserResponse: REPL.tsx local branch (behavior-equivalent to 5675-5734).
//   1) (persistToSettings) setAppState toolPermissionContext + persistPermissionUpdate + SandboxManager.refreshConfig
//   2) setSandboxPermissionRequestQueue resolves all same-host pending + filters
//   3) sandboxBridgeCleanupRef cleans up bridge subscriptions + deletes the key
// handleWorkerSandboxUserResponse: REPL.tsx worker branch (mailbox variant, behavior-equivalent to 5736-5784).
//   1) void sendSandboxPermissionResponseViaMailbox replies to the worker
//   2) (persistToSettings && allow) setAppState toolPermissionContext + persist + refreshConfig (only persisted on allow)
//   3) setAppState workerSandboxPermissions.queue.slice(1) removes the queue head
// ctx carries REPL closure dependencies; the helper holds no React state.

import {
	type NetworkHostPattern,
	SandboxManager,
} from "src/utils/sandbox/sandbox-adapter.js";
import type { AppState } from "../state/AppStateStore.js";
import { WEB_FETCH_TOOL_NAME } from "../tools/WebFetchTool/prompt.js";
import {
	applyPermissionUpdate,
	persistPermissionUpdate,
} from "../utils/permissions/PermissionUpdate.js";
import { sendSandboxPermissionResponseViaMailbox } from "../utils/swarm/permissionSync.js";

type SandboxUserResponse = {
	allow: boolean;
	persistToSettings: boolean;
};

type SandboxPermissionRequestItem = {
	hostPattern: NetworkHostPattern;
	resolvePromise: (allowConnection: boolean) => void;
};

type SandboxPermissionResponseCtx = {
	sandboxPermissionRequestQueue: SandboxPermissionRequestItem[];
	setSandboxPermissionRequestQueue: (
		updater: (
			queue: SandboxPermissionRequestItem[],
		) => SandboxPermissionRequestItem[],
	) => void;
	setAppState: (updater: (prev: AppState) => AppState) => void;
	sandboxBridgeCleanupRef: {
		current: Map<string, Array<() => void>>;
	};
};

// REPL keeps a thin wrapper: onUserResponse={(r) => handleLocalSandboxUserResponse(r, {sandboxPermissionRequestQueue, setSandboxPermissionRequestQueue, setAppState, sandboxBridgeCleanupRef})}
export function handleLocalSandboxUserResponse(
	response: SandboxUserResponse,
	ctx: SandboxPermissionResponseCtx,
): void {
	const { allow, persistToSettings } = response;
	const currentRequest = ctx.sandboxPermissionRequestQueue[0];
	if (!currentRequest) return;
	const approvedHost = currentRequest.hostPattern.host;
	if (persistToSettings) {
		const update = {
			type: "addRules" as const,
			rules: [
				{
					toolName: WEB_FETCH_TOOL_NAME,
					ruleContent: `domain:${approvedHost}`,
				},
			],
			behavior: (allow ? "allow" : "deny") as "allow" | "deny",
			destination: "localSettings" as const,
		};
		ctx.setAppState((prev) => ({
			...prev,
			toolPermissionContext: applyPermissionUpdate(
				prev.toolPermissionContext,
				update,
			),
		}));
		persistPermissionUpdate(update);

		// Immediately update sandbox in-memory config to prevent race conditions
		// where pending requests slip through before settings change is detected
		SandboxManager.refreshConfig();
	}

	// Resolve ALL pending requests for the same host (not just the first one)
	// This handles the case where multiple parallel requests came in for the same domain
	ctx.setSandboxPermissionRequestQueue((queue) => {
		queue
			.filter((item) => item.hostPattern.host === approvedHost)
			.forEach((item) => {
				item.resolvePromise(allow);
			});
		return queue.filter((item) => item.hostPattern.host !== approvedHost);
	});

	// Clean up bridge subscriptions and cancel remote prompts
	// for this host since the local user already responded.
	const cleanups = ctx.sandboxBridgeCleanupRef.current.get(approvedHost);
	if (cleanups) {
		for (const fn of cleanups) {
			fn();
		}
		ctx.sandboxBridgeCleanupRef.current.delete(approvedHost);
	}
}

type WorkerSandboxPermissionItem = {
	requestId: string;
	workerId: string;
	workerName: string;
	workerColor?: string;
	host: string;
	createdAt: number;
};

type WorkerSandboxResponseCtx = {
	workerSandboxPermissions: { queue: WorkerSandboxPermissionItem[] };
	setAppState: (updater: (prev: AppState) => AppState) => void;
	teamName?: string;
};

// REPL keeps a thin wrapper: onUserResponse={(r) => handleWorkerSandboxUserResponse(r, {workerSandboxPermissions, setAppState, teamName: teamContext?.teamName})}
export function handleWorkerSandboxUserResponse(
	response: SandboxUserResponse,
	ctx: WorkerSandboxResponseCtx,
): void {
	const { allow, persistToSettings } = response;
	const currentRequest = ctx.workerSandboxPermissions.queue[0];
	if (!currentRequest) return;
	const approvedHost = currentRequest.host;

	// Send response via mailbox to the worker
	void sendSandboxPermissionResponseViaMailbox(
		currentRequest.workerName,
		currentRequest.requestId,
		approvedHost,
		allow,
		ctx.teamName,
	);
	if (persistToSettings && allow) {
		const update = {
			type: "addRules" as const,
			rules: [
				{
					toolName: WEB_FETCH_TOOL_NAME,
					ruleContent: `domain:${approvedHost}`,
				},
			],
			behavior: "allow" as const,
			destination: "localSettings" as const,
		};
		ctx.setAppState((prev) => ({
			...prev,
			toolPermissionContext: applyPermissionUpdate(
				prev.toolPermissionContext,
				update,
			),
		}));
		persistPermissionUpdate(update);
		SandboxManager.refreshConfig();
	}

	// Remove from queue
	ctx.setAppState((prev) => ({
		...prev,
		workerSandboxPermissions: {
			...prev.workerSandboxPermissions,
			queue: prev.workerSandboxPermissions.queue.slice(1),
		},
	}));
}
