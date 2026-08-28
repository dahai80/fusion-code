// audit 1.1.1: 从 REPL.tsx 抽出的 setToolJSX 包装纯路由。无 React hooks, 无 JSX, 无异步。
// 唯一副作用 = mutate localJSXCommandRef.current + 调用 setToolJSXInternal (与原 useCallback 体一致)。
//   语义: local JSX 命令 (/btw 等 immediate) 持久化, 工具更新不可覆盖, 除非显式 clearLocalJSX。
// 原 useCallback deps = [] (只读 ref + 稳定 setter); REPL 保留薄包装, 下游读取同名 const (字节等价)。

import type { ReactNode } from "react";

// setToolJSX 入参。clearLocalJSX 仅 onDone 回调用以显式清 overlay。
export type SetToolJSXArgs = {
	jsx: ReactNode | null;
	shouldHidePromptInput: boolean;
	shouldContinueAnimation?: true;
	showSpinner?: boolean;
	isLocalJSXCommand?: boolean;
	clearLocalJSX?: boolean;
} | null;

// localJSXCommandRef 持久化的 local JSX 命令 (isLocalJSXCommand 恒为 true)。
export type LocalJSXCommand = {
	jsx: ReactNode | null;
	shouldHidePromptInput: boolean;
	shouldContinueAnimation?: true;
	showSpinner?: boolean;
	isLocalJSXCommand: true;
} | null;

// setToolJSXInternal (useState setter) 接受的内部 state 形状 (多 isImmediate?)。
export type ToolJSXInternalState = {
	jsx: ReactNode | null;
	shouldHidePromptInput: boolean;
	shouldContinueAnimation?: true;
	showSpinner?: boolean;
	isLocalJSXCommand?: boolean;
	isImmediate?: boolean;
} | null;

// REPL 实例绑定的 ref + setter。localJSXCommandRef = useRef<LocalJSXCommand>,
// setToolJSXInternal = useState 的 setter (恒稳定)。此处直接 mutate ref / 调用 setter。
export type SetToolJSXSetters = {
	localJSXCommandRef: { current: LocalJSXCommand };
	setToolJSXInternal: (value: ToolJSXInternalState) => void;
};

// Route a setToolJSX call: local JSX command stored separately so tools can't
// overwrite it unless they explicitly clear it (clearLocalJSX from onDone).
// 行为等价 REPL.tsx:1284-1326 useCallback 体。REPL 保留 useCallback 薄包装 (deps [] 不变)。
export function applyToolJSXUpdate(
	args: SetToolJSXArgs,
	setters: SetToolJSXSetters,
): void {
	// If setting a local JSX command, store it in the ref
	if (args?.isLocalJSXCommand) {
		const { clearLocalJSX: _omit, ...rest } = args;
		setters.localJSXCommandRef.current = {
			...rest,
			isLocalJSXCommand: true,
		};
		setters.setToolJSXInternal(rest);
		return;
	}

	// If there's an active local JSX command in the ref
	if (setters.localJSXCommandRef.current) {
		// Allow clearing only if explicitly requested (from onDone callbacks)
		if (args?.clearLocalJSX) {
			setters.localJSXCommandRef.current = null;
			setters.setToolJSXInternal(null);
			return;
		}
		// Otherwise, keep the local JSX command visible - ignore tool updates
		return;
	}

	// No active local JSX command, allow any update
	if (args?.clearLocalJSX) {
		setters.setToolJSXInternal(null);
		return;
	}
	setters.setToolJSXInternal(args);
}
