// audit 1.1.1 slice #47: $5 cost-threshold dialog useEffect body extracted (PURE-ROUTING-SUB-BLOCK, like #27/#28/#35/#41-#45).
// REPL() fires once when totalCost ≥ $5 and not yet shown: logEvent fusion_cost_threshold_reached + setHaveShownCostDialog(true) (prevents re-firing on every message for the rest of the session, GH 200k+ spurious) + setShowCostDialog(true) if hasConsoleBillingAccess.
// Original useEffect body. showCostDialog/haveShownCostDialog (derived deps) + setShowCostDialog/setHaveShownCostDialog (useState setters) passed via ctx (closure capture), byte-equivalent behavior.
// The useEffect() hook stays as a REPL thin shell (hook rules, cannot move to a plain helper); only the effect body moves out.
// getTotalCost (cost-tracker.js) + hasConsoleBillingAccess (utils/billing.js) + logEvent (services/analytics/index.js) imported directly (not REPL state, per imported-helpers-directly rule; all used multiple times in REPL, REPL imports kept).
// No JSX → .ts. Returns void (REPL thin-shell useEffect pass-through, no cleanup).
// deps [messages, showCostDialog, haveShownCostDialog] unchanged (messages is trigger-only, the body never reads it, but removing it changes trigger timing — kept; setters are stable refs and omitted, matching the original).

import { logEvent } from "src/services/analytics/index.js";
import { getTotalCost } from "../cost-tracker.js";
import { hasConsoleBillingAccess } from "../utils/billing.js";

type CostThresholdCheckCtx = {
	showCostDialog: boolean;
	haveShownCostDialog: boolean;
	setShowCostDialog: (value: boolean) => void;
	setHaveShownCostDialog: (value: boolean) => void;
};

// REPL keeps the useEffect thin shell:
//   useEffect(() => maybeShowCostThreshold({ showCostDialog, haveShownCostDialog, setShowCostDialog, setHaveShownCostDialog }), [messages, showCostDialog, haveShownCostDialog]);
export function maybeShowCostThreshold(ctx: CostThresholdCheckCtx): void {
	const totalCost = getTotalCost();
	if (
		totalCost >= 5 /* $5 */ &&
		!ctx.showCostDialog &&
		!ctx.haveShownCostDialog
	) {
		logEvent("fusion_cost_threshold_reached", {});
		// Mark as shown even if the dialog won't render (no console billing
		// access). Otherwise this effect re-fires on every message change for
		// the rest of the session — 200k+ spurious events observed.
		ctx.setHaveShownCostDialog(true);
		if (hasConsoleBillingAccess()) {
			ctx.setShowCostDialog(true);
		}
	}
}
