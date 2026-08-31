import type React from "react";
import { useCallback, useEffect } from "react";
import type { Command } from "../commands.js";
import type { Message } from "../types/message.js";

export function useReplBridge(
	_messages: Message[],
	_setMessages: (action: React.SetStateAction<Message[]>) => void,
	_abortControllerRef: React.RefObject<AbortController | null>,
	_commands: readonly Command[],
	_mainLoopModel: string,
): {
	sendBridgeResult: () => void;
} {
	useEffect(() => {}, []);
	useEffect(() => {}, []);
	const sendBridgeResult = useCallback(() => {}, []);
	return {
		sendBridgeResult,
	};
}
