// log: created for TS2307 fix

import type React from "react";
import type { SetAppState } from "../../Task.js";
import type { LocalWorkflowTaskState } from "../../tasks/LocalWorkflowTask/LocalWorkflowTask.js";

type Props = {
	workflow: LocalWorkflowTaskState;
	onDone: (message: string, options?: { display?: string }) => void;
	onKill?: () => void;
	onSkipAgent?: (agentId: string) => void;
	onRetryAgent?: (agentId: string) => void;
	onBack: () => void;
};

export function WorkflowDetailDialog(props: Props): React.ReactNode {
	console.log("[WorkflowDetailDialog] render (stub)", props.workflow.id);
	return null;
}
