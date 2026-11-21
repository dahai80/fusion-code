// audit 1.1.1: read-file state restoration pure computation extracted from REPL.tsx. No React, no JSX, no hooks.
// The only side effects = mutating the two passed-in ref.current values (same as the original useCallback body).
//   readFileState.current = mergeFileStateCaches(existing, newly extracted) — accumulating cache.
//   bashTools.current.add(tool) — accumulating bash tool-name set.
// Original useCallback deps = [] (no deps, read-only refs); REPL keeps a thin wrapper, downstream reads the same-named const (byte-equivalent).

import type { Message as MessageType } from "../types/message.js";
import type { FileStateCache } from "./fileStateCache.js";
import {
	mergeFileStateCaches,
	READ_FILE_STATE_CACHE_SIZE,
} from "./fileStateCache.js";
import {
	extractBashToolsFromMessages,
	extractReadFilesFromMessages,
} from "./queryHelpers.js";

// The two refs bound to a REPL instance. readFileState = useRef<FileStateCache>,
// bashTools = useRef<Set<string>>. This function mutates .current directly (the refs themselves never change).
export type RestoreReadFileStateSetters = {
	readFileState: { current: FileStateCache };
	bashTools: { current: Set<string> };
};

// Re-derive file-read state from a message list and merge into the live cache,
// then accumulate any bash tool names. Idempotent w.r.t. the ref mutation order
// (merge then add). Deps [] in REPL because it only touches the refs it closes
// over; here the refs are passed in so no closure deps exist either.
// Behavior-equivalent to the REPL.tsx:2369-2385 useCallback body. REPL keeps a thin useCallback wrapper (deps [] unchanged).
export function restoreReadFileState(
	messages: MessageType[],
	cwd: string,
	setters: RestoreReadFileStateSetters,
): void {
	const extracted = extractReadFilesFromMessages(
		messages,
		cwd,
		READ_FILE_STATE_CACHE_SIZE,
	);
	setters.readFileState.current = mergeFileStateCaches(
		setters.readFileState.current,
		extracted,
	);
	for (const tool of extractBashToolsFromMessages(messages)) {
		setters.bashTools.current.add(tool);
	}
}
