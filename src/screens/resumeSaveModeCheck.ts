// audit 1.1.1 slice #67: resume COORDINATOR_MODE saveMode sub-block extracted (PURE-ROUTING-SUB-BLOCK, resume-chunked-extraction #7).
// resume() useCallback body sub-block (REPL L2001-2008, 8 LOC): inside the feature("COORDINATOR_MODE") guard —
// require("../utils/sessionStorage.js").saveMode + require("../coordinator/coordinatorMode.js").isCoordinatorMode() →
// saveMode(isCoordinatorMode() ? "coordinator" : "normal") [persists the current mode for later resume decisions].
// slice #63 sibling pattern: the feature-gate moves into the helper as an early-return (feature() is a bun:bundle build-time macro, proven movable into a helper by onCancelCheck #59 / resumeCoordinatorModeCheck #63);
// require() dynamic imports (saveMode/isCoordinatorMode) stay inside the helper (original require style, feature-gated dead-code elimination).
// No ctx (pure side effects, no dependency on resume-local or REPL state — isCoordinatorMode reads the global mode).
// Helper returns void. No JSX → .ts. No deps (called in the resume body, not a hook).
// Note: this is chunk #7 of the resume chunked extraction (COORDINATOR_MODE saveMode, #63 sibling, feature-gated require).

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
