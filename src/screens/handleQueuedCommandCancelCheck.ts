// audit 1.1.1 slice #53: handleQueuedCommandOnCancel useCallback body 外移 (INLINE-CALLBACK curried-factory, like #46/#49/#50)。
// REPL() cancel permission request 时恢复 queued command: popAllEditable(inputValue, 0) → set input text + 回 prompt mode + 恢复 images 进 pastedContents。
// 原 useCallback body。inputValue (deps 触发器, state) + setInputValue (useCallback 包装 setter) + setInputMode + setPastedContents (useState setters) 经 ctx 传入 (闭包捕获), 行为字节等价。
// useCallback() hook 留 REPL 薄壳 (hook 规则, 不能移 plain helper), 仅 callback body 移出 (curried factory 返 fn, REPL useCallback 再包一层透传)。
// popAllEditable (utils/messageQueueManager) 直接 import (非 REPL state, per imported-helpers-directly rule; REPL 单用, 提取后 REPL import 移除)。
// 无 JSX → .ts。返 () => void (REPL 薄壳 useCallback 透传)。
// deps [setInputValue, setInputMode, inputValue, setPastedContents] 不变 (setters 稳定引用, inputValue 为 state dep)。

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

// REPL 保留 useCallback 薄壳:
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
