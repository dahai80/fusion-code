// audit 1.1.1: 从 REPL.tsx onInit 抽出的纯异步 helper。
// 行为等价 REPL.tsx:4522-4559。无 React hooks, 无 JSX。
// 3 步: (1) void reverify() 启动校验 API key;
//   (2) await getMemoryFiles() 加载 CLAUDE.md/rules, logForDebugging 汇总;
//   (3) 遍历 memoryFiles → readFileState.current.set(path, FileState),
//       contentDiffersFromDisk 时缓存 rawContent + isPartialView=true (Edit/Write 须先 Read)。
// ctx 携带 REPL 闭包依赖 (reverify + readFileState ref), helper 不持有 React state。

import { getMemoryFiles, type MemoryFileInfo } from "./claudemd.js";
import { logForDebugging } from "./debug.js";
import type { FileState, FileStateCache } from "./fileStateCache.js";

type OnInitCtx = {
	reverify: () => void;
	readFileState: { current: FileStateCache };
};

// REPL 保留薄包装: async function onInit() { await applyOnInitImpl({reverify, readFileState}); }
export async function applyOnInit(ctx: OnInitCtx): Promise<void> {
	// Always verify API key on startup, so we can show the user an error in the
	// bottom right corner of the screen if the API key is invalid.
	void ctx.reverify();

	// Populate readFileState with CLAUDE.md files at startup
	const memoryFiles = await getMemoryFiles();
	if (memoryFiles.length > 0) {
		const fileList = memoryFiles
			.map(
				(f: MemoryFileInfo) =>
					`  [${f.type}] ${f.path} (${f.content.length} chars)${f.parent ? ` (included by ${f.parent})` : ""}`,
			)
			.join("\n");
		logForDebugging(
			`Loaded ${memoryFiles.length} CLAUDE.md/rules files:\n${fileList}`,
		);
	} else {
		logForDebugging("No CLAUDE.md/rules files found");
	}
	for (const file of memoryFiles) {
		// When the injected content doesn't match disk (stripped HTML comments,
		// stripped frontmatter, MEMORY.md truncation), cache the RAW disk bytes
		// with isPartialView so Edit/Write require a real Read first while
		// getChangedFiles + nested_memory dedup still work.
		const entry: FileState = {
			content: file.contentDiffersFromDisk
				? (file.rawContent ?? file.content)
				: file.content,
			timestamp: Date.now(),
			offset: undefined,
			limit: undefined,
			isPartialView: file.contentDiffersFromDisk,
		};
		ctx.readFileState.current.set(file.path, entry);
	}

	// Initial message handling is done via the initialMessage effect
}
