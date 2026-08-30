/**
 * item 25A: 最小 workflow 执行 runtime 单测 (CC 2.1.229)
 */
import { afterEach, describe, expect, it } from "bun:test";
import {
	createMiscPrimitives,
	type DelayFn,
	evaluateScript,
	extractMeta,
	isWorkflowRuntimeEnabled,
	runWithConcurrency,
	workflowBudgetTotal,
	workflowStaggerMs,
} from "../tools/WorkflowTool/runtime.js";

// ─── isWorkflowRuntimeEnabled ───

describe("isWorkflowRuntimeEnabled", () => {
	const orig = process.env.FUSION_WORKFLOW_RUNTIME_ENABLED;

	it("未设 → false (default off)", () => {
		delete process.env.FUSION_WORKFLOW_RUNTIME_ENABLED;
		expect(isWorkflowRuntimeEnabled()).toBe(false);
	});

	it("0 → false", () => {
		process.env.FUSION_WORKFLOW_RUNTIME_ENABLED = "0";
		expect(isWorkflowRuntimeEnabled()).toBe(false);
	});

	it("1 → true", () => {
		process.env.FUSION_WORKFLOW_RUNTIME_ENABLED = "1";
		expect(isWorkflowRuntimeEnabled()).toBe(true);
	});

	it("其他值 → false", () => {
		process.env.FUSION_WORKFLOW_RUNTIME_ENABLED = "true";
		expect(isWorkflowRuntimeEnabled()).toBe(false);
	});

	if (orig === undefined) {
		delete process.env.FUSION_WORKFLOW_RUNTIME_ENABLED;
	} else {
		process.env.FUSION_WORKFLOW_RUNTIME_ENABLED = orig;
	}
});

// ─── extractMeta ───

describe("extractMeta", () => {
	it("基本 meta + body", () => {
		const src = `export const meta = { name: "t", description: "d", phases: [] };\nconst x = 1;`;
		const { meta, body } = extractMeta(src);
		expect(meta.name).toBe("t");
		expect(meta.description).toBe("d");
		expect(body).toBe("const x = 1;");
	});

	it("嵌套花括号对象", () => {
		const src = `export const meta = { name: "t", description: "d", phases: [{ title: "a", detail: "b" }] };\nreturn 42;`;
		const { meta, body } = extractMeta(src);
		expect(meta.name).toBe("t");
		expect((meta.phases as Array<{ title: string }>)[0].title).toBe("a");
		expect(body).toBe("return 42;");
	});

	it("字符串内花括号不破坏平衡", () => {
		const src = `export const meta = { name: "t", description: "has } brace" };\nlog("done");`;
		const { meta, body } = extractMeta(src);
		expect(meta.description).toBe("has } brace");
		expect(body).toBe('log("done");');
	});

	it("缺 meta → 抛错 (fail visibly)", () => {
		expect(() => extractMeta("const x = 1;")).toThrow();
	});

	it("name 非字符串 → 抛错", () => {
		const src = `export const meta = { name: 5, description: "d" };\nreturn 1;`;
		expect(() => extractMeta(src)).toThrow();
	});

	it("尾随无分号也工作", () => {
		const src = `export const meta = { name: "t", description: "d" }\nreturn 1;`;
		const { meta, body } = extractMeta(src);
		expect(meta.name).toBe("t");
		expect(body).toBe("return 1;");
	});
});

// ─── evaluateScript: primitives (stub agent, 真 parallel/pipeline/log/phase/budget/workflow) ───

function makeStubs(overrides?: {
	agent?: (prompt: string) => Promise<string | null>;
}) {
	const logs: string[] = [];
	const phases: string[] = [];
	const agent =
		overrides?.agent ?? (async (prompt: string) => `agent:${prompt}`);
	return {
		logs,
		phases,
		primitives: {
			args: undefined,
			agent,
			parallel: async <T>(thunks: Array<() => Promise<T>>) => {
				const cap = Math.max(1, Math.min(16, 2));
				let next = 0;
				const results: Array<T | null> = new Array(thunks.length).fill(null);
				const worker = async () => {
					while (true) {
						const idx = next++;
						if (idx >= thunks.length) return;
						try {
							results[idx] = await thunks[idx]();
						} catch {
							results[idx] = null;
						}
					}
				};
				await Promise.all(
					Array.from({ length: Math.min(cap, thunks.length) }, worker),
				);
				return results;
			},
			pipeline: async (
				items: unknown[],
				...stages: Array<
					(prev: unknown, orig: unknown, i: number) => Promise<unknown>
				>
			) => {
				const out: Array<unknown | null> = [];
				for (const [i, orig] of items.entries()) {
					let prev: unknown = null;
					try {
						for (const stage of stages) {
							prev = await stage(prev, orig, i);
						}
						out.push(prev);
					} catch {
						out.push(null);
					}
				}
				return out;
			},
			phase: (title: string) => {
				phases.push(title);
			},
			log: (message: string) => {
				logs.push(message);
			},
			workflow: async () => {
				throw new Error(
					"nested workflow() not supported in minimal runtime (v1)",
				);
			},
			budget: {
				total: null,
				spent: () => 0,
				remaining: () => Number.POSITIVE_INFINITY,
			},
		},
	};
}

describe("evaluateScript", () => {
	it("顶层 return 取结果", async () => {
		const src = `export const meta = { name: "t", description: "d" };\nreturn 42;`;
		const { primitives } = makeStubs();
		const result = await evaluateScript(src, primitives);
		expect(result).toBe(42);
	});

	it("顶层 await agent() 调原语", async () => {
		const src = `export const meta = { name: "t", description: "d" };\nconst r = await agent("hello");\nreturn r;`;
		const { primitives } = makeStubs();
		const result = await evaluateScript(src, primitives);
		expect(result).toBe("agent:hello");
	});

	it("parallel() 并发返回数组", async () => {
		const src = `export const meta = { name: "t", description: "d" };\nconst r = await parallel([() => Promise.resolve("a"), () => Promise.resolve("b")]);\nreturn r;`;
		const { primitives } = makeStubs();
		const result = (await evaluateScript(src, primitives)) as string[];
		expect(result).toContain("a");
		expect(result).toContain("b");
		expect(result.length).toBe(2);
	});

	it("parallel() 某 thunk throw → 该项 null 不 reject 整体", async () => {
		const src = `export const meta = { name: "t", description: "d" };\nconst r = await parallel([() => Promise.resolve("ok"), () => Promise.reject(new Error("x"))]);\nreturn r;`;
		const { primitives } = makeStubs();
		const result = (await evaluateScript(src, primitives)) as (string | null)[];
		expect(result).toContain("ok");
		expect(result).toContain(null);
	});

	it("pipeline() 每 item 独立穿 stage", async () => {
		// stage1 用 original 加 10, stage2 乘 2 → [22, 24]
		const src = `export const meta = { name: "t", description: "d" };\nconst r = await pipeline([1, 2], async (p, orig) => orig + 10, async (p) => p * 2);\nreturn r;`;
		const { primitives } = makeStubs();
		const result = (await evaluateScript(src, primitives)) as number[];
		expect(result).toContain(22);
		expect(result).toContain(24);
	});

	it("log() 记录", async () => {
		const src = `export const meta = { name: "t", description: "d" };\nlog("hello");\nreturn "done";`;
		const { logs, primitives } = makeStubs();
		await evaluateScript(src, primitives);
		expect(logs).toContain("hello");
	});

	it("phase() 记录", async () => {
		const src = `export const meta = { name: "t", description: "d" };\nphase("Scan");\nreturn "done";`;
		const { phases, primitives } = makeStubs();
		await evaluateScript(src, primitives);
		expect(phases).toContain("Scan");
	});

	it("budget stub 可访问", async () => {
		const src = `export const meta = { name: "t", description: "d" };\nreturn budget.remaining();`;
		const { primitives } = makeStubs();
		const result = await evaluateScript(src, primitives);
		expect(result).toBe(Infinity);
	});

	it("workflow() 抛 NotImplemented", async () => {
		const src = `export const meta = { name: "t", description: "d" };\nreturn await workflow("x");`;
		const { primitives } = makeStubs();
		await expect(evaluateScript(src, primitives)).rejects.toThrow(
			/not supported in minimal runtime/,
		);
	});

	it("args 透传", async () => {
		const src = `export const meta = { name: "t", description: "d" };\nreturn args;`;
		const { primitives } = makeStubs();
		primitives.args = { key: "val" };
		const result = await evaluateScript(src, primitives);
		expect(result).toEqual({ key: "val" });
	});

	it("TS 类型注解剥除", async () => {
		const src = `export const meta = { name: "t", description: "d" };\nconst x: number = 5;\nreturn x;`;
		const { primitives } = makeStubs();
		const result = await evaluateScript(src, primitives);
		expect(result).toBe(5);
	});

	it("残留 export 语句 → 抛错", async () => {
		const src = `export const meta = { name: "t", description: "d" };\nexport const extra = 1;\nreturn 1;`;
		const { primitives } = makeStubs();
		await expect(evaluateScript(src, primitives)).rejects.toThrow(
			/additional export/,
		);
	});

	it("缺 meta → 抛错", async () => {
		const src = `return 1;`;
		const { primitives } = makeStubs();
		await expect(evaluateScript(src, primitives)).rejects.toThrow(
			/export const meta/,
		);
	});
});

// ─── item 25B: 错峰 fan-out (PREFIX_STAGGER_MS) ───
//
// runWithConcurrency stagger 分支 + workflowStaggerMs env 解析。
// default off (staggerMs=0) = 25A byte-identical, 无延迟。
// injectable delayFn (同步收集 startMs 序列) 验证错峰顺序, 无 fake-timer。

describe("item 25B: workflowStaggerMs env 解析", () => {
	const origFusion = process.env.FUSION_WORKFLOW_PREFIX_STAGGER_MS;
	const origClaude = process.env.CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS;

	afterEach(() => {
		if (origFusion === undefined) {
			delete process.env.FUSION_WORKFLOW_PREFIX_STAGGER_MS;
		} else {
			process.env.FUSION_WORKFLOW_PREFIX_STAGGER_MS = origFusion;
		}
		if (origClaude === undefined) {
			delete process.env.CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS;
		} else {
			process.env.CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS = origClaude;
		}
	});

	it("env 未设 → 0 (default off)", () => {
		delete process.env.FUSION_WORKFLOW_PREFIX_STAGGER_MS;
		delete process.env.CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS;
		expect(workflowStaggerMs()).toBe(0);
	});

	it("空串 → 0 (default off)", () => {
		process.env.FUSION_WORKFLOW_PREFIX_STAGGER_MS = "";
		delete process.env.CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS;
		expect(workflowStaggerMs()).toBe(0);
	});

	it("FUSION_ 优先于 CLAUDE_CODE_", () => {
		process.env.FUSION_WORKFLOW_PREFIX_STAGGER_MS = "100";
		process.env.CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS = "200";
		expect(workflowStaggerMs()).toBe(100);
	});

	it("回退 CLAUDE_CODE_ 当 FUSION_ 未设", () => {
		delete process.env.FUSION_WORKFLOW_PREFIX_STAGGER_MS;
		process.env.CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS = "50";
		expect(workflowStaggerMs()).toBe(50);
	});

	it("非法值 → fail-off (0)", () => {
		process.env.FUSION_WORKFLOW_PREFIX_STAGGER_MS = "abc";
		delete process.env.CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS;
		expect(workflowStaggerMs()).toBe(0);
	});

	it("负数 → fail-off (0)", () => {
		process.env.FUSION_WORKFLOW_PREFIX_STAGGER_MS = "-5";
		delete process.env.CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS;
		expect(workflowStaggerMs()).toBe(0);
	});

	it("NaN 串 → fail-off (0)", () => {
		process.env.FUSION_WORKFLOW_PREFIX_STAGGER_MS = "NaN";
		delete process.env.CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS;
		expect(workflowStaggerMs()).toBe(0);
	});

	it("Infinity 串 → fail-off (0)", () => {
		process.env.FUSION_WORKFLOW_PREFIX_STAGGER_MS = "Infinity";
		delete process.env.CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS;
		expect(workflowStaggerMs()).toBe(0);
	});

	it("有效值 → 原样返回", () => {
		process.env.FUSION_WORKFLOW_PREFIX_STAGGER_MS = "250";
		delete process.env.CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS;
		expect(workflowStaggerMs()).toBe(250);
	});

	it("0 显式 → 0 (off, 但合法)", () => {
		process.env.FUSION_WORKFLOW_PREFIX_STAGGER_MS = "0";
		delete process.env.CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS;
		expect(workflowStaggerMs()).toBe(0);
	});
});

describe("item 25B: runWithConcurrency stagger", () => {
	// 注入 delay 收集每次调用 ms (每 worker k 调 delay(k*staggerMs) 一次, worker 0 跳过)。
	// Promise.all 并发拉起 worker, 调度交错不确定 → 不依赖调用顺序,
	// 仅断言 delayCalls 集合 = 预期错峰序列 (排序后比, 解耦微任务调度)。
	function makeClock() {
		const delayCalls: number[] = [];
		const started: boolean[] = [];
		const delay: DelayFn = async (ms) => {
			delayCalls.push(ms);
		};
		const makeThunk = (id: number) => async () => {
			started[id] = true;
			return id;
		};
		return { delayCalls, started, delay, makeThunk };
	}

	it("staggerMs=0 → 不调 delay (无延迟, 25A byte-identical)", async () => {
		const { delayCalls, delay, makeThunk } = makeClock();
		const thunks = [makeThunk(0), makeThunk(1), makeThunk(2), makeThunk(3)];
		await runWithConcurrency(thunks, 4, 0, delay);
		expect(delayCalls).toEqual([]);
	});

	it("staggerMs=50 → delay 调用 = worker1..3 错峰 [50, 100, 150]", async () => {
		const { delayCalls, delay, makeThunk } = makeClock();
		const thunks = [makeThunk(0), makeThunk(1), makeThunk(2), makeThunk(3)];
		await runWithConcurrency(thunks, 4, 50, delay);
		// worker0 不延迟; worker1/2/3 各 delay(50/100/150)。排序解耦调度。
		expect([...delayCalls].sort((a, b) => a - b)).toEqual([50, 100, 150]);
	});

	it("stagger 仅前 cap 个 worker 错峰 (cap < thunks)", async () => {
		// cap=2, 4 thunks: 仅 worker0/1 初始错峰 (worker0 不延迟, worker1 delay(50))。
		// worker 补位无延迟 → delayCalls 仅 1 项 [50]。
		const { delayCalls, started, delay, makeThunk } = makeClock();
		const thunks = [makeThunk(0), makeThunk(1), makeThunk(2), makeThunk(3)];
		await runWithConcurrency(thunks, 2, 50, delay);
		expect(delayCalls).toEqual([50]);
		// 全 4 thunk 都执行 (补位无丢)。
		expect(started.filter((s) => s === true).length).toBe(4);
	});

	it("staggerMs=0 cap<items 全部完成 (25A 等价)", async () => {
		const { delay, makeThunk } = makeClock();
		const thunks = [makeThunk(0), makeThunk(1), makeThunk(2), makeThunk(3)];
		const results = await runWithConcurrency(thunks, 2, 0, delay);
		expect(results).toEqual([0, 1, 2, 3]);
	});

	it("thunk throw → 该项 null 不连累 (stagger on)", async () => {
		const { delay } = makeClock();
		const thunks = [
			async () => "ok",
			async () => {
				throw new Error("x");
			},
		];
		const results = await runWithConcurrency(thunks, 2, 50, delay);
		expect(results).toContain("ok");
		expect(results).toContain(null);
	});

	it("空 thunks → 空数组 (stagger 不爆)", async () => {
		const { delay } = makeClock();
		const results = await runWithConcurrency([], 4, 50, delay);
		expect(results).toEqual([]);
	});

	it("单 thunk + stagger → 不延迟 (workerIndex 0 无 delay)", async () => {
		const { delayCalls, delay, makeThunk } = makeClock();
		await runWithConcurrency([makeThunk(0)], 4, 100, delay);
		expect(delayCalls).toEqual([]);
	});
});

// ─── audit 1.4.6: workflow budget 原语 (原 STUB remaining()=>Infinity) ───
//
// workflowBudgetTotal env 解析 + createMiscPrimitives 的 budget.spent/remaining 读
// ctx.budgetUsedTokens 真值 (runOneAgent 全 loop 累加, 非 AgentTool 1.4.5 末轮估算)。
// env 未设 = total null = remaining Infinity = 旧 STUB byte-identical。

function makeBudgetCtx(used = 0) {
	return { runId: "test", budgetUsedTokens: used } as unknown as Parameters<
		typeof createMiscPrimitives
	>[0];
}

describe("audit 1.4.6: workflowBudgetTotal env 解析", () => {
	const orig = process.env.FUSION_WORKFLOW_BUDGET_TOKENS;
	afterEach(() => {
		if (orig === undefined) {
			delete process.env.FUSION_WORKFLOW_BUDGET_TOKENS;
		} else {
			process.env.FUSION_WORKFLOW_BUDGET_TOKENS = orig;
		}
	});

	it("env 未设 → null (无强制, byte-identical 旧 STUB total=null)", () => {
		delete process.env.FUSION_WORKFLOW_BUDGET_TOKENS;
		expect(workflowBudgetTotal()).toBeNull();
	});

	it("空串 → null", () => {
		process.env.FUSION_WORKFLOW_BUDGET_TOKENS = "";
		expect(workflowBudgetTotal()).toBeNull();
	});

	it("有效正整数 → 原样返回", () => {
		process.env.FUSION_WORKFLOW_BUDGET_TOKENS = "500000";
		expect(workflowBudgetTotal()).toBe(500000);
	});

	it("0 → 0 (合法, 立即耗尽)", () => {
		process.env.FUSION_WORKFLOW_BUDGET_TOKENS = "0";
		expect(workflowBudgetTotal()).toBe(0);
	});

	it("非法串 → fail-off null", () => {
		process.env.FUSION_WORKFLOW_BUDGET_TOKENS = "abc";
		expect(workflowBudgetTotal()).toBeNull();
	});

	it("负数 → fail-off null", () => {
		process.env.FUSION_WORKFLOW_BUDGET_TOKENS = "-100";
		expect(workflowBudgetTotal()).toBeNull();
	});

	it("Infinity 串 → fail-off null (Number(Infinity)=Infinity, 仍 finite 检查)", () => {
		process.env.FUSION_WORKFLOW_BUDGET_TOKENS = "Infinity";
		expect(workflowBudgetTotal()).toBeNull();
	});
});

describe("audit 1.4.6: budget 原语真值 (替代 STUB)", () => {
	const orig = process.env.FUSION_WORKFLOW_BUDGET_TOKENS;
	afterEach(() => {
		if (orig === undefined) {
			delete process.env.FUSION_WORKFLOW_BUDGET_TOKENS;
		} else {
			process.env.FUSION_WORKFLOW_BUDGET_TOKENS = orig;
		}
	});

	it("env 未设 → total null, remaining Infinity (byte-identical STUB)", () => {
		delete process.env.FUSION_WORKFLOW_BUDGET_TOKENS;
		const { budget } = createMiscPrimitives(makeBudgetCtx(12345));
		expect(budget.total).toBeNull();
		expect(budget.spent()).toBe(12345);
		expect(budget.remaining()).toBe(Number.POSITIVE_INFINITY);
	});

	it("env 设 + 累加器 < total → remaining = total - spent", () => {
		process.env.FUSION_WORKFLOW_BUDGET_TOKENS = "100000";
		const { budget } = createMiscPrimitives(makeBudgetCtx(30000));
		expect(budget.total).toBe(100000);
		expect(budget.spent()).toBe(30000);
		expect(budget.remaining()).toBe(70000);
	});

	it("累加器 == total → remaining 0 (耗尽, 不返负)", () => {
		process.env.FUSION_WORKFLOW_BUDGET_TOKENS = "50000";
		const { budget } = createMiscPrimitives(makeBudgetCtx(50000));
		expect(budget.remaining()).toBe(0);
	});

	it("累加器 > total → remaining 0 (超支钳到 0, 不返负)", () => {
		process.env.FUSION_WORKFLOW_BUDGET_TOKENS = "50000";
		const { budget } = createMiscPrimitives(makeBudgetCtx(80000));
		expect(budget.remaining()).toBe(0);
	});

	it("累加器 0 + total 设 → remaining = total (未花)", () => {
		process.env.FUSION_WORKFLOW_BUDGET_TOKENS = "50000";
		const { budget } = createMiscPrimitives(makeBudgetCtx(0));
		expect(budget.spent()).toBe(0);
		expect(budget.remaining()).toBe(50000);
	});
});
