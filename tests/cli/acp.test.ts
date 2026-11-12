import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAcpAgent, type JsonRpcMessage } from "../../src/cli/handlers/acp";

// Evolution plan P3.1: ACP server (C8). JSON-RPC 2.0 over newline-delimited
// stdio; session/prompt spawns the headless kernel and translates the
// stream-json event stream into session/update notifications. Stub kernel
// emits text deltas + a tool_use + tool_result + result.

const tempDirs: string[] = [];
let stubFusion = "";
let workDir = "";

function makeCollector(): {
	out: JsonRpcMessage[];
	waitFor: (pred: (m: JsonRpcMessage) => boolean, timeoutMs?: number) => Promise<JsonRpcMessage>;
} {
	const out: JsonRpcMessage[] = [];
	return {
		out,
		waitFor(pred, timeoutMs = 4000) {
			return new Promise((resolve, reject) => {
				const deadline = Date.now() + timeoutMs;
				const check = () => {
					const found = out.find(pred);
					if (found) {
						resolve(found);
						return;
					}
					if (Date.now() > deadline) {
						reject(new Error(`timeout waiting for message; got ${out.length}`));
						return;
					}
					setTimeout(check, 20);
				};
				check();
			});
		},
	};
}

// One stream-json transcript line per printf argument (no echo -e pitfalls).
function stubScript(lines: object[]): string {
	const args = lines.map((l) => `'${JSON.stringify(l).replace(/'/g, `'\\''`)}'`).join(" ");
	return `#!/bin/sh\nprintf '%s\\n' ${args}\nexit 0\n`;
}

const TRANSCRIPT = [
	{ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "hello " } } },
	{ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "world" } } },
	{
		type: "assistant",
		message: { content: [{ type: "tool_use", id: "call_001", name: "Read", input: { file_path: "/x" } }] },
	},
	{
		type: "user",
		message: { content: [{ type: "tool_result", tool_use_id: "call_001", is_error: false }] },
	},
	{ type: "result", subtype: "success", is_error: false, num_turns: 1 },
];

beforeAll(() => {
	workDir = mkdtempSync(join(tmpdir(), "fc-acp-"));
	tempDirs.push(workDir);
	stubFusion = join(workDir, "stub-fusion.sh");
	writeFileSync(stubFusion, stubScript(TRANSCRIPT));
	chmodSync(stubFusion, 0o755);
	process.env.FUSION_CODE_TASK_FUSION_BIN = stubFusion;
});

afterAll(() => {
	delete process.env.FUSION_CODE_TASK_FUSION_BIN;
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

async function feed(
	agent: { handleLine: (line: string) => Promise<void> },
	msg: object,
): Promise<void> {
	await agent.handleLine(JSON.stringify(msg));
}

async function newSession(
	agent: { handleLine: (line: string) => Promise<void> },
	collector: ReturnType<typeof makeCollector>,
): Promise<string> {
	await feed(agent, {
		jsonrpc: "2.0",
		id: 0,
		method: "initialize",
		params: { protocolVersion: 1, clientCapabilities: {} },
	});
	await collector.waitFor((m) => m.id === 0 && m.result !== undefined);
	await feed(agent, { jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: workDir } });
	const resp = await collector.waitFor((m) => m.id === 1 && m.result !== undefined);
	return (resp.result as { sessionId: string }).sessionId;
}

describe("ACP server (P3.1)", () => {
	test("initialize negotiates protocol v1 and agent capabilities", async () => {
		const collector = makeCollector();
		const agent = createAcpAgent((async function* () {})(), (m) => collector.out.push(m));
		await feed(agent, {
			jsonrpc: "2.0",
			id: 0,
			method: "initialize",
			params: { protocolVersion: 1, clientCapabilities: {} },
		});
		const resp = await collector.waitFor((m) => m.id === 0 && m.result !== undefined);
		expect(resp.result).toMatchObject({ protocolVersion: 1 });
		const caps = resp.result as Record<string, unknown>;
		expect(caps.agentCapabilities).toBeTruthy();
		expect(caps.agentInfo).toMatchObject({ name: "fusion-code" });
	});

	test("requests before initialize are refused", async () => {
		const collector = makeCollector();
		const agent = createAcpAgent((async function* () {})(), (m) => collector.out.push(m));
		await feed(agent, { jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: workDir } });
		const resp = await collector.waitFor((m) => m.id === 1);
		expect(resp.error?.code).toBe(-32002);
	});

	test("full prompt turn: streamed chunks, tool_call lifecycle, stopReason end_turn", async () => {
		const collector = makeCollector();
		const agent = createAcpAgent((async function* () {})(), (m) => collector.out.push(m));
		const sessionId = await newSession(agent, collector);
		expect(sessionId).toMatch(/^sess_/);

		await feed(agent, {
			jsonrpc: "2.0",
			id: 2,
			method: "session/prompt",
			params: { sessionId, prompt: [{ type: "text", text: "analyze this" }] },
		});

		const chunk1 = await collector.waitFor((m) => JSON.stringify(m).includes("hello "));
		const upd1 = chunk1.params as { update: { sessionUpdate: string; content: { text: string } } };
		expect(upd1.update.sessionUpdate).toBe("agent_message_chunk");
		expect(upd1.update.content.text).toBe("hello ");

		const toolCall = await collector.waitFor((m) => JSON.stringify(m).includes('"tool_call"'));
		const upd2 = toolCall.params as { update: { toolCallId: string; kind: string; status: string } };
		expect(upd2.update.toolCallId).toBe("call_001");
		expect(upd2.update.kind).toBe("read");
		expect(upd2.update.status).toBe("in_progress");

		const toolDone = await collector.waitFor((m) => JSON.stringify(m).includes("tool_call_update"));
		const upd3 = toolDone.params as { update: { status: string } };
		expect(upd3.update.status).toBe("completed");

		const promptResp = await collector.waitFor((m) => m.id === 2 && m.result !== undefined);
		expect((promptResp.result as { stopReason: string }).stopReason).toBe("end_turn");
	}, 10000);

	test("unknown sessionId errors; unknown method errors", async () => {
		const collector = makeCollector();
		const agent = createAcpAgent((async function* () {})(), (m) => collector.out.push(m));
		await feed(agent, {
			jsonrpc: "2.0",
			id: 0,
			method: "initialize",
			params: { protocolVersion: 1, clientCapabilities: {} },
		});
		await collector.waitFor((m) => m.id === 0);
		await feed(agent, {
			jsonrpc: "2.0",
			id: 5,
			method: "session/prompt",
			params: { sessionId: "sess_nope", prompt: [{ type: "text", text: "x" }] },
		});
		const err = await collector.waitFor((m) => m.id === 5);
		expect(err.error?.code).toBe(-32602);
		await feed(agent, { jsonrpc: "2.0", id: 6, method: "session/delete", params: {} });
		const err2 = await collector.waitFor((m) => m.id === 6);
		expect(err2.error?.code).toBe(-32601);
	});

	test("error result maps to refusal stopReason", async () => {
		const errStub = join(workDir, "stub-fusion-err.sh");
		writeFileSync(
			errStub,
			stubScript([{ type: "result", subtype: "error_during_execution", is_error: true }]),
		);
		chmodSync(errStub, 0o755);
		const collector = makeCollector();
		const agent = createAcpAgent((async function* () {})(), (m) => collector.out.push(m));
		const sessionId = await newSession(agent, collector);
		const prev = process.env.FUSION_CODE_TASK_FUSION_BIN;
		process.env.FUSION_CODE_TASK_FUSION_BIN = errStub;
		await feed(agent, {
			jsonrpc: "2.0",
			id: 2,
			method: "session/prompt",
			params: { sessionId, prompt: [{ type: "text", text: "x" }] },
		});
		const resp = await collector.waitFor((m) => m.id === 2 && (m.result !== undefined || m.error !== undefined));
		expect((resp.result as { stopReason: string })?.stopReason).toBe("refusal");
		process.env.FUSION_CODE_TASK_FUSION_BIN = prev;
	}, 10000);
});
