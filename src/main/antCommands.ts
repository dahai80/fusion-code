// [ANT-ONLY] subcommand group registration, extracted from main.tsx
// (issue #133 god-module split). Gated by isInternalBuild(); actions delegate
// to ./cli/handlers/ant.js via dynamic import.

import type { CommanderCommand } from "./commandHelpers.js";
import { isInternalBuild } from "../utils/buildConstants.js";
import { validateUuid } from "../utils/uuid.js";
import { TASK_STATUSES } from "../utils/tasks.js";

export function registerAntCommands(program: CommanderCommand): void {
	// All subcommands below are ant-only and dead-code-eliminated in external
	// builds via isInternalBuild().
	if (!isInternalBuild()) {
		return;
	}
	const validateLogId = (value: string) => {
		const maybeSessionId = validateUuid(value);
		if (maybeSessionId) return maybeSessionId;
		return Number(value);
	};
	// claude log
	program
		.command("log")
		.description("[ANT-ONLY] Manage conversation logs.")
		.argument(
			"[number|sessionId]",
			"A number (0, 1, 2, etc.) to display a specific log, or the sesssion ID (uuid) of a log",
			validateLogId,
		)
		.action(async (logId: string | number | undefined) => {
			const { logHandler } = await import("../cli/handlers/ant.js");
			await logHandler(logId);
		});

	// claude error
	program
		.command("error")
		.description(
			"[ANT-ONLY] View error logs. Optionally provide a number (0, -1, -2, etc.) to display a specific log.",
		)
		.argument(
			"[number]",
			"A number (0, 1, 2, etc.) to display a specific log",
			parseInt,
		)
		.action(async (number: number | undefined) => {
			const { errorHandler } = await import("../cli/handlers/ant.js");
			await errorHandler(number);
		});

	// claude export
	program
		.command("export")
		.description("[ANT-ONLY] Export a conversation to a text file.")
		.usage("<source> <outputFile>")
		.argument(
			"<source>",
			"Session ID, log index (0, 1, 2...), or path to a .json/.jsonl log file",
		)
		.argument("<outputFile>", "Output file path for the exported text")
		.addHelpText(
			"after",
			`
Examples:
  $ claude export 0 conversation.txt                Export conversation at log index 0
  $ claude export <uuid> conversation.txt           Export conversation by session ID
  $ claude export input.json output.txt             Render JSON log file to text
  $ claude export <uuid>.jsonl output.txt           Render JSONL session file to text`,
		)
		.action(async (source: string, outputFile: string) => {
			const { exportHandler } = await import("../cli/handlers/ant.js");
			await exportHandler(source, outputFile);
		});
	if (isInternalBuild()) {
		const taskCmd = program
			.command("task")
			.description("[ANT-ONLY] Manage task list tasks");
		taskCmd
			.command("create <subject>")
			.description("Create a new task")
			.option("-d, --description <text>", "Task description")
			.option("-l, --list <id>", 'Task list ID (defaults to "tasklist")')
			.action(
				async (
					subject: string,
					opts: {
						description?: string;
						list?: string;
					},
				) => {
					const { taskCreateHandler } = await import("../cli/handlers/ant.js");
					await taskCreateHandler(subject, opts);
				},
			);
		taskCmd
			.command("list")
			.description("List all tasks")
			.option("-l, --list <id>", 'Task list ID (defaults to "tasklist")')
			.option("--pending", "Show only pending tasks")
			.option("--json", "Output as JSON")
			.action(
				async (opts: {
					list?: string;
					pending?: boolean;
					json?: boolean;
				}) => {
					const { taskListHandler } = await import("../cli/handlers/ant.js");
					await taskListHandler(opts);
				},
			);
		taskCmd
			.command("get <id>")
			.description("Get details of a task")
			.option("-l, --list <id>", 'Task list ID (defaults to "tasklist")')
			.action(
				async (
					id: string,
					opts: {
						list?: string;
					},
				) => {
					const { taskGetHandler } = await import("../cli/handlers/ant.js");
					await taskGetHandler(id, opts);
				},
			);
		taskCmd
			.command("update <id>")
			.description("Update a task")
			.option("-l, --list <id>", 'Task list ID (defaults to "tasklist")')
			.option(
				"-s, --status <status>",
				`Set status (${TASK_STATUSES.join(", ")})`,
			)
			.option("--subject <text>", "Update subject")
			.option("-d, --description <text>", "Update description")
			.option("--owner <agentId>", "Set owner")
			.option("--clear-owner", "Clear owner")
			.action(
				async (
					id: string,
					opts: {
						list?: string;
						status?: string;
						subject?: string;
						description?: string;
						owner?: string;
						clearOwner?: boolean;
					},
				) => {
					const { taskUpdateHandler } = await import("../cli/handlers/ant.js");
					await taskUpdateHandler(id, opts);
				},
			);
		taskCmd
			.command("dir")
			.description("Show the tasks directory path")
			.option("-l, --list <id>", 'Task list ID (defaults to "tasklist")')
			.action(async (opts: { list?: string }) => {
				const { taskDirHandler } = await import("../cli/handlers/ant.js");
				await taskDirHandler(opts);
			});
	}

	// claude completion <shell>
	program
		.command("completion <shell>", {
			hidden: true,
		})
		.description("Generate shell completion script (bash, zsh, or fish)")
		.option(
			"--output <file>",
			"Write completion script directly to a file instead of stdout",
		)
		.action(
			async (
				shell: string,
				opts: {
					output?: string;
				},
			) => {
				const { completionHandler } = await import("../cli/handlers/ant.js");
				await completionHandler(shell, opts, program);
			},
		);
}
