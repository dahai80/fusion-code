// audit 1.1.1 slice #47: $5 cost-threshold dialog useEffect body 外移 (PURE-ROUTING-SUB-BLOCK, like #27/#28/#35/#41-#45)。
// REPL() 在 totalCost ≥ $5 且未弹过时 fire-once: logEvent tengu_cost_threshold_reached + setHaveShownCostDialog(true) (防 rest-of-session 每消息重发, GH 200k+ spurious) + 若 hasConsoleBillingAccess 则 setShowCostDialog(true)。
// 原 useEffect body。showCostDialog/haveShownCostDialog (derived deps) + setShowCostDialog/setHaveShownCostDialog (useState setters) 经 ctx 传入 (闭包捕获), 行为字节等价。
// useEffect() hook 留 REPL 薄壳 (hook 规则, 不能移 plain helper), 仅 effect body 移出。
// getTotalCost (cost-tracker.js) + hasConsoleBillingAccess (utils/billing.js) + logEvent (services/analytics/index.js) 直接 import (非 REPL state, per imported-helpers-directly rule; 全部 REPL 多用, 不移除 REPL import)。
// 无 JSX → .ts。返 void (REPL 薄壳 useEffect 透传, 无 cleanup)。
// deps [messages, showCostDialog, haveShownCostDialog] 不变 (messages 仅作触发器, body 不读, 但移除改变触发时机 — 保留; setters 稳定引用省略, 与原一致)。

import { logEvent } from "src/services/analytics/index.js";
import { getTotalCost } from "../cost-tracker.js";
import { hasConsoleBillingAccess } from "../utils/billing.js";

type CostThresholdCheckCtx = {
	showCostDialog: boolean;
	haveShownCostDialog: boolean;
	setShowCostDialog: (value: boolean) => void;
	setHaveShownCostDialog: (value: boolean) => void;
};

// REPL 保留 useEffect 薄壳:
//   useEffect(() => maybeShowCostThreshold({ showCostDialog, haveShownCostDialog, setShowCostDialog, setHaveShownCostDialog }), [messages, showCostDialog, haveShownCostDialog]);
export function maybeShowCostThreshold(ctx: CostThresholdCheckCtx): void {
	const totalCost = getTotalCost();
	if (
		totalCost >= 5 /* $5 */ &&
		!ctx.showCostDialog &&
		!ctx.haveShownCostDialog
	) {
		logEvent("tengu_cost_threshold_reached", {});
		// Mark as shown even if the dialog won't render (no console billing
		// access). Otherwise this effect re-fires on every message change for
		// the rest of the session — 200k+ spurious events observed.
		ctx.setHaveShownCostDialog(true);
		if (hasConsoleBillingAccess()) {
			ctx.setShowCostDialog(true);
		}
	}
}
