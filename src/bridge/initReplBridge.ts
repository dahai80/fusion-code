// log: created for TS2307 fix

import type { ReplBridgeHandle } from "./replBridge.js";

export type InitReplBridgeOptions = {
	outboundOnly?: boolean;
	tags?: string[];
	initialMessages?: unknown[];
	onInboundMessage?: (msg: unknown) => void;
	onPermissionResponse?: (response: unknown) => void;
	onInterrupt?: () => void;
	onSetModel?: (model: string | null) => void;
	onSetMaxThinkingTokens?: (maxTokens: number | null) => void;
	onStateChange?: (state: string, detail?: string) => void;
};

export async function initReplBridge(
	options: InitReplBridgeOptions,
): Promise<ReplBridgeHandle> {
	console.log("[initReplBridge] initReplBridge called (stub)", options);
	return {} as ReplBridgeHandle;
}
