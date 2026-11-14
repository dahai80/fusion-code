// Issue #268 (T4a): `fusion-code team ...` fast-path CLI — manifest-based
// team registration over agent-studio teams.* RPC. Pure RPC consumer; no
// team kernel code in fusion-code (upstream agent-studio #707).
//
// Subcommands:
//   team register <manifest.json>   register team + initial tasks
//   team status [team]              board state (or list all teams)
//   team task add <team> <title>    add a task (--detail, --assignee)
//   team send <team> <member> <msg> mailbox send (--from, default "lead")
//   team disband <team>             disband (--keep-inboxes to skip cleanup)
import { cwd } from "node:process";
import {
	createStudioClient,
	loadTeamManifest,
	ManifestError,
	type StudioRpcClient,
	StudioRpcError,
} from "../../services/teams";

const USAGE = `usage: fusion-code team <subcommand> [args]

subcommands:
  register <manifest.json>          register team + initial tasks from manifest
  status [team]                     show one team's board (or list all teams)
  task add <team> <title>           add a task (--detail TEXT, --assignee MEMBER)
  send <team> <member> <message>    send a mailbox message (--from SENDER, default "lead")
  disband <team>                    disband the team (--keep-inboxes)`;

// ok()/fail() terminate via an ExitSignal instead of calling process.exit
// directly: cmd bodies run inside teamMain's try/catch, and a thrown exit
// sentinel must NOT be swallowed there (process.exit in Bun throws nothing,
// but the sentinel lets tests observe the code; teamMain re-dispatches it).
class ExitSignal extends Error {
	code: number;

	constructor(code: number) {
		super(`__team_exit__${code}`);
		this.name = "ExitSignal";
		this.code = code;
	}
}

function fail(message: string): never {
	process.stderr.write(`error: ${message}\n`);
	throw new ExitSignal(1);
}

function ok(result: unknown): never {
	process.stdout.write(`${JSON.stringify(result, null, 4)}\n`);
	throw new ExitSignal(0);
}

function die(e: unknown): never {
	// Only reached for non-sentinel errors (teamMain filters ExitSignal
	// first), so exiting directly here is safe.
	if (e instanceof ManifestError || e instanceof StudioRpcError) {
		process.stderr.write(`error: ${e.message}\n`);
	} else {
		process.stderr.write(`error: ${String(e)}\n`);
	}
	process.exit(1);
}

function isDuplicateTeamError(message: string): boolean {
	return /already registered/.test(message);
}

async function cmdRegister(
	client: StudioRpcClient,
	args: string[],
): Promise<never> {
	const manifestPath = args[0];
	if (!manifestPath) {
		fail(USAGE);
	}
	const manifest = loadTeamManifest(manifestPath, cwd());
	const registered = await client.call("teams.register", {
		definition: {
			name: manifest.name,
			namespace_key: manifest.namespace_key,
			lead_budget_tokens: manifest.lead_budget_tokens,
			playbook: manifest.playbook,
			members: manifest.members,
		},
	});
	if (String(registered.status ?? "") === "error") {
		const message = String(registered.message ?? "registration failed");
		if (isDuplicateTeamError(message)) {
			fail(
				`duplicate team: ${message} (registering the same manifest twice is rejected)`,
			);
		}
		fail(message);
	}
	const taskIds: string[] = [];
	for (const task of manifest.tasks) {
		const added = await client.call("teams.add_task", {
			team: manifest.name,
			title: task.title,
			detail: task.detail,
			assignee: task.assignee || undefined,
		});
		if (String(added.status ?? "") === "error") {
			fail(
				`task "${task.title}" rejected: ${String(added.message ?? "unknown error")}`,
			);
		}
		taskIds.push(String(added.task_id ?? ""));
	}
	ok({
		status: "ok",
		team: manifest.name,
		namespace_key: manifest.namespace_key,
		members: manifest.members.length,
		initial_tasks: taskIds,
	});
}

async function cmdStatus(
	client: StudioRpcClient,
	args: string[],
): Promise<never> {
	const team = args[0];
	let result: Record<string, unknown>;
	if (!team) {
		result = await client.call("teams.list", {});
	} else {
		result = await client.call("teams.status", { team });
	}
	if (String(result.status ?? "") === "error") {
		fail(String(result.message ?? "status query failed"));
	}
	ok(result);
}

async function cmdTaskAdd(
	client: StudioRpcClient,
	args: string[],
): Promise<never> {
	const [team, title] = [args[0], args[1]];
	if (!team || !title) {
		fail(USAGE);
	}
	let detail = "";
	let assignee = "";
	for (let i = 2; i < args.length; i += 1) {
		if (args[i] === "--detail" && args[i + 1]) {
			detail = args[i + 1] ?? "";
			i += 1;
		} else if (args[i] === "--assignee" && args[i + 1]) {
			assignee = args[i + 1] ?? "";
			i += 1;
		}
	}
	ok(
		await client.call("teams.add_task", {
			team,
			title,
			detail,
			assignee: assignee || undefined,
		}),
	);
}

async function cmdSend(
	client: StudioRpcClient,
	args: string[],
): Promise<never> {
	const [team, member] = [args[0], args[1]];
	const message = args.slice(2).join(" ").trim();
	if (!team || !member || !message) {
		fail(USAGE);
	}
	let from = "lead";
	for (let i = 0; i < args.length; i += 1) {
		if (args[i] === "--from" && args[i + 1]) {
			from = args[i + 1] ?? "lead";
			i += 1;
		}
	}
	ok(
		await client.call("teams.send", { team, from, to: member, body: message }),
	);
}

async function cmdDisband(
	client: StudioRpcClient,
	args: string[],
): Promise<never> {
	const team = args[0];
	if (!team) {
		fail(USAGE);
	}
	const keepInboxes = args.includes("--keep-inboxes");
	ok(
		await client.call("teams.disband", { team, cleanup_inboxes: !keepInboxes }),
	);
}

export async function teamMain(args: string[]): Promise<void> {
	const [sub, ...rest] = args;
	if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
		process.stdout.write(`${USAGE}\n`);
		process.exit(sub ? 0 : 1);
	}
	let client: StudioRpcClient;
	try {
		client = await createStudioClient();
	} catch (e) {
		process.stderr.write(
			`error: ${String(e instanceof StudioRpcError ? e.message : e)}\n`,
		);
		process.exit(1);
	}
	try {
		switch (sub) {
			case "register":
				await cmdRegister(client, rest);
				break;
			case "status":
				await cmdStatus(client, rest);
				break;
			case "task":
				if (rest[0] !== "add") {
					fail(USAGE);
				}
				await cmdTaskAdd(client, rest.slice(1));
				break;
			case "send":
				await cmdSend(client, rest);
				break;
			case "disband":
				await cmdDisband(client, rest);
				break;
			default:
				fail(`unknown team subcommand: ${sub}\n${USAGE}`);
		}
	} catch (e) {
		if (e instanceof ExitSignal) {
			process.exit(e.code);
		}
		die(e);
	}
}
