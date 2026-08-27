import {
	isTurnSnapshotEnabled,
	listTurnSnapshots,
	rollbackToTurn,
} from "../../services/executor/turnSnapshot.js";
import type {
	LocalJSXCommandCall,
	LocalJSXCommandOnDone,
} from "../../types/command.js";
import { logForDebugging } from "../../utils/debug.js";

export const call: LocalJSXCommandCall = async (
	onDone: LocalJSXCommandOnDone,
	_context,
	args: string,
) => {
	if (!isTurnSnapshotEnabled()) {
		onDone(
			"/rollback is disabled. Set FUSION_CODE_EXECUTOR_ENABLED=1 and FUSION_CODE_EXECUTOR_TURN_SNAPSHOT=1 to enable turn-boundary snapshots.",
		);
		return null;
	}

	const trimmed = args.trim();
	const snaps = listTurnSnapshots();

	if (snaps.length === 0) {
		onDone(
			"No turn snapshots available. Snapshots are taken at the start of each turn when enabled.",
		);
		return null;
	}

	const targetId = trimmed || undefined;
	if (trimmed) {
		const exists = snaps.some((s) => s.turnId === trimmed);
		if (!exists) {
			onDone(
				`No snapshot found for turn "${trimmed}". Available turns: ${snaps.map((s) => s.turnId.slice(0, 8)).join(", ")}`,
			);
			return null;
		}
	}

	logForDebugging(
		`/rollback: reverting to turn ${targetId ?? snaps[snaps.length - 1].turnId}`,
	);
	const ok = await rollbackToTurn(targetId);
	if (ok) {
		onDone(
			`Working tree reverted to before turn ${targetId ?? snaps[snaps.length - 1].turnId}. Run \`git status\` to inspect.`,
		);
	} else {
		onDone(
			`Rollback failed for turn ${targetId ?? snaps[snaps.length - 1].turnId}. Check logs (FUSION_CODE_DEBUG=1) — executor may be unavailable or the snapshot was already rolled back.`,
		);
	}
	return null;
};
