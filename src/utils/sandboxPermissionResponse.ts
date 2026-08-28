// audit 1.1.1: 从 REPL.tsx SandboxPermissionRequest.onUserResponse (local 分支)
// 抽出的纯路由。无 React hooks, 无 JSX, 无 await。唯一副作用 =
//   1) (persistToSettings) setAppState 更新 toolPermissionContext + persistPermissionUpdate + SandboxManager.refreshConfig
//   2) setSandboxPermissionRequestQueue 解析同-host 全部 pending + 过滤
//   3) sandboxBridgeCleanupRef 清理 bridge 订阅 + 删 key
// ctx 携带 4 个 REPL 闭包依赖, helper 不持有 React state。
// 行为等价 REPL.tsx:5675-5734。

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

// REPL 保留薄包装: onUserResponse={(r) => handleLocalSandboxUserResponse(r, {sandboxPermissionRequestQueue, setSandboxPermissionRequestQueue, setAppState, sandboxBridgeCleanupRef})}
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
