// log: created for TS2307 fix

import type React from "react";
import type { MonitorMcpTaskState } from "../../tasks/MonitorMcpTask/MonitorMcpTask.js";

type Props = {
	task: MonitorMcpTaskState;
	onKill?: () => void;
	onBack: () => void;
};

export function MonitorMcpDetailDialog(props: Props): React.ReactNode {
	console.log("[MonitorMcpDetailDialog] render (stub)", props.task.id);
	return null;
}
