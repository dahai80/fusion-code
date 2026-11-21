import { isEnvTruthy } from "../../utils/envUtils.js";

// item 12 (CC 2.1.198/232): subagent auto-background threshold parsing.
// Parallel item 4 FUSION_MCP_AUTO_BACKGROUND_MS (src/services/mcp/client.ts).
// FUSION_SUBAGENT_AUTO_BACKGROUND_MS set to a positive value → subagent moves to background after that many ms,
// reusing the registerAgentForeground timer→backgroundSignal→mid-run backgrounding to unblock the turn.
// default 0=off, byte-identical old behavior.
export function getSubagentAutoBackgroundMs(): number {
	const raw = process.env.FUSION_SUBAGENT_AUTO_BACKGROUND_MS;
	if (raw === undefined || raw === "") {
		return 0;
	}
	const parsed = parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return 0;
	}
	return parsed;
}

// Dimension 5 (P2.1): subagent default-background-at-spawn switch.
// Orthogonal to item 12 FUSION_SUBAGENT_AUTO_BACKGROUND_MS: item 12 is the foreground
// else-branch mid-run backgrounding timer; this switch is async-from-start (background at spawn).
// Adds the 6th || clause to shouldRunAsync with a !isInProcessTeammate() guard (in-process teammates
// have their lifecycle bound to the leader process and cannot be backgrounded, matching the existing throw pattern at line 455).
// default off (isEnvTruthy unset/empty/false/0 → false), byte-identical old behavior.
export function isSubagentDefaultBackground(): boolean {
	return isEnvTruthy(process.env.FUSION_SUBAGENT_DEFAULT_BACKGROUND);
}
