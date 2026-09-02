// insight-0902 E3: /diff-compaction 实现 — 渲染最近一次压缩快照的影子价候选评分表。
// 纯展示, 无副作用。读 lastCompactionSnapshot 内存旁路。

import { getLastCompactionSnapshot } from "../../services/compact/index.js";
import type { LocalCommandCall } from "../../types/command.js";

// 候选表行: toolUseId / roundIndex / sizeTokens / shadowPrice / 是否被裁。
function renderCandidateRow(
	row: ReturnType<typeof rowProps>,
	truncated: boolean,
): string {
	const id =
		(row.toolUseId ?? "—").slice(0, 16).padEnd(16) +
		(row.toolUseId && row.toolUseId.length > 16 ? "…" : " ");
	const mark = truncated ? "✂️" : "  ";
	return `${mark} ${id} r${String(row.roundIndex).padStart(2)}  ${String(
		row.sizeTokens,
	).padStart(6)}tok  price=${row.shadowPrice.toFixed(2).padStart(6)}`;
}

function rowProps(c: {
	roundIndex: number;
	toolUseId: string | undefined;
	shadowPrice: number;
	sizeTokens: number;
}) {
	return {
		roundIndex: c.roundIndex,
		toolUseId: c.toolUseId,
		shadowPrice: c.shadowPrice,
		sizeTokens: c.sizeTokens,
	};
}

export const call: LocalCommandCall = async () => {
	const snapshot = getLastCompactionSnapshot();
	if (!snapshot) {
		return {
			type: "text",
			value:
				"No compaction snapshot yet. Run a hard/shadow-price compact first, then /diff-compaction.",
		};
	}

	const lines: string[] = [];
	lines.push("┌─ Last compaction snapshot ──────────────────────");
	lines.push(`│ provider: ${snapshot.provider}`);
	lines.push(
		`│ rounds: processed=${snapshot.roundsProcessed} keptIntact=${snapshot.roundsKeptIntact}`,
	);
	lines.push(
		`│ tokens: ${snapshot.preCompactTokens} → ${snapshot.postCompactTokens} (−${snapshot.preCompactTokens - snapshot.postCompactTokens})`,
	);
	lines.push(
		`│ truncated: toolResults=${snapshot.truncatedToolResults} assistantTexts=${snapshot.truncatedAssistantTexts}`,
	);
	if (snapshot.priceThreshold !== undefined) {
		lines.push(
			`│ shadow-price threshold: ${snapshot.priceThreshold.toFixed(2)} (≥ pruned)`,
		);
	}
	lines.push("└──────────────────────────────────────────────────");

	if (snapshot.candidates.length === 0) {
		lines.push(
			"(no shadow-price candidates — provider was hard-tail or no old rounds)",
		);
		return { type: "text", value: lines.join("\n") };
	}

	lines.push("");
	lines.push("Shadow-price prune candidates (desc by price):");
	lines.push("   toolUseId          round  size    price   ✂️=pruned");
	const thr = snapshot.priceThreshold;
	for (const c of snapshot.candidates) {
		const truncated = thr !== undefined ? c.shadowPrice >= thr : false;
		lines.push(renderCandidateRow(rowProps(c), truncated));
	}
	lines.push("");
	lines.push(
		`total candidates: ${snapshot.candidates.length}, pruned: ${snapshot.prunedCandidateCount}`,
	);

	return { type: "text", value: lines.join("\n") };
};
