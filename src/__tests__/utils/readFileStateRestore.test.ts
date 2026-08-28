import { describe, expect, it } from "bun:test";
import type { Message as MessageType } from "../../types/message.js";
import {
	createFileStateCacheWithSizeLimit,
	READ_FILE_STATE_CACHE_SIZE,
} from "../../utils/fileStateCache.js";
import { restoreReadFileState } from "../../utils/readFileStateRestore.js";

// audit 1.1.1: restoreReadFileState 单元测试。行为等价 REPL.tsx 内联 restoreReadFileState
// useCallback 体。两个副作用: (1) readFileState.current = mergeFileStateCaches(旧, 新提取)
//   — 返回 NEW 缓存 (clone), ref 被重赋值; (2) bashTools.current.add(cliName) — 累积。
// extractReadFilesFromMessages 需 assistant tool_use + 配对 tool_result, 构造完整对成本高;
// 此处聚焦可廉价观测的 bashTools 累积 + readFileState.current ref 重赋值 (merge 返回 clone)。

// 构造含 Bash tool_use 的最小 assistant message。extractBashToolsFromMessages 读
// message.type==="assistant" + content[].type==="tool_use" + name==="Bash" + input.command。
function makeBashAssistant(command: string): MessageType {
	return {
		uuid: `msg-${command}`,
		type: "assistant",
		role: "assistant",
		message: {
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: `tool-${command}`,
					name: "Bash",
					input: { command },
				},
			],
		},
	} as unknown as MessageType;
}

function makeSetters() {
	const readFileState = {
		current: createFileStateCacheWithSizeLimit(READ_FILE_STATE_CACHE_SIZE),
	};
	const bashTools = { current: new Set<string>() };
	return { readFileState, bashTools };
}

describe("restoreReadFileState", () => {
	it("accumulates bash tool cli names into bashTools.current", () => {
		const { readFileState, bashTools } = makeSetters();
		restoreReadFileState([makeBashAssistant("ls -la")], "/cwd", {
			readFileState,
			bashTools,
		});
		expect(bashTools.current.has("ls")).toBe(true);
	});

	it("accumulates across multiple calls (Set union, no dup)", () => {
		const { readFileState, bashTools } = makeSetters();
		restoreReadFileState([makeBashAssistant("ls")], "/cwd", {
			readFileState,
			bashTools,
		});
		restoreReadFileState([makeBashAssistant("git status")], "/cwd", {
			readFileState,
			bashTools,
		});
		expect(bashTools.current.has("ls")).toBe(true);
		expect(bashTools.current.has("git")).toBe(true);
		expect(bashTools.current.size).toBe(2);
	});

	it("reassigns readFileState.current to a new merged cache (merge returns clone)", () => {
		const { readFileState, bashTools } = makeSetters();
		const before = readFileState.current;
		restoreReadFileState([], "/cwd", { readFileState, bashTools });
		// mergeFileStateCaches clones `first` even when `second` is empty → new ref.
		expect(readFileState.current).not.toBe(before);
	});

	it("ignores non-bash tool_use (no cli name added)", () => {
		const { readFileState, bashTools } = makeSetters();
		const msg = {
			uuid: "m1",
			type: "assistant",
			role: "assistant",
			message: {
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "t1",
						name: "Read",
						input: { file_path: "/x" },
					},
				],
			},
		} as unknown as MessageType;
		restoreReadFileState([msg], "/cwd", { readFileState, bashTools });
		expect(bashTools.current.size).toBe(0);
	});

	it("skips bash tool_use with non-string command", () => {
		const { readFileState, bashTools } = makeSetters();
		const msg = {
			uuid: "m1",
			type: "assistant",
			role: "assistant",
			message: {
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "t1",
						name: "Bash",
						input: { command: 42 },
					},
				],
			},
		} as unknown as MessageType;
		restoreReadFileState([msg], "/cwd", { readFileState, bashTools });
		// extractCliName(undefined) → undefined → not added (command 非字符串 → undefined)
		expect(bashTools.current.size).toBe(0);
	});
});
