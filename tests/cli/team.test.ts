// Issue #268 (T4a): fusion-code team CLI over a fake agent-studio UDS daemon.
// The fake implements the same wire/auth semantics as the real daemon
// (rpc_auth.py): pre-auth auth.login + apikey.loopback_create, `_auth:{jwt}`
// object on everything else, 401 on missing/bad jwt, and teams.* handler
// semantics (duplicate register rejection, mailbox delivery, board state).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";

let tmpDir = "";
let sockPath = "";
let server: Server | null = null;

interface Registered {
	definition: Record<string, unknown>;
	tasks: Record<string, { title: string; status: string; assignee?: string }>;
	inboxes: Record<string, unknown[]>;
}

const registry = new Map<string, Registered>();
const KEY = "fk-test-key-000000000000000000000000";

function jsonResp(id: number, body: Record<string, unknown>): string {
	return `${JSON.stringify({ jsonrpc: "2.0", id, ...body })}\n`;
}

function err(id: number, code: number, message: string): string {
	return jsonResp(id, { error: { code, message } });
}

function handle(
	method: string,
	params: Record<string, unknown>,
): Record<string, unknown> {
	if (method === "apikey.loopback_create") {
		return { key_id: "testkey", key_secret: KEY, key_prefix: "fk-test" };
	}
	if (method === "auth.login") {
		if (params.apikey !== KEY) {
			throw Object.assign(new Error("invalid apikey: key_not_found"), {
				code: 401,
			});
		}
		return {
			jwt: "test.jwt.token",
			key_id: "testkey",
			tid: "t",
			expires_at: 9e12,
		};
	}
	const auth = params._auth as { jwt?: string } | undefined;
	if (auth?.jwt !== "test.jwt.token") {
		throw Object.assign(new Error("Auth required: missing _auth"), {
			code: 401,
		});
	}
	const teamName = String(params.team ?? "");
	switch (method) {
		case "teams.register": {
			const def = (params.definition ?? {}) as Record<string, unknown>;
			const name = String(def.name ?? "");
			if (registry.has(name)) {
				return { status: "error", message: `team already registered: ${name}` };
			}
			registry.set(name, { definition: def, tasks: {}, inboxes: {} });
			return {
				status: "ok",
				name,
				namespace_key: def.namespace_key,
				members: [],
			};
		}
		case "teams.add_task": {
			const reg = registry.get(teamName);
			if (!reg) {
				return { status: "error", message: `team not registered: ${teamName}` };
			}
			const id = `task-${Object.keys(reg.tasks).length + 1}`;
			reg.tasks[id] = {
				title: String(params.title ?? ""),
				status: "todo",
				assignee: params.assignee ? String(params.assignee) : undefined,
			};
			return { status: "ok", task_id: id };
		}
		case "teams.status": {
			const reg = registry.get(teamName);
			if (!reg) {
				return { status: "error", message: `team not registered: ${teamName}` };
			}
			return {
				status: "ok",
				team: teamName,
				lifecycle: "active",
				tasks: reg.tasks,
			};
		}
		case "teams.list":
			return { status: "ok", teams: [...registry.keys()] };
		case "teams.send": {
			const reg = registry.get(teamName);
			if (!reg) {
				return { status: "error", message: `team not registered: ${teamName}` };
			}
			const to = String(params.to ?? "");
			if (!reg.inboxes[to]) {
				reg.inboxes[to] = [];
			}
			(reg.inboxes[to] as unknown[]).push({ from: params.from, body: params.body });
			return { status: "ok", delivered: true };
		}
		case "teams.disband": {
			if (!registry.has(teamName)) {
				return { status: "error", message: `team not registered: ${teamName}` };
			}
			registry.delete(teamName);
			return { status: "ok", lifecycle: "disbanded" };
		}
		default:
			throw Object.assign(new Error(`no handler: ${method}`), { code: -32601 });
	}
}

beforeAll(async () => {
	tmpDir = mkdtempSync("/tmp/fc-team-test-");
	chmodSync(tmpDir, 0o700);
	sockPath = join(tmpDir, "fusion-studio.sock");
	server = createServer((socket: Socket) => {
		let buf = "";
		socket.on("data", (chunk: Buffer) => {
			buf += chunk.toString("utf8");
			let idx = buf.indexOf("\n");
			while (idx !== -1) {
				const line = buf.slice(0, idx);
				buf = buf.slice(idx + 1);
				try {
					const msg = JSON.parse(line) as {
						id: number;
						method: string;
						params: Record<string, unknown>;
					};
					try {
						socket.write(
							jsonResp(msg.id, {
								result: handle(msg.method, msg.params ?? {}),
							}),
						);
					} catch (e) {
						const code = (e as { code?: number }).code ?? -32000;
						socket.write(err(msg.id, code, (e as Error).message));
					}
				} catch {
					socket.write(err(-1, -32700, "parse error"));
				}
				idx = buf.indexOf("\n");
			}
		});
	});
	await new Promise<void>((resolve) => server?.listen(sockPath, resolve));
	process.env.FUSION_STUDIO_SOCKET = sockPath;
	// Pre-provision the key so the client never runs the loopback bootstrap
	// (that would write a real ~/.fusion-code/studio.key on the dev machine).
	process.env.FUSION_AGENT_STUDIO_API_KEY = KEY;
});

afterAll(() => {
	delete process.env.FUSION_STUDIO_SOCKET;
	delete process.env.FUSION_AGENT_STUDIO_API_KEY;
	server?.close();
	rmSync(tmpDir, { recursive: true, force: true });
});

async function runMain(argv: string[]): Promise<void> {
	const { teamMain } = await import("../../src/cli/handlers/team");
	const { resetStudioAuthCache } = await import(
		"../../src/services/teams/studioRpc"
	);
	resetStudioAuthCache();
	await teamMain(argv);
}

function capture(
	fn: () => Promise<void>,
): Promise<{ out: string; code: number }> {
	const chunks: string[] = [];
	const origWrite = process.stdout.write.bind(process.stdout);
	const origErr = process.stderr.write.bind(process.stderr);
	const origExit = process.exit.bind(process);
	const collector =
		(_target: NodeJS.WriteStream) =>
		(s: unknown): boolean => {
			chunks.push(String(s));
			return true;
		};
	process.stdout.write = collector(process.stdout);
	process.stderr.write = collector(process.stderr);
	let code = 0;
	const fakeExit = (c?: number): never => {
		code = c ?? 0;
		throw new Error(`__exit__${c ?? 0}`);
	};
	process.exit = fakeExit;
	return fn()
		.catch((e) => {
			if (!String(e.message).startsWith("__exit__")) {
				process.stdout.write = origWrite;
				process.stderr.write = origErr;
				process.exit = origExit;
				throw e;
			}
		})
		.then(() => {
			process.stdout.write = origWrite;
			process.stderr.write = origErr;
			process.exit = origExit;
			return { out: chunks.join(""), code };
		});
}

function writeManifest(): string {
	const path = join(tmpDir, "team.manifest.json");
	writeFileSync(
		path,
		JSON.stringify({
			name: "pair",
			namespace_key: "team:pair",
			playbook: true,
			members: [
				{
					name: "worker-a",
					role: "does A",
					skills: ["summarize"],
					tool_allowlist: ["file_read"],
					budget_tokens: 40000,
				},
				{
					name: "worker-b",
					role: "does B",
					tool_allowlist: ["file_write"],
					budget_tokens: 40000,
				},
			],
			tasks: [
				{ title: "split work", detail: "two halves", assignee: "worker-a" },
				{ title: "review", assignee: "worker-b" },
			],
		}),
	);
	return path;
}

describe("team CLI", () => {
	test("register creates team and initial tasks", async () => {
		const { out, code } = await capture(() =>
			runMain(["register", writeManifest()]),
		);
		expect(code).toBe(0);
		const parsed = JSON.parse(out);
		expect(parsed.team).toBe("pair");
		expect(parsed.initial_tasks).toHaveLength(2);
		expect(registry.get("pair")?.tasks["task-1"].assignee).toBe("worker-a");
	});

	test("registering the same manifest twice fails cleanly", async () => {
		const { out, code } = await capture(() =>
			runMain(["register", writeManifest()]),
		);
		expect(code).toBe(1);
		expect(out).toContain("duplicate team");
		expect(out).toContain("already registered");
	});

	test("status shows board state", async () => {
		const { out, code } = await capture(() => runMain(["status", "pair"]));
		expect(code).toBe(0);
		const parsed = JSON.parse(out);
		expect(parsed.team).toBe("pair");
		expect(parsed.lifecycle).toBe("active");
		expect(Object.keys(parsed.tasks)).toHaveLength(2);
	});

	test("task add appends to the board", async () => {
		const { out, code } = await capture(() =>
			runMain([
				"task",
				"add",
				"pair",
				"follow-up",
				"--detail",
				"extra",
				"--assignee",
				"worker-b",
			]),
		);
		expect(code).toBe(0);
		expect(JSON.parse(out).task_id).toBe("task-3");
		expect(registry.get("pair")?.tasks["task-3"].assignee).toBe("worker-b");
	});

	test("send delivers to member mailbox", async () => {
		const { out, code } = await capture(() =>
			runMain(["send", "pair", "worker-a", "please start with task-1"]),
		);
		expect(code).toBe(0);
		expect(JSON.parse(out).delivered).toBeTrue();
		const inbox = registry.get("pair")?.inboxes["worker-a"] as Array<{
			body: string;
		}>;
		expect(inbox.at(-1)?.body).toBe("please start with task-1");
	});

	test("status of unknown team fails with server message", async () => {
		const { out, code } = await capture(() => runMain(["status", "ghost"]));
		expect(code).toBe(1);
		expect(out).toContain("team not registered: ghost");
	});

	test("disband removes the team", async () => {
		const { code } = await capture(() => runMain(["disband", "pair"]));
		expect(code).toBe(0);
		expect(registry.has("pair")).toBeFalse();
	});

	test("missing manifest fails without touching the daemon", async () => {
		const { out, code } = await capture(() =>
			runMain(["register", "/nonexistent/manifest.json"]),
		);
		expect(code).toBe(1);
		expect(out).toContain("cannot read manifest");
	});
});
