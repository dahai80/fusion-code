// audit 1.1.1 slice #60: SandboxManager init if-block extracted (PURE-ROUTING-SUB-BLOCK render-body variant, like #43).
// REPL() during render: SandboxManager.isSandboxingEnabled() true → SandboxManager.initialize(sandboxAskCallback) async init,
// on failure writes the error to stderr + gracefulShutdownSync(1, "other") refuses startup. This is the sibling block of slice #43 (sandboxUnavailableCheck),
// sharing the SandboxManager + gracefulShutdownSync + stderr pattern. Original top-level render body (not a useEffect, runs each render, matching the original).
// SandboxManager (src/utils/sandbox/sandbox-adapter) + errorMessage (utils/errors) + gracefulShutdownSync (utils/gracefulShutdown) imported directly
// (not REPL state, per imported-helpers-directly rule; used multiple times in REPL, REPL import kept).
// sandboxAskCallback (REPL-local useCallback L2310, closure-captures store/setAppState/setSandboxPermissionRequestQueue/sandboxBridgeCleanupRef) passed via ctx.
// Helper returns void (REPL render-time thin-shell pass-through, not a hook, no cleanup). No JSX → .ts. No deps (render body, not a hook).

import { SandboxManager } from "src/utils/sandbox/sandbox-adapter.js";
import { errorMessage } from "../utils/errors.js";
import { gracefulShutdownSync } from "../utils/gracefulShutdown.js";
import type { SandboxAskCallback } from "../utils/sandbox/sandbox-adapter.js";

type SandboxInitCtx = {
	sandboxAskCallback: SandboxAskCallback;
};

// REPL keeps the plain thin shell (called each render, equivalent to the original top-level if-block semantics):
//   if (SandboxManager.isSandboxingEnabled()) { maybeInitSandbox({ sandboxAskCallback }); }
// Note: whether the original if guard stays in REPL or moves into the helper — chose to keep it inside the helper (the guard is part of the init logic, moving it out is more cohesive).
// But for minimal diff + byte equivalence, the REPL thin shell still keeps the if (SandboxManager.isSandboxingEnabled()) guard; the helper only does init+catch.
export function maybeInitSandbox(ctx: SandboxInitCtx): void {
	SandboxManager.initialize(ctx.sandboxAskCallback).catch((err: unknown) => {
		// Initialization/validation failed - display error and exit
		process.stderr.write(`\n❌ Sandbox Error: ${errorMessage(err)}\n`);
		gracefulShutdownSync(1, "other");
	});
}
