import { recoverTasks } from "../../services/taskHealth/index.js";
import { getNotificationManager } from "../../services/taskHealth/index.js";
import { checkTaskHealth } from "../../services/taskHealth/index.js";
import { killAllActive } from "../../tasks/stopTask.js";
import type {
	CommandContext,
	LocalCommandResult,
} from "../../types/command.js";

type HealthArgs = {
	action?: string;
};

export async function execute(
	context: CommandContext,
	args?: string,
): Promise<LocalCommandResult> {
	const action = args?.trim().toLowerCase();

	if (action === "recover") {
		return executeRecover(context);
	}

	if (action === "kill-all") {
		return executeKillAll(context);
	}

	return executeStatus(context);
}

async function executeStatus(
	context: CommandContext,
): Promise<LocalCommandResult> {
	const tasks = Object.values(context.getAppState().tasks ?? {});
	const runningTasks = tasks.filter((t: any) => t.status === "running");
	const healthChecks = checkTaskHealth(
		tasks.map((t: any) => ({
			taskId: t.taskId ?? t.id,
			taskType: t.type,
			status: t.status,
			description: t.description ?? t.command ?? "",
			startedAt: t.startedAt,
			lastUpdatedAt: t.lastUpdatedAt ?? t.updatedAt,
		})),
	);

	const nm = getNotificationManager();
	const notifications = nm.getUnread();
	nm.markRead();

	const lines: string[] = [];

	lines.push("═══ Task Health Status ═══");
	lines.push("");
	lines.push(`Running tasks: ${runningTasks.length}`);
	lines.push(`Total tasks: ${tasks.length}`);

	const unhealthy = healthChecks.filter((h) => h.health !== "healthy");
	if (unhealthy.length > 0) {
		lines.push("");
		lines.push("⚠ Unhealthy tasks:");
		for (const h of unhealthy) {
			const icon = h.health === "lost" ? "✗" : "⚡";
			lines.push(`  ${icon} ${h.taskId}: ${h.health} — ${h.reason}`);
		}
	}

	if (notifications.length > 0) {
		lines.push("");
		lines.push("📬 Notifications:");
		for (const n of notifications) {
			const icon =
				n.severity === "error"
					? "✗"
					: n.severity === "warning"
						? "⚡"
						: n.severity === "success"
							? "✓"
							: "ℹ";
			lines.push(`  ${icon} [${n.event}] ${n.summary}`);
		}
	}

	lines.push("");
	lines.push("Commands: /health recover  /health kill-all");

	return { type: "text", value: lines.join("\n") } as LocalCommandResult; // log: fixed output→type/value for LocalCommandResult
}

async function executeRecover(
	context: CommandContext,
): Promise<LocalCommandResult> {
	const tasks = Object.values(context.getAppState().tasks ?? {});
	const report = recoverTasks(
		tasks.map((t: any) => ({
			taskId: t.taskId ?? t.id,
			taskType: t.type,
			status: t.status,
			description: t.description ?? t.command ?? "",
			startedAt: t.startedAt,
			lastUpdatedAt: t.lastUpdatedAt ?? t.updatedAt,
		})),
	);

	const lines: string[] = [];
	lines.push("═══ Crash Recovery ═══");
	lines.push("");
	lines.push(`Total tasks scanned: ${report.total}`);
	lines.push(`Already terminal: ${report.alreadyTerminal}`);
	lines.push(`Lost (was running): ${report.lost}`);
	lines.push(`Recovered (pending): ${report.recovered}`);

	if (report.lost > 0) {
		const nm = getNotificationManager();
		lines.push("");
		lines.push(`📬 ${nm.unreadCount()} new notifications from recovery`);
	}

	return { type: "text", value: lines.join("\n") } as LocalCommandResult; // log: fixed output→type/value for LocalCommandResult
}

async function executeKillAll(
	context: CommandContext,
): Promise<LocalCommandResult> {
	const killed = await killAllActive({
		getAppState: () => context.getAppState(),
		setAppState: (f) => context.setAppState(f),
	});

	const lines: string[] = [];
	lines.push("═══ Kill All Active Tasks ═══");
	lines.push("");

	if (killed.length === 0) {
		lines.push("No active tasks to kill.");
	} else {
		lines.push(`Killed ${killed.length} task(s):`);
		for (const id of killed) {
			lines.push(`  ✗ ${id}`);
		}
	}

	return { type: "text", value: lines.join("\n") } as LocalCommandResult; // log: fixed output→type/value for LocalCommandResult
}
