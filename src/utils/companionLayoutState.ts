// audit 1.1.1: 从 REPL.tsx 抽出的 companion 布局状态推导。纯函数, 无 React, 无副作用。
// 4 个 derive: companionNarrow → companionVisible, toolJsxCentered → centeredModal。
// REPL 保留所有 useState/useRef 绑定, 仅把纯计算外移, 下游读取同名 const (字节等价)。
// isFullscreenEnvEnabled() 是 runtime env 检查 (utils/fullscreen.ts), 无 React 依赖, 可在纯函数内调用。

import type { ReactNode } from "react";
import { MIN_COLS_FOR_FULL_SPRITE } from "../buddy/CompanionSprite.js";
import { isFullscreenEnvEnabled } from "./fullscreen.js";

// toolJSX 的布局相关字段 (REPL useState 形状的子集, 仅取这里用到的 3 个)。
// 避免拉入完整 toolJSX 类型 (含 shouldContinueAnimation/showSpinner/isImmediate 等无关字段)。
export type ToolJsxLayoutLike = {
	jsx: ReactNode | null;
	shouldHidePromptInput?: boolean;
	isLocalJSXCommand?: boolean;
} | null;

export type CompanionLayoutInput = {
	transcriptCols: number;
	toolJSX: ToolJsxLayoutLike;
	focusedInputDialog: string | undefined;
	showBashesDialog: string | boolean;
};

export type CompanionLayoutState = {
	companionNarrow: boolean;
	companionVisible: boolean;
	toolJsxCentered: boolean;
	centeredModal: ReactNode | null;
};

// companionNarrow: 窄终端 (< MIN_COLS_FOR_FULL_SPRITE) 时 companion 塌缩为单行,
// REPL 自行堆叠 (fullscreen 在输入上方, scrollback 在下方), 不再左右分栏。
export function deriveCompanionNarrow(transcriptCols: number): boolean {
	return transcriptCols < MIN_COLS_FOR_FULL_SPRITE;
}

// companionVisible: PromptInput 提前返回 BackgroundTasksDialog 时隐藏 sprite。
// sprite 与 PromptInput 同行, 对话框 Pane 分隔线按 useTerminalSize 宽度绘制但只占
// terminalWidth - spriteWidth, 分隔线提前停止且文本换行。不检查 footerSelection:
// pill FOCUS (下箭头到 tasks pill) 必须保留 sprite 可见, 以便右箭头导航到它。
export function deriveCompanionVisible(
	toolJSX: ToolJsxLayoutLike,
	focusedInputDialog: string | undefined,
	showBashesDialog: string | boolean,
): boolean {
	return (
		!toolJSX?.shouldHidePromptInput && !focusedInputDialog && !showBashesDialog
	);
}

// toolJsxCentered: fullscreen 下所有 local-jsx slash 命令浮动到 modal 槽位 —
// FullscreenLayout 用绝对定位底锚 Pane 包裹 (▔ 分隔线, ModalContext)。
// Pane/Dialog 检测到 context 跳过自身顶层框架。非 fullscreen 走下方内联渲染。
export function deriveToolJsxCentered(toolJSX: ToolJsxLayoutLike): boolean {
	return isFullscreenEnvEnabled() && toolJSX?.isLocalJSXCommand === true;
}

// centeredModal: toolJsxCentered 时取 toolJSX.jsx 作为 modal 内容, 否则 null。
export function deriveCenteredModal(
	toolJsxCentered: boolean,
	toolJSX: ToolJsxLayoutLike,
): ReactNode | null {
	// toolJsxCentered 为 true 时 toolJSX 必非空 (centered = fullscreen +
	// isLocalJSXCommand===true, 后者要求 toolJSX 非空), 故 ?. 等价原 `!` 断言。
	return toolJsxCentered ? (toolJSX?.jsx ?? null) : null;
}

// 一次性聚合: 输入原始布局状态, 输出全部 4 个 derive。
// REPL 调用一次, 绑定到同名 const, 下游读取不变 (字节等价)。
export function deriveCompanionLayoutState(
	input: CompanionLayoutInput,
): CompanionLayoutState {
	const companionNarrow = deriveCompanionNarrow(input.transcriptCols);
	const companionVisible = deriveCompanionVisible(
		input.toolJSX,
		input.focusedInputDialog,
		input.showBashesDialog,
	);
	const toolJsxCentered = deriveToolJsxCentered(input.toolJSX);
	const centeredModal = deriveCenteredModal(toolJsxCentered, input.toolJSX);
	return { companionNarrow, companionVisible, toolJsxCentered, centeredModal };
}
