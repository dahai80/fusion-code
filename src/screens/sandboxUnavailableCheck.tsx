// audit 1.1.1 slice #43: sandbox-unavailable mount effect body extracted (PURE-ROUTING-SUB-BLOCK, like #27/#28/#35/#41/#42).
// REPL() detects the sandbox-unavailable reason on mount: isSandboxRequired → stderr + gracefulShutdownSync(1) refuses startup; otherwise logForDebugging + addNotification with the "sandbox disabled · /sandbox" hint.
// Original useEffect body. addNotification passed via ctx (closure capture), byte-equivalent behavior.
// The useEffect() hook stays as a REPL thin shell (hook rules, cannot move to a plain helper); only the effect body moves out.
// SandboxManager (src/utils/sandbox) + gracefulShutdownSync + logForDebugging + Text(ink) imported directly (not REPL state, per imported-helpers-directly rule; all used multiple times in REPL, REPL imports not removed).
// Generates JSX (notification.jsx) → .tsx. Returns void (REPL thin-shell useEffect pass-through, no cleanup).
// deps [addNotification] unchanged (addNotification is a stable useCallback ref, fire-once, matching the original).

import { SandboxManager } from "src/utils/sandbox/sandbox-adapter.js";
import type { Notification } from "../context/notifications.js";
import { Text } from "../ink.js";
import { logForDebugging } from "../utils/debug.js";
import { gracefulShutdownSync } from "../utils/gracefulShutdown.js";

type SandboxUnavailableCheckCtx = {
	addNotification: (content: Notification) => void;
};

// REPL keeps the useEffect thin shell:
//   useEffect(() => maybeShowSandboxUnavailable({ addNotification }), [addNotification]);
export function maybeShowSandboxUnavailable(
	ctx: SandboxUnavailableCheckCtx,
): void {
	const reason = SandboxManager.getSandboxUnavailableReason();
	if (!reason) return;
	if (SandboxManager.isSandboxRequired()) {
		process.stderr.write(
			`\nError: sandbox required but unavailable: ${reason}\n` +
				`  sandbox.failIfUnavailable is set — refusing to start without a working sandbox.\n\n`,
		);
		gracefulShutdownSync(1, "other");
		return;
	}
	logForDebugging(`sandbox disabled: ${reason}`, {
		level: "warn",
	});
	ctx.addNotification({
		key: "sandbox-unavailable",
		jsx: (
			<>
				<Text color="warning">sandbox disabled</Text>
				<Text dimColor> · /sandbox</Text>
			</>
		),
		priority: "medium",
	});
}
