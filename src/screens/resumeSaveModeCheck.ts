// audit 1.1.1 slice #67: resume COORDINATOR_MODE saveMode sub-block 外移 (PURE-ROUTING-SUB-BLOCK, resume-chunked-extraction #7)。
// resume() useCallback body 子块 (REPL L2001-2008, 8-LOC): feature("COORDINATOR_MODE") 守卫内 —
// require("../utils/sessionStorage.js").saveMode + require("../coordinator/coordinatorMode.js").isCoordinatorMode() →
// saveMode(isCoordinatorMode() ? "coordinator" : "normal") [持久化当前 mode, 供后续 resume 判断]。
// slice #63 兄弟模式: feature-gate 移入 helper 作 early-return (feature() bun:bundle build-time 宏, 已由 onCancelCheck #59 / resumeCoordinatorModeCheck #63 证明可移入 helper);
// require() 动态导入 (saveMode/isCoordinatorMode) 保留在 helper 内 (原 require 写法, feature-gated 死代码消除)。
// 无 ctx (纯副作用, 不依赖 resume-local 或 REPL state — isCoordinatorMode 读全局 mode)。
// 辅助返 void。无 JSX → .ts。无 deps (resume body 调用, 非 hook)。
// 注: 此为 resume 切块提取的第 7 块 (COORDINATOR_MODE saveMode, #63 兄弟, feature-gated require)。

import { feature } from "bun:bundle";

export function persistResumeMode(): void {
	if (!feature("COORDINATOR_MODE")) {
		return;
	}
	/* eslint-disable @typescript-eslint/no-require-imports */
	const { saveMode } = require("../utils/sessionStorage.js");
	const { isCoordinatorMode } =
		require("../coordinator/coordinatorMode.js") as typeof import("../coordinator/coordinatorMode.js");
	/* eslint-enable @typescript-eslint/no-require-imports */
	saveMode(isCoordinatorMode() ? "coordinator" : "normal");
}
