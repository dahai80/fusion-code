// audit 1.1.1: pure async helper extracted from REPL.tsx onInit.
// Behavior-equivalent to REPL.tsx:4522-4559. No React hooks, no JSX.
// 3 steps: (1) void reverify() kicks off API key verification;
//   (2) await getMemoryFiles() loads CLAUDE.md/rules, summarized via logForDebugging;
//   (3) iterate memoryFiles → readFileState.current.set(path, FileState);
//       when contentDiffersFromDisk, cache rawContent + isPartialView=true (Edit/Write require a prior Read).
// ctx carries REPL closure deps (reverify + readFileState ref); the helper holds no React state.

import { getMemoryFiles, type MemoryFileInfo } from "./claudemd.js";
import { logForDebugging } from "./debug.js";
import type { FileState, FileStateCache } from "./fileStateCache.js";

type OnInitCtx = {
	reverify: () => void;
	readFileState: { current: FileStateCache };
};

// REPL keeps a thin wrapper: async function onInit() { await applyOnInitImpl({reverify, readFileState}); }
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
