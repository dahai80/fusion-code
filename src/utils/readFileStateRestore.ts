// audit 1.1.1: 从 REPL.tsx 抽出的 read-file state 恢复纯计算。无 React, 无 JSX, 无 hooks。
// 唯一副作用 = mutate 传入的两个 ref.current (与原 useCallback 体一致)。
//   readFileState.current = mergeFileStateCaches(现有, 新提取) — 累积缓存。
//   bashTools.current.add(tool) — 累积 bash 工具名集合。
// 原 useCallback deps = [] (无依赖, 只读 ref); REPL 保留薄包装, 下游读取同名 const (字节等价)。

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

// REPL 实例绑定的两个 ref。readFileState = useRef<FileStateCache>,
// bashTools = useRef<Set<string>>。此处直接 mutate .current (ref 本身不变)。
export type RestoreReadFileStateSetters = {
	readFileState: { current: FileStateCache };
	bashTools: { current: Set<string> };
};

// Re-derive file-read state from a message list and merge into the live cache,
// then accumulate any bash tool names. Idempotent w.r.t. the ref mutation order
// (merge then add). Deps [] in REPL because it only touches the refs it closes
// over; here the refs are passed in so no closure deps exist either.
// 行为等价 REPL.tsx:2369-2385 useCallback 体。REPL 保留 useCallback 薄包装 (deps [] 不变)。
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
