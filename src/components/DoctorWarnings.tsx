import type React from "react";
import { useState } from "react";
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw "f" to trigger auto-fix, same class as y/n in DesktopHandoff
import { Box, Text, useInput } from "../ink.js";
import { logForDebugging } from "../utils/debug.js";

export type DoctorWarning = {
	issue: string;
	fix: string;
	fixAction?: () => Promise<unknown>;
};

type Props = {
	warnings: DoctorWarning[];
};

export type FixState =
	| { kind: "idle" }
	| { kind: "running" }
	| { kind: "done"; message: string }
	| { kind: "error"; message: string };

const ACTIONABLE_HINT = "Press f to run auto-fix. Re-run /doctor to verify.";

export function DoctorWarnings(props: Props): React.ReactNode {
	const { warnings } = props;
	const [fixState, setFixState] = useState<FixState>({ kind: "idle" });

	const actionable = warnings.filter((w) => typeof w.fixAction === "function");
	const hasActionable = actionable.length > 0;

	useInput((input) => {
		if (!hasActionable) {
			return;
		}
		if (fixState.kind === "running") {
			return;
		}
		if (input !== "f" && input !== "F") {
			return;
		}
		runAutoFix(actionable, setFixState);
	});

	return (
		<Box flexDirection="column">
			<Text />
			{warnings.map((warning, i) => (
				<Box key={warning.issue || i} flexDirection="column">
					<Text color="warning">Warning: {warning.issue}</Text>
					<Text>Fix: {warning.fix}</Text>
				</Box>
			))}
			{hasActionable ? (
				<Box flexDirection="column" marginTop={1}>
					{fixState.kind === "idle" ? (
						<Text dimColor>{ACTIONABLE_HINT}</Text>
					) : null}
					{fixState.kind === "running" ? (
						<Text color="cyan">Running auto-fix…</Text>
					) : null}
					{fixState.kind === "done" ? (
						<Text color="green">{fixState.message}</Text>
					) : null}
					{fixState.kind === "error" ? (
						<Text color="error">{fixState.message}</Text>
					) : null}
				</Box>
			) : null}
		</Box>
	);
}

export async function runAutoFix(
	actionable: DoctorWarning[],
	setFixState: (s: FixState) => void,
): Promise<void> {
	setFixState({ kind: "running" });
	logForDebugging(
		`doctor fixAction: running auto-fix (count=${actionable.length})`,
	);
	let ok = 0;
	let failed = 0;
	const errors: string[] = [];
	for (const warning of actionable) {
		if (!warning.fixAction) {
			continue;
		}
		try {
			const res = await warning.fixAction();
			ok++;
			logForDebugging(
				`doctor fixAction: success issue=${warning.issue} result=${JSON.stringify(res)}`,
			);
		} catch (err) {
			failed++;
			const msg = err instanceof Error ? err.message : String(err);
			errors.push(`${warning.issue}: ${msg}`);
			logForDebugging(
				`doctor fixAction: error issue=${warning.issue} error=${msg}`,
				{ level: "error" },
			);
		}
	}
	if (failed === 0) {
		setFixState({
			kind: "done",
			message: `Auto-fix applied (${ok} action${ok === 1 ? "" : "s"}). Re-run /doctor to verify.`,
		});
	} else if (ok === 0) {
		setFixState({
			kind: "error",
			message: `Auto-fix failed: ${errors.join("; ")}`,
		});
	} else {
		setFixState({
			kind: "error",
			message: `Auto-fix partial: ${ok} ok, ${failed} failed (${errors.join("; ")}).`,
		});
	}
}
