// insight-0902 E3: snapshot of the most recent compaction (session-scope in-memory side-channel).
//
// Consumed by the /diff-compaction audit command to display the shadow-price prune-candidate scoring table.
// In-memory only, process-wide singleton, not persisted, does not participate in compaction logic itself (pure bypass recording).
// fail-open: a recording failure is only logged and never affects compaction.

import { logForDebugging } from "../../utils/debug.js";
import type { PruneCandidate } from "./shadowPrice.js";

export interface CompactionSnapshot {
	timestamp: number;
	provider: "shadow-price" | "hard-tail" | "none";
	candidates: PruneCandidate[];
	priceThreshold: number | undefined;
	truncatedToolResults: number;
	truncatedAssistantTexts: number;
	roundsKeptIntact: number;
	roundsProcessed: number;
	preCompactTokens: number;
	postCompactTokens: number;
	prunedCandidateCount: number;
}

let lastSnapshot: CompactionSnapshot | undefined;

// Record the most recent compaction snapshot. fail-open.
export function recordCompactionSnapshot(snapshot: CompactionSnapshot): void {
	try {
		lastSnapshot = snapshot;
		logForDebugging(
			`[CompactSnapshot] recorded provider=${snapshot.provider} candidates=${snapshot.candidates.length} pruned=${snapshot.prunedCandidateCount}`,
		);
	} catch (e) {
		logForDebugging(
			`[CompactSnapshot] record failed (fail-open): ${(e as Error).message}`,
		);
	}
}

export function getLastCompactionSnapshot(): CompactionSnapshot | undefined {
	return lastSnapshot;
}

export function clearCompactionSnapshot(): void {
	lastSnapshot = undefined;
}
