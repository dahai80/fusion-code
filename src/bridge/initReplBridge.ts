// log: created for TS2307 fix

import type { ReplBridgeHandle } from "./replBridge.js";

export type InitReplBridgeOptions = {
	outboundOnly?: boolean;
	tags?: string[];
	onInboundMessage?: (msg: unknown) => void;
	onPermissionResponse?: (response: unknown) => void;
	onInterrupt?: () => void;
	onSetModel?: (model: string | null) => void;
};

export async function initReplBridge(
	options: InitReplBridgeOptions,
): Promise<ReplBridgeHandle> {
	console.log("[initReplBridge] initReplBridge called (stub)", options);
	return {} as ReplBridgeHandle;
}
