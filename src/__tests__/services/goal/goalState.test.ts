import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { getSessionId } from "../../../bootstrap/state.js";
import {
	blockGoal,
	cancelGoal,
	clearAllGoals,
	completeGoal,
	createGoal,
	getGoalById,
	pauseGoal,
	replaceGoal,
	resumeGoal,
	setGoalBudget,
	updateBudgetUsed,
} from "../../../services/goal/goalState.js";
import { GoalGetTool } from "../../../tools/GoalGetTool/GoalGetTool.js";
import { GoalSetBudgetTool } from "../../../tools/GoalSetBudgetTool/GoalSetBudgetTool.js";
import { GoalUpdateTool } from "../../../tools/GoalUpdateTool/GoalUpdateTool.js";

const ORIG_CONFIG_DIR = process.env.FUSION_CODE_CONFIG_DIR;
let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(homedir(), ".fusion-code-goal-test-"));
	process.env.FUSION_CODE_CONFIG_DIR = tmpDir;
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	if (ORIG_CONFIG_DIR === undefined) delete process.env.FUSION_CODE_CONFIG_DIR;
	else process.env.FUSION_CODE_CONFIG_DIR = ORIG_CONFIG_DIR;
});

describe("P5.3 GoalRef CAS — goalState revision", () => {
	test("createGoal inits revision to 1", () => {
		const g = createGoal("s1", "do thing");
		expect(g.revision).toBe(1);
		const loaded = getGoalById("s1", g.id);
		expect(loaded?.revision).toBe(1);
	});

	test("pauseGoal bumps revision", () => {
		const g = createGoal("s2", "do thing");
		const paused = pauseGoal("s2", g.id);
		expect(paused?.revision).toBe(2);
	});

	test("resumeGoal bumps revision", () => {
		const g = createGoal("s3", "do thing");
		pauseGoal("s3", g.id);
		const resumed = resumeGoal("s3", g.id);
		expect(resumed?.revision).toBe(3);
	});

	test("blockGoal bumps revision", () => {
		const g = createGoal("s4", "do thing");
		const blocked = blockGoal("s4", g.id, "stuck");
		expect(blocked?.revision).toBe(2);
	});

	test("completeGoal bumps revision + bumps auto-activated next", () => {
		const g1 = createGoal("s5", "first");
		const g2 = createGoal("s5", "second");
		expect(g2.status).toBe("paused");
		const completed = completeGoal("s5", g1.id);
		expect(completed?.revision).toBe(2);
		const next = getGoalById("s5", g2.id);
		expect(next?.status).toBe("active");
		expect(next?.revision).toBe(2);
	});

	test("replaceGoal bumps revision", () => {
		createGoal("s6", "do thing");
		const replaced = replaceGoal("s6", "new objective");
		expect(replaced?.revision).toBe(2);
		expect(replaced?.objective).toBe("new objective");
	});

	test("setGoalBudget bumps revision", () => {
		const g = createGoal("s7", "do thing");
		const updated = setGoalBudget("s7", g.id, { turns: 5 });
		expect(updated?.revision).toBe(2);
		expect(updated?.budget.turns).toBe(5);
	});

	test("updateBudgetUsed bumps revision", () => {
		createGoal("s8", "do thing");
		const updated = updateBudgetUsed("s8", { turns: 1 });
		expect(updated?.revision).toBe(2);
		expect(updated?.budgetUsed.turns).toBe(1);
	});

	test("cancelGoal bumps auto-activated next revision", () => {
		const g1 = createGoal("s9", "first");
		const g2 = createGoal("s9", "second");
		cancelGoal("s9", g1.id);
		const next = getGoalById("s9", g2.id);
		expect(next?.status).toBe("active");
		expect(next?.revision).toBe(2);
	});

	test("old goal file without revision normalizes to 1 on load", () => {
		// Write a goal file mimicking the pre-P5.3 format (no revision field).
		const dir = join(tmpDir, "goals");
		mkdirSync(dir, { recursive: true });
		const legacy = [
			{
				id: "goal_legacy_1",
				objective: "legacy goal",
				status: "active",
				budget: {},
				budgetUsed: { turns: 0, tokens: 0, wallMs: 0 },
				createdAt: 1700000000000,
				startedAt: 1700000000000,
				pausedAt: null,
				completedAt: null,
				summary: null,
			},
		];
		writeFileSync(
			join(dir, "legacy.json"),
			JSON.stringify(legacy, null, 2),
		);
		const loaded = getGoalById("legacy", "goal_legacy_1");
		expect(loaded?.revision).toBe(1);
		// A mutation on the normalized goal bumps from 1 to 2.
		const paused = pauseGoal("legacy", "goal_legacy_1");
		expect(paused?.revision).toBe(2);
	});
});

describe("P5.3 GoalRef CAS — tool reject-on-stale", () => {
	// Tools resolve sessionId via getSessionId(), so seed with that same id.
	test("GoalUpdateTool rejects stale expectedRevision with is_error", async () => {
		const sid = getSessionId();
		clearAllGoals(sid);
		const g = createGoal(sid, "do thing");
		pauseGoal(sid, g.id); // revision 1 -> 2
		const res = await GoalUpdateTool.execute(
			{ goalId: g.id, status: "blocked", expectedRevision: 1 },
			{} as never,
		);
		const data = (res as { data: Record<string, unknown> }).data;
		expect(data.error).toMatch(/Stale revision/);
		const mapped = GoalUpdateTool.mapToolResultToToolResultBlockParam(
			data as never,
			"tu1",
		);
		expect(mapped.is_error).toBe(true);
		const cur = getGoalById(sid, g.id);
		expect(cur?.status).toBe("paused");
		expect(cur?.revision).toBe(2);
	});

	test("GoalUpdateTool accepts matching expectedRevision and bumps", async () => {
		const sid = getSessionId();
		clearAllGoals(sid);
		const g = createGoal(sid, "do thing");
		const res = await GoalUpdateTool.execute(
			{ goalId: g.id, status: "complete", expectedRevision: 1 },
			{} as never,
		);
		const data = (res as { data: Record<string, unknown> }).data;
		expect(data.error).toBeUndefined();
		expect(data.status).toBe("complete");
		const cur = getGoalById(sid, g.id);
		expect(cur?.revision).toBe(2);
	});

	test("GoalUpdateTool byte-identical when expectedRevision omitted", async () => {
		const sid = getSessionId();
		clearAllGoals(sid);
		const g = createGoal(sid, "do thing");
		const res = await GoalUpdateTool.execute(
			{ goalId: g.id, status: "blocked" },
			{} as never,
		);
		const data = (res as { data: Record<string, unknown> }).data;
		expect(data.error).toBeUndefined();
		expect(data.status).toBe("blocked");
		expect(data.revision).toBe(2);
	});

	test("GoalSetBudgetTool rejects stale expectedRevision", async () => {
		const sid = getSessionId();
		clearAllGoals(sid);
		const g = createGoal(sid, "do thing");
		setGoalBudget(sid, g.id, { turns: 3 }); // revision 1 -> 2
		const res = await GoalSetBudgetTool.execute(
			{ goalId: g.id, turns: 5, expectedRevision: 1 },
			{} as never,
		);
		const data = (res as { data: Record<string, unknown> }).data;
		expect(data.error).toMatch(/Stale revision/);
		expect(data.revision).toBe(2);
		const cur = getGoalById(sid, g.id);
		expect(cur?.budget.turns).toBe(3);
	});

	test("GoalSetBudgetTool accepts matching expectedRevision", async () => {
		const sid = getSessionId();
		clearAllGoals(sid);
		const g = createGoal(sid, "do thing");
		const res = await GoalSetBudgetTool.execute(
			{ goalId: g.id, turns: 10, expectedRevision: 1 },
			{} as never,
		);
		const data = (res as { data: Record<string, unknown> }).data;
		expect(data.error).toBeUndefined();
		expect(data.revision).toBe(2);
		const cur = getGoalById(sid, g.id);
		expect(cur?.budget.turns).toBe(10);
	});

	test("GoalGetTool surfaces current revision for CAS calls", async () => {
		const sid = getSessionId();
		clearAllGoals(sid);
		const g = createGoal(sid, "do thing");
		pauseGoal(sid, g.id); // revision 1 -> 2
		const res = await GoalGetTool.execute({ goalId: g.id }, {} as never);
		const data = (res as { data: Record<string, unknown> }).data;
		expect(data.revision).toBe(2);
		const mapped = GoalGetTool.mapToolResultToToolResultBlockParam(
			data as never,
			"tu6",
		);
		expect(mapped.content).toMatch(/revision: 2/);
	});

	test("GoalUpdateTool unknown goalId with guard returns error", async () => {
		const res = await GoalUpdateTool.execute(
			{ goalId: "ghost", status: "complete", expectedRevision: 1 },
			{} as never,
		);
		const data = (res as { data: Record<string, unknown> }).data;
		expect(data.error).toMatch(/not found/);
	});
});
