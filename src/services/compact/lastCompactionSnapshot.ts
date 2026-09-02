// insight-0902 E3: 最近一次压缩快照 (session-scope 内存 side-channel)。
//
// 供 /diff-compaction 审计命令展示影子价裁剪候选评分表。
// 仅内存, 进程内单例, 不持久化, 不参与压缩逻辑本身 (纯旁路记录)。
// fail-open: 记录失败只记日志, 不影响压缩。

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

// 记录最近一次压缩快照。fail-open。
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
