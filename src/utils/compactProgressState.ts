// audit 1.1.1: 从 REPL.tsx getToolUseContext.onCompactProgress 抽出的纯路由。
// 无 React hooks, 无 JSX, 无 await。唯一副作用 = 调 3 个 spinner setter
// (setSpinnerColor/Shimmer/Message)。语义: compact 生命周期事件 → spinner 文案/颜色。
//   hooks_start: 系统蓝 spinner + 按 hookType (pre/post_compact/session_start) 选文案;
//   compact_start: "Compacting conversation";
//   compact_retry: "Compacting (retry N/M: <reason>)" (item 16 截断重试可见);
//   compact_stall: 超过 COMPACT_STALL_HINT_MS 才显耗时文本 (item 16 无 token 流超阈值显耗时);
//   compact_end: 清 spinner (message/color/shimmer 全 null)。
// formatDuration + COMPACT_STALL_HINT_MS = REPL-local, 经 setters 外部传入保持字节等价。
// REPL 保留 onCompactProgress 内联回调 (闭包 spinner setter), 调本 helper 一次。

import type { Theme } from "src/utils/theme.js";
import type { CompactProgressEvent } from "../Tool.js";
import { formatDuration } from "./format.js";

type SpinnerSetter = {
	setSpinnerColor: (v: keyof Theme | null) => void;
	setSpinnerShimmerColor: (v: keyof Theme | null) => void;
	setSpinnerMessage: (v: string | null) => void;
};

export type CompactProgressSetters = SpinnerSetter & {
	compactStallHintMs: number;
};

export function applyOnCompactProgress(
	event: CompactProgressEvent,
	setters: CompactProgressSetters,
): void {
	switch (event.type) {
		case "hooks_start":
			setters.setSpinnerColor("claudeBlue_FOR_SYSTEM_SPINNER");
			setters.setSpinnerShimmerColor("claudeBlueShimmer_FOR_SYSTEM_SPINNER");
			setters.setSpinnerMessage(
				event.hookType === "pre_compact"
					? "Running PreCompact hooks…"
					: event.hookType === "post_compact"
						? "Running PostCompact hooks…"
						: "Running SessionStart hooks…",
			);
			break;
		case "compact_start":
			setters.setSpinnerMessage("Compacting conversation");
			break;
		case "compact_retry":
			setters.setSpinnerMessage(
				`Compacting (retry ${event.attempt}/${event.maxRetries}: ${event.reason})`,
			);
			break;
		case "compact_stall":
			if (event.elapsedMs >= setters.compactStallHintMs) {
				setters.setSpinnerMessage(
					`Compacting conversation — running ${formatDuration(event.elapsedMs)}, large context summaries can take a while`,
				);
			}
			break;
		case "compact_end":
			setters.setSpinnerMessage(null);
			setters.setSpinnerColor(null);
			setters.setSpinnerShimmerColor(null);
			break;
	}
}
