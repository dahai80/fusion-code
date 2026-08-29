// audit 1.1.1 slice #37: editorStatus render sub-block 外移 (PURE-ASYNC-HELPER, 3rd — 像 slice #23 applyOnInit / #31 applyInitialMessage / #36 applyAgentTranscriptBootstrap)。
// REPL() transcript `v` 键 (less-style): 渲染全 transcript→tmpfile→open in $VISUAL/$EDITOR。
// 原 async IIFE inside useInput v-branch。三 ref (gen/timer/rendering) + setEditorStatus + deferredMessages + tools 经 ctx 传入 (闭包捕获), 行为字节等价。
// 导入型 helper (renderMessagesToPlainText/openFileInExternalEditor/writeFile/join/tmpdir) 直接 import, 不经 ctx。
// double-tap-drop guard + gen-capture + staleness-aware setStatus 留 helper 内 (ref-mutate 不入 useInput deps)。
// 无 JSX/无 hook → .ts。void 返回 (REPL 薄壳 void 调用)。

import { writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { MutableRefObject } from "react";
import { openFileInExternalEditor } from "../utils/editor.js";
import { renderMessagesToPlainText } from "../utils/exportRenderer.js";

type EditorStatusRenderCtx = {
	// transcript-exit generation guard (bump → late async writes go silent)
	editorGenRef: MutableRefObject<number>;
	editorTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | undefined>;
	// double-tap-drop guard (render in flight → drop second press)
	editorRenderingRef: MutableRefObject<boolean>;
	setEditorStatus: (s: string) => void;
	deferredMessages: Parameters<typeof renderMessagesToPlainText>[0];
	tools: Parameters<typeof renderMessagesToPlainText>[1];
};

// REPL 保留 useInput v-branch 薄壳:
//   } else if (input === "v") {
//     // less-style: v opens the file in $VISUAL/$EDITOR. ...
//     event.stopImmediatePropagation();
//     applyEditorOpenInExternalEditor({ editorGenRef, editorTimerRef, editorRenderingRef, setEditorStatus, deferredMessages, tools });
//   }
// stopImmediatePropagation 留 REPL 薄壳 (input-event concern, 非 render concern)。
// helper 内 setStatus 闭包: gen 不匹配则静默 (transcript-exit bumps gen → late writes go silent)。
export function applyEditorOpenInExternalEditor(
	ctx: EditorStatusRenderCtx,
): void {
	// Drop double-taps: the render is async and a second press before it
	// completes would run a second parallel render (double memory, two
	// tempfiles, two editor spawns). editorGenRef only guards
	// transcript-exit staleness, not same-session concurrency.
	if (ctx.editorRenderingRef.current) return;
	ctx.editorRenderingRef.current = true;
	// Capture generation + make a staleness-aware setter. Each write
	// checks gen (transcript exit bumps it → late writes from the
	// async render go silent).
	const gen = ctx.editorGenRef.current;
	const setStatus = (s: string): void => {
		if (gen !== ctx.editorGenRef.current) return;
		clearTimeout(ctx.editorTimerRef.current);
		ctx.setEditorStatus(s);
	};
	setStatus(`rendering ${ctx.deferredMessages.length} messages…`);
	void (async () => {
		try {
			// Width = terminal minus vim's line-number gutter (4 digits +
			// space + slack). Floor at 80. PassThrough has no .columns so
			// without this Ink defaults to 80. Trailing-space strip: right-
			// aligned timestamps still leave a flexbox spacer run at EOL.
			// eslint-disable-next-line custom-rules/prefer-use-terminal-size -- one-shot at keypress time, not a reactive render dep
			const w = Math.max(80, (process.stdout.columns ?? 80) - 6);
			const raw = await renderMessagesToPlainText(
				ctx.deferredMessages,
				ctx.tools,
				w,
			);
			const text = raw.replace(/[ \t]+$/gm, "");
			const path = join(tmpdir(), `cc-transcript-${Date.now()}.txt`);
			await writeFile(path, text);
			const opened = openFileInExternalEditor(path);
			setStatus(
				opened ? `opening ${path}` : `wrote ${path} · no $VISUAL/$EDITOR set`,
			);
		} catch (e) {
			setStatus(`render failed: ${e instanceof Error ? e.message : String(e)}`);
		}
		ctx.editorRenderingRef.current = false;
		if (gen !== ctx.editorGenRef.current) return;
		ctx.editorTimerRef.current = setTimeout(
			(s) => s(""),
			4000,
			ctx.setEditorStatus,
		);
	})();
}
