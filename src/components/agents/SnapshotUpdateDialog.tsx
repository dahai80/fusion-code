import { useEffect } from "react";

type Props = {
	agentType: string;
	scope: unknown;
	snapshotTimestamp: string;
	onComplete: (choice: "merge" | "keep" | "replace") => void;
	onCancel: () => void;
};

export function SnapshotUpdateDialog({ onCancel }: Props) {
	useEffect(() => {
		onCancel();
	}, [onCancel]);

	return null;
}

/**
 * Build a merge prompt for snapshot update dialog.
 * log: fix TS2339
 */
export function buildMergePrompt(agentType: string, _scope: unknown): string {
	return `[Snapshot Update] Agent "${agentType}" has a pending snapshot update. Merge incoming changes with existing memory.`;
}
