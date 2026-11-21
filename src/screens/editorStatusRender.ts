// audit 1.1.1 slice #37: editorStatus render sub-block extracted (PURE-ASYNC-HELPER, 3rd — like slice #23 applyOnInit / #31 applyInitialMessage / #36 applyAgentTranscriptBootstrap).
// REPL() transcript `v` key (less-style): render full transcript→tmpfile→open in $VISUAL/$EDITOR.
// Original async IIFE inside the useInput v-branch. Three refs (gen/timer/rendering) + setEditorStatus + deferredMessages + tools passed via ctx (closure capture), byte-equivalent behavior.
// Imported helpers (renderMessagesToPlainText/openFileInExternalEditor/writeFile/join/tmpdir) imported directly, not via ctx.
// double-tap-drop guard + gen-capture + staleness-aware setStatus stay inside the helper (ref mutation does not enter useInput deps).
// No JSX / no hook → .ts. Returns void (REPL thin shell calls it with void).

import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// REPL keeps the useInput v-branch thin shell:
//   } else if (input === "v") {
//     // less-style: v opens the file in $VISUAL/$EDITOR. ...
//     event.stopImmediatePropagation();
//     applyEditorOpenInExternalEditor({ editorGenRef, editorTimerRef, editorRenderingRef, setEditorStatus, deferredMessages, tools });
//   }
// stopImmediatePropagation stays in the REPL thin shell (input-event concern, not a render concern).
// setStatus closure inside the helper: silently drops when gen doesn't match (transcript-exit bumps gen → late writes go silent).
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
