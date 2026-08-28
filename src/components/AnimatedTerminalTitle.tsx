// audit 1.1.1: 从 REPL.tsx 抽出的叶组件 (god module 拆分起步)。
// 960ms 动画 tick 只重渲染本叶 (返回 null, 纯副作用), 不拖整棵 REPL 树。
// React-Compiler 编译产物原样保留 ($ = _c() memo cache)。

import * as React from "react";
import { c as _c } from "react/compiler-runtime";
import { useTerminalFocus, useTerminalTitle } from "../ink.js";

const TITLE_ANIMATION_FRAMES = ["⠂", "⠐"];
const TITLE_STATIC_PREFIX = "✳";
const TITLE_ANIMATION_INTERVAL_MS = 960;

/**
 * Sets the terminal tab title, with an animated prefix glyph while a query
 * is running. Isolated from REPL so the 960ms animation tick re-renders only
 * this leaf component (which returns null — pure side-effect) instead of the
 * entire REPL tree. Before extraction, the tick was ~1 REPL render/sec for
 * the duration of every turn, dragging PromptInput and friends along.
 */
export function AnimatedTerminalTitle(t0: {
	isAnimating: boolean;
	title: string;
	disabled?: boolean;
	noPrefix?: boolean;
}) {
	const $ = _c(6);
	const { isAnimating, title, disabled, noPrefix } = t0;
	const terminalFocused = useTerminalFocus();
	const [frame, setFrame] = React.useState(0);
	let t1;
	let t2;
	if (
		$[0] !== disabled ||
		$[1] !== isAnimating ||
		$[2] !== noPrefix ||
		$[3] !== terminalFocused
	) {
		t1 = () => {
			if (disabled || noPrefix || !isAnimating || !terminalFocused) {
				return;
			}
			const interval = setInterval(
				_temp2,
				TITLE_ANIMATION_INTERVAL_MS,
				setFrame,
			);
			return () => clearInterval(interval);
		};
		t2 = [disabled, noPrefix, isAnimating, terminalFocused];
		$[0] = disabled;
		$[1] = isAnimating;
		$[2] = noPrefix;
		$[3] = terminalFocused;
		$[4] = t1;
		$[5] = t2;
	} else {
		t1 = $[4];
		t2 = $[5];
	}
	React.useEffect(t1, t2);
	const prefix = isAnimating
		? (TITLE_ANIMATION_FRAMES[frame] ?? TITLE_STATIC_PREFIX)
		: TITLE_STATIC_PREFIX;
	useTerminalTitle(disabled ? null : noPrefix ? title : `${prefix} ${title}`);
	return null;
}
function _temp2(setFrame_0: React.Dispatch<React.SetStateAction<number>>) {
	return setFrame_0(_temp);
}
function _temp(f: number) {
	return (f + 1) % TITLE_ANIMATION_FRAMES.length;
}
