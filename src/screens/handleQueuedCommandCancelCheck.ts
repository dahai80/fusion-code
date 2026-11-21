// audit 1.1.1 slice #53: handleQueuedCommandOnCancel useCallback body extracted (INLINE-CALLBACK curried-factory, like #46/#49/#50).
// REPL() restores the queued command when a permission request is canceled: popAllEditable(inputValue, 0) → set input text + back to prompt mode + restore images into pastedContents.
// Original useCallback body. inputValue (deps trigger, state) + setInputValue (useCallback-wrapped setter) + setInputMode + setPastedContents (useState setters) passed via ctx (closure capture), byte-equivalent behavior.
// The useCallback() hook stays as a REPL thin shell (hook rules, cannot move to a plain helper); only the callback body moves out (curried factory returns the fn, REPL useCallback wraps it once more and passes it through).
// popAllEditable (utils/messageQueueManager) imported directly (not REPL state, per imported-helpers-directly rule; single use in REPL, REPL import removed after extraction).
// No JSX → .ts. Returns () => void (REPL thin-shell useCallback pass-through).
// deps [setInputValue, setInputMode, inputValue, setPastedContents] unchanged (setters are stable refs, inputValue is a state dep).

import type { Dispatch, SetStateAction } from "react";
import type { PromptInputMode } from "../types/textInputTypes.js";
import type { PastedContent } from "../utils/config.js";
import {
	type PopAllEditableResult,
	popAllEditable,
} from "../utils/messageQueueManager.js";

type HandleQueuedCommandCancelCheckCtx = {
	inputValue: string;
	setInputValue: (value: string) => void;
	setInputMode: Dispatch<SetStateAction<PromptInputMode>>;
	setPastedContents: Dispatch<SetStateAction<Record<number, PastedContent>>>;
};

// REPL keeps the useCallback thin shell:
//   const handleQueuedCommandOnCancel = useCallback(
//     () => createHandleQueuedCommandOnCancel({ inputValue, setInputValue, setInputMode, setPastedContents })(),
//     [setInputValue, setInputMode, inputValue, setPastedContents],
//   );
export function createHandleQueuedCommandOnCancel(
	ctx: HandleQueuedCommandCancelCheckCtx,
): () => void {
	return () => {
		// Function to handle queued command when canceling a permission request
		const result: PopAllEditableResult | undefined = popAllEditable(
			ctx.inputValue,
			0,
		);
		if (!result) return;
		ctx.setInputValue(result.text);
		ctx.setInputMode("prompt");

		// Restore images from queued commands to pastedContents
		if (result.images.length > 0) {
			ctx.setPastedContents((prev) => {
				const newContents = {
					...prev,
				};
				for (const image of result.images) {
					newContents[image.id] = image;
				}
				return newContents;
			});
		}
	};
}
