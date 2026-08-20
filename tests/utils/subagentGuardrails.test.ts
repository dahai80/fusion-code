import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { AppState } from "../../src/state/AppStateStore.js";
import type { TaskState } from "../../src/tasks/types.js";
import {
	checkSubagentGuardrails,
	countRunningSubagents,
	DEFAULT_MAX_CONCURRENT_SUBAGENTS,
	DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH,
	DEFAULT_MAX_SUBAGENTS_PER_SESSION,
	getMaxConcurrentSubagents,
	getMaxSubagentSpawnDepth,
	getMaxSubagentsPerSession,
} from "../../src/tools/AgentTool/subagentGuardrails.js";

// Build a minimal AppState whose `tasks` map mimics the real shape enough for
// getRunningTasks + isLocalAgentTask. We only populate the fields those helpers
// read: status + the local_agent discriminator (agentType !== 'main-session').
function makeRunningAgentTask(id: string): TaskState {
	return {
		id,
		type: "local_agent",
		status: "running",
		agentId: id,
		agentType: "general-purpose",
		description: "test agent",
		prompt: "",
		abortController: new AbortController(),
		retrieved: false,
		lastReportedToolCount: 0,
		lastReportedTokenCount: 0,
		isBackgrounded: true,
		pendingMessages: [],
		retain: false,
		diskLoaded: false,
	} as unknown as TaskState;
}

function makeAppState(runningAgentIds: string[]): AppState {
	const tasks: Record<string, TaskState> = {};
	for (const id of runningAgentIds) {
		tasks[id] = makeRunningAgentTask(id);
	}
	return { tasks } as unknown as AppState;
}

const ENV_KEYS = [
	"FUSION_MAX_CONCURRENT_SUBAGENTS",
	"FUSION_MAX_SUBAGENTS_PER_SESSION",
	"FUSION_MAX_SUBAGENT_SPAWN_DEPTH",
] as const;

describe("subagentGuardrails", () => {
	beforeEach(() => {
		for (const k of ENV_KEYS) delete process.env[k];
	});
	afterEach(() => {
		for (const k of ENV_KEYS) delete process.env[k];
	});

	describe("env defaults + parsing", () => {
		it("returns default caps when env unset", () => {
			expect(getMaxConcurrentSubagents()).toBe(
				DEFAULT_MAX_CONCURRENT_SUBAGENTS,
			);
			expect(getMaxSubagentsPerSession()).toBe(
				DEFAULT_MAX_SUBAGENTS_PER_SESSION,
			);
			expect(getMaxSubagentSpawnDepth()).toBe(DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH);
		});
		it("honors env overrides", () => {
			process.env.FUSION_MAX_CONCURRENT_SUBAGENTS = "5";
			process.env.FUSION_MAX_SUBAGENTS_PER_SESSION = "50";
			process.env.FUSION_MAX_SUBAGENT_SPAWN_DEPTH = "2";
			expect(getMaxConcurrentSubagents()).toBe(5);
			expect(getMaxSubagentsPerSession()).toBe(50);
			expect(getMaxSubagentSpawnDepth()).toBe(2);
		});
		it("falls back to default on invalid env (non-numeric / 0 / negative)", () => {
			for (const bad of ["nope", "0", "-3"]) {
				process.env.FUSION_MAX_CONCURRENT_SUBAGENTS = bad;
				expect(getMaxConcurrentSubagents()).toBe(
					DEFAULT_MAX_CONCURRENT_SUBAGENTS,
				);
			}
		});
		it("truncates decimal env to integer (parseInt semantics)", () => {
			process.env.FUSION_MAX_CONCURRENT_SUBAGENTS = "5.9";
			expect(getMaxConcurrentSubagents()).toBe(5);
		});
	});

	describe("countRunningSubagents", () => {
		it("counts only running local_agent tasks", () => {
			const state = makeAppState(["a", "b", "c"]);
			expect(countRunningSubagents(state)).toBe(3);
		});
		it("returns 0 when no running agents", () => {
			expect(countRunningSubagents(makeAppState([]))).toBe(0);
		});
	});

	describe("checkSubagentGuardrails", () => {
		it("allows spawn when all caps pass", () => {
			expect(
				checkSubagentGuardrails({
					appState: makeAppState([]),
					depth: 0,
					sessionSpawnCount: 0,
				}),
			).toBeNull();
		});

		it("rejects when spawn depth reaches the limit", () => {
			const err = checkSubagentGuardrails({
				appState: makeAppState([]),
				depth: DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH,
				sessionSpawnCount: 0,
			});
			expect(err).not.toBeNull();
			expect(err).toContain("depth");
			expect(err).toContain("FUSION_MAX_SUBAGENT_SPAWN_DEPTH");
		});
		it("allows depth below the limit", () => {
			expect(
				checkSubagentGuardrails({
					appState: makeAppState([]),
					depth: DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH - 1,
					sessionSpawnCount: 0,
				}),
			).toBeNull();
		});

		it("rejects when running-agent concurrency reaches the limit", () => {
			const ids = Array.from(
				{ length: DEFAULT_MAX_CONCURRENT_SUBAGENTS },
				(_, i) => `agent-${i}`,
			);
			const err = checkSubagentGuardrails({
				appState: makeAppState(ids),
				depth: 0,
				sessionSpawnCount: 0,
			});
			expect(err).not.toBeNull();
			expect(err).toContain("concurrency");
			expect(err).toContain("FUSION_MAX_CONCURRENT_SUBAGENTS");
		});
		it("allows when concurrency is below the limit", () => {
			const ids = Array.from(
				{ length: DEFAULT_MAX_CONCURRENT_SUBAGENTS - 1 },
				(_, i) => `agent-${i}`,
			);
			expect(
				checkSubagentGuardrails({
					appState: makeAppState(ids),
					depth: 0,
					sessionSpawnCount: 0,
				}),
			).toBeNull();
		});

		it("rejects when session spawn count reaches the limit", () => {
			const err = checkSubagentGuardrails({
				appState: makeAppState([]),
				depth: 0,
				sessionSpawnCount: DEFAULT_MAX_SUBAGENTS_PER_SESSION,
			});
			expect(err).not.toBeNull();
			expect(err).toContain("session");
			expect(err).toContain("FUSION_MAX_SUBAGENTS_PER_SESSION");
		});
		it("allows when session count is below the limit", () => {
			expect(
				checkSubagentGuardrails({
					appState: makeAppState([]),
					depth: 0,
					sessionSpawnCount: DEFAULT_MAX_SUBAGENTS_PER_SESSION - 1,
				}),
			).toBeNull();
		});

		it("checks depth before concurrency (cheapest first)", () => {
			// Both depth AND concurrency exceeded — depth message wins.
			const ids = Array.from(
				{ length: DEFAULT_MAX_CONCURRENT_SUBAGENTS },
				(_, i) => `agent-${i}`,
			);
			const err = checkSubagentGuardrails({
				appState: makeAppState(ids),
				depth: DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH,
				sessionSpawnCount: 0,
			});
			expect(err).not.toBeNull();
			expect(err).toContain("depth");
		});

		it("respects lowered env cap at runtime", () => {
			process.env.FUSION_MAX_SUBAGENT_SPAWN_DEPTH = "1";
			expect(
				checkSubagentGuardrails({
					appState: makeAppState([]),
					depth: 1,
					sessionSpawnCount: 0,
				}),
			).not.toBeNull();
			expect(
				checkSubagentGuardrails({
					appState: makeAppState([]),
					depth: 0,
					sessionSpawnCount: 0,
				}),
			).toBeNull();
		});
	});
});
