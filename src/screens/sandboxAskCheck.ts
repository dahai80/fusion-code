// audit 1.1.1 slice #49: sandbox network permission ask useCallback body 外移 (INLINE-CALLBACK curried-factory, like #46 applyRemoteInit)。
// REPL() SandboxManager 回调: 收到 hostPattern 后决定是否允许网络连接。
// swarm-worker 路径: generateSandboxRequestId → sendSandboxPermissionRequestViaMailbox 发 leader; sent=false fallback 本地队列; sent=true registerSandboxPermissionCallback + setAppState pending 指示器。
// 非 worker 路径: 本地对话框队列 + (BRIDGE_MODE) REPL bridge race — bridge onResponse 先到则 resolve 所有同 host 请求 + 清 sibling subscriptions; 本地先到则 cleanup 取消 bridge。
// 原 useCallback body。setAppState + store (deps) + setSandboxPermissionRequestQueue + sandboxBridgeCleanupRef (稳定引用, 省略 deps) 经 ctx 传入 (闭包捕获), 行为字节等价。
// useCallback() hook 留 REPL 薄壳 (hook 规则, 不能移 plain helper), 仅 callback body 移出 (curried factory 返 async fn, REPL useCallback 再包一层透传)。
// 8 模块 import 直接 import (非 REPL state, per imported-helpers-directly rule; 全部 REPL 多用, 不移除 REPL import):
//   isAgentSwarmsEnabled (utils/agentSwarmsEnabled) / generateSandboxRequestId + isSwarmWorker + sendSandboxPermissionRequestViaMailbox (utils/swarm/permissionSync) /
//   registerSandboxPermissionCallback (hooks/useSwarmPermissionPoller) / SANDBOX_NETWORK_ACCESS_TOOL_NAME (cli/structuredIO) / randomUUID (crypto) / feature (bun:bundle build macro)。
// 无 JSX → .ts。返 Promise<boolean> (SandboxAskCallback 签名: (hostPattern) => Promise<boolean>)。
// deps [setAppState, store] 不变 (setSandboxPermissionRequestQueue useState setter + sandboxBridgeCleanupRef ref 稳定引用, 省略合法, 与原一致)。

import { feature } from "bun:bundle";
import { randomUUID } from "node:crypto";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { SANDBOX_NETWORK_ACCESS_TOOL_NAME } from "src/cli/structuredIO.js";
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

// REPL 保留 useCallback 薄壳:
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

			// When the REPL bridge is connected, also forward the sandbox
			// permission request as a can_use_tool control_request so the
			// remote user (e.g. on claude.ai) can approve it too.
			if (feature("BRIDGE_MODE")) {
				const bridgeCallbacks =
					ctx.store.getState().replBridgePermissionCallbacks;
				if (bridgeCallbacks) {
					const bridgeRequestId = randomUUID();
					bridgeCallbacks.sendRequest(
						bridgeRequestId,
						SANDBOX_NETWORK_ACCESS_TOOL_NAME,
						{
							host: hostPattern.host,
						},
						randomUUID(),
						`Allow network connection to ${hostPattern.host}?`,
					);
					const unsubscribe = bridgeCallbacks.onResponse(
						bridgeRequestId,
						(response) => {
							unsubscribe();
							const allow = response.behavior === "allow";
							// Resolve ALL pending requests for the same host, not just
							// this one — mirrors the local dialog handler pattern.
							ctx.setSandboxPermissionRequestQueue((queue) => {
								queue
									.filter((item) => item.hostPattern.host === hostPattern.host)
									.forEach((item) => {
										item.resolvePromise(allow);
									});
								return queue.filter(
									(item) => item.hostPattern.host !== hostPattern.host,
								);
							});
							// Clean up all sibling bridge subscriptions for this host
							// (other concurrent same-host requests) before deleting.
							const siblingCleanups = ctx.sandboxBridgeCleanupRef.current.get(
								hostPattern.host,
							);
							if (siblingCleanups) {
								for (const fn of siblingCleanups) {
									fn();
								}
								ctx.sandboxBridgeCleanupRef.current.delete(hostPattern.host);
							}
						},
					);

					// Register cleanup so the local dialog handler can cancel
					// the remote prompt and unsubscribe when the local user
					// responds first.
					const cleanup = () => {
						unsubscribe();
						bridgeCallbacks.cancelRequest(bridgeRequestId);
					};
					const existing =
						ctx.sandboxBridgeCleanupRef.current.get(hostPattern.host) ?? [];
					existing.push(cleanup);
					ctx.sandboxBridgeCleanupRef.current.set(hostPattern.host, existing);
				}
			}
		});
	};
}
