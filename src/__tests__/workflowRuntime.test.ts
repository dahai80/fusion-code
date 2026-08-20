/**
 * item 25A: 最小 workflow 执行 runtime 单测 (CC 2.1.229)
 */
import { describe, expect, it } from "bun:test";
import {
	evaluateScript,
	extractMeta,
	isWorkflowRuntimeEnabled,
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
