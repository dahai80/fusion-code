// item 25A (CC 2.1.229): 最小 workflow 执行 runtime。
// 双门禁: feature("WORKFLOW_SCRIPTS") (编译期) AND FUSION_WORKFLOW_RUNTIME_ENABLED=1 (运行期)。
// 禁用时 WorkflowTool.execute() 行为 byte-identical 旧桩。
// agent() 用 runAgent drain → getAssistantMessageText 取最终文本, transcriptSubdir="workflows/<runId>"。
// v1 DEFERRED: schema (agent 返回纯文本), 嵌套 workflow() (抛 NotImplemented)。budget 已落地 (audit 1.4.6)。

import type { QuerySource } from "../../constants/querySource.js";
import type { CanUseToolFn } from "../../hooks/useCanUseTool.js";
import type { ToolUseContext } from "../../Tool.js";
import type { AssistantMessage } from "../../types/message.js";
import { logForDebugging } from "../../utils/debug.js";
import {
	createUserMessage,
	getAssistantMessageText,
} from "../../utils/messages.js";
import type { ModelAlias } from "../../utils/model/aliases.js";
import { emitPerfettoInstant } from "../../utils/telemetry/perfettoTracing.js";
import { getTokenCountFromUsage } from "../../utils/tokens.js";
import type { AgentDefinition } from "../AgentTool/loadAgentsDir.js";
import { runAgent } from "../AgentTool/runAgent.js";

// ─── runtime env gate ───

// 运行期门禁。编译期门禁 feature("WORKFLOW_SCRIPTS") 在 WorkflowTool.execute() 内。
// 两层都满足才执行 runtime; 否则 byte-identical 验证桩。
export function isWorkflowRuntimeEnabled(): boolean {
	return process.env.FUSION_WORKFLOW_RUNTIME_ENABLED === "1";
}

// ─── 并发上限 (防 runaway 成本, 对齐 prompt.ts 文档 min(16, cpu-2)) ───

function concurrencyCap(): number {
	const cpus =
		typeof navigator !== "undefined" && navigator.hardwareConcurrency
			? navigator.hardwareConcurrency
			: 4;
	return Math.max(1, Math.min(16, cpus - 2));
}

// ─── 错峰 fan-out (item 25B, CC 2.1.229 PREFIX_STAGGER_MS) ───
//
// 并发池 worker 启动前错峰延迟, 让后启 agent 复用先启 agent 已预热的 prompt
// prefix 缓存 (本地 MLX 无 KV 共享时兄弟 agent 各自重算 prefill, 错峰给复用窗口)。
// default off: env 未设/非法 → 0 = 25A byte-identical (无延迟, 同时拉起)。
// 仅初始 burst 错峰 (前 cap 个 worker), 后续 worker 补位无延迟 (一进一出, 无 burst)。

// 测试用导出 (同 extractMeta)。生产仅内部 createParallel/PipelinePrimitive 调。
export function workflowStaggerMs(): number {
	// FUSION_ 优先 (fusion-code 约定), 回落 CC 原名。
	const raw =
		process.env.FUSION_WORKFLOW_PREFIX_STAGGER_MS ??
		process.env.CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS;
	if (raw === undefined || raw === "") return 0;
	const parsed = Number(raw);
	// 非数/负数/NaN → fail-off = 0 (不阻塞, 25A 行为)。
	if (!Number.isFinite(parsed) || parsed < 0) {
		logForDebugging(
			`[Workflow] invalid PREFIX_STAGGER_MS "${raw}", defaulting to 0 (off)`,
		);
		return 0;
	}
	return parsed;
}

// ─── audit 1.4.6: workflow token 预算门 (原 budget STUB remaining()=>Infinity) ───
//
// budget 原语曾恒返 Infinity → workflow 脚本的自限预算逻辑静默失效, 长 workflow 无界跑。
// 真实预算: AgentCtx.budgetUsedTokens 累加每次 agent() 全 loop token (runOneAgent 对
// 所有 collected AssistantMessage.message.usage 求和, 非 AgentTool 1.4.5 的末轮估算),
// budget.total 取 FUSION_WORKFLOW_BUDGET_TOKENS (null = 无强制 → remaining Infinity,
// 与旧 STUB byte-identical); spent() 返累加器真值; remaining() = total==null ? Infinity
// : max(0, total-spent)。env 未设 = total null = 旧行为。runtime 双门禁 (feature
// WORKFLOW_SCRIPTS + FUSION_WORKFLOW_RUNTIME_ENABLED) 默认关 → off path byte-identical。
export function workflowBudgetTotal(): number | null {
	const raw = process.env.FUSION_WORKFLOW_BUDGET_TOKENS;
	if (raw === undefined || raw === "") return null;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) {
		logForDebugging(
			`[Workflow] invalid FUSION_WORKFLOW_BUDGET_TOKENS "${raw}", defaulting to null (no cap)`,
		);
		return null;
	}
	return parsed;
}

// 默认延迟函数。测试可注入同步/短延迟实现 (无 fake-timer, 复用 item 16 教训)。
export type DelayFn = (ms: number) => Promise<void>;
const defaultDelay: DelayFn = (ms) =>
	ms > 0
		? new Promise<void>((resolve) => setTimeout(resolve, ms))
		: Promise.resolve();

// ─── 并发池: 限并发 cap, 每 thunk throw→该项 null (不 reject 整体) ───
//
// staggerMs > 0: worker k 在首任务前 wait (k * staggerMs) — 仅前 cap 个 worker,
// 错开初始 burst。第 idx 项在哪 worker 不定 (next++ 抢占), 但启动延迟按 worker 编号错峰。
// staggerMs = 0: 无延迟, 25A 行为 byte-identical。

// 测试用导出 (注入 delayFn 验错峰顺序, 无 fake-timer)。
export async function runWithConcurrency<T>(
	thunks: Array<() => Promise<T>>,
	cap: number,
	staggerMs = 0,
	delay: DelayFn = defaultDelay,
): Promise<Array<T | null>> {
	const results: Array<T | null> = new Array(thunks.length).fill(null);
	let next = 0;
	const worker = async (workerIndex: number) => {
		// 初始 burst 错峰: worker k 等 k * staggerMs 后开始抢任务。
		if (staggerMs > 0 && workerIndex > 0) {
			await delay(workerIndex * staggerMs);
		}
		while (true) {
			const idx = next++;
			if (idx >= thunks.length) return;
			try {
				results[idx] = await thunks[idx]();
			} catch (err) {
				// Rule 12: 单项失败不连累整体, 该项记 null。
				logForDebugging(
					`[Workflow] parallel item ${idx} failed: ${(err as Error).message}`,
				);
				results[idx] = null;
			}
		}
	};
	const workerCount = Math.min(cap, thunks.length);
	const workers = Array.from({ length: workerCount }, (_, i) => worker(i));
	await Promise.all(workers);
	return results;
}

// ─── meta 抽取 (花括号平衡计数器, 支持嵌套对象) ───

// 返回 { meta, body } — meta 为解析后的对象, body 为剥除 const meta = ...; 后的余串。
// marker 可为 "export const meta" 或 "const __meta__" (转译后)。
// 失败抛 Error (fail visibly)。
function extractMetaFrom(
	source: string,
	marker: string,
): {
	meta: { name: string; description: string; phases?: unknown };
	body: string;
} {
	const start = source.indexOf(marker);
	if (start === -1) {
		throw new Error(
			"Workflow script must begin with: export const meta = { name, description, phases }",
		);
	}
	// 定位 "=" 后首个 "{" 开始花括号平衡。
	const eq = source.indexOf("=", start);
	if (eq === -1) throw new Error("meta declaration missing '='");
	let i = eq + 1;
	while (i < source.length && source[i] !== "{") i++;
	if (i >= source.length) {
		throw new Error("meta declaration missing object literal");
	}
	const objStart = i;
	let depth = 0;
	let inStr: string | null = null;
	for (; i < source.length; i++) {
		const ch = source[i];
		if (inStr) {
			if (ch === "\\") {
				i++;
				continue;
			}
			if (ch === inStr) inStr = null;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			inStr = ch;
			continue;
		}
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) {
				i++;
				break;
			}
		}
	}
	if (depth !== 0) throw new Error("meta declaration: unbalanced braces");
	const objStr = source.slice(objStart, i);
	let meta: { name: string; description: string; phases?: unknown };
	try {
		// new Function 求对象字面量 (eval 受双门禁防护)。
		meta = new Function(`return (${objStr})`)() as typeof meta;
	} catch (err) {
		throw new Error(
			`meta declaration: invalid object literal: ${(err as Error).message}`,
		);
	}
	if (
		!meta ||
		typeof meta.name !== "string" ||
		typeof meta.description !== "string"
	) {
		throw new Error("meta declaration: name and description must be strings");
	}
	// 剥 marker...= ...; 语句 → 余 body。吞掉尾随 ";"。
	let stmtEnd = i;
	if (source[stmtEnd] === ";") stmtEnd++;
	const body = (source.slice(0, start) + source.slice(stmtEnd)).trim();
	return { meta, body };
}

// 对外导出: 在原始 (未转译) 源上抽 meta (marker = "export const meta")。
// 测试用。生产 evaluateScript 在转译后抽。
export function extractMeta(source: string): {
	meta: { name: string; description: string; phases?: unknown };
	body: string;
} {
	return extractMetaFrom(source, "export const meta");
}

// ─── script eval (transpile → 抽 meta → 剥 export → async IIFE 封装) ───

// 注意: new Function eval model-authored 脚本 (全局作用域), 理论可触危险全局。
// 双门禁防护 (编译+运行), 对齐 CC 自身 Workflow 工具风险接受。完整沙箱超 v1 范围。
// transpile 失败 → 跳转译仅支持纯 JS (报 .ts 源 error 时由 catch 显式抛)。
type PrimitiveArgs = {
	args: unknown;
	agent: AgentPrimitive;
	parallel: ParallelPrimitive;
	pipeline: PipelinePrimitive;
	phase: (title: string) => void;
	log: (message: string) => void;
	workflow: WorkflowPrimitive;
	budget: BudgetStub;
};

export async function evaluateScript(
	scriptSource: string,
	primitives: PrimitiveArgs,
): Promise<unknown> {
	// 转译流水线: 脚本含顶层 await/return + export const meta (非合法 ESM),
	// 直接 Bun.Transpiler(loader:ts) 会抛 (module 不许顶层 return/export)。
	// 变换: export const meta → const __meta__ (保留对象, 去除 export 关键字),
	//       包 async function _w(){...} (使顶层 await/return 合法), 转译剥 TS 类型,
	//       拆包 → 余 body。
	let body: string;
	const metaMarker = "export const meta";
	const hasMetaMarker = scriptSource.includes(metaMarker);
	try {
		const noExport = hasMetaMarker
			? scriptSource.replace(metaMarker, "const __meta__")
			: scriptSource;
		const wrapped = `async function _w() {\n${noExport}\n}`;
		const transpiled = new Bun.Transpiler({ loader: "ts" }).transformSync(
			wrapped,
		);
		// 拆包: 去首行 "async function _w() {" 与尾 "}"。
		const inner = transpiled
			.replace(/^\s*async function _w\(\)\s*\{/, "")
			.replace(/\}\s*$/, "");
		// 抽 meta (转译后 marker = "const __meta__") 并剥除 → body。
		if (!hasMetaMarker) {
			throw new Error(
				"Workflow script must begin with: export const meta = { name, description, phases }",
			);
		}
		const extracted = extractMetaFrom(inner, "const __meta__");
		body = extracted.body;
	} catch (err) {
		// 转译失败: 退回原串抽 meta (仅支持纯 JS 源)。
		if (err instanceof Error && err.message.includes("export const meta")) {
			throw err;
		}
		logForDebugging(
			`[Workflow] transpile failed, using raw source: ${(err as Error).message}`,
		);
		const extracted = extractMeta(scriptSource);
		body = extracted.body;
	}

	// 校验无残留语句级 export (new Function 会抛)。
	if (/\bexport\b\s/.test(body)) {
		throw new Error(
			"Workflow script body must not contain additional export statements",
		);
	}

	// 封装: agent/parallel/... 作函数参数(在作用域内), 顶层 await+return 在 async IIFE 内合法。
	const fn = new Function(
		"args",
		"agent",
		"parallel",
		"pipeline",
		"phase",
		"log",
		"workflow",
		"budget",
		`return (async () => {\n${body}\n})();`,
	) as (
		args: unknown,
		agent: AgentPrimitive,
		parallel: ParallelPrimitive,
		pipeline: PipelinePrimitive,
		phase: (title: string) => void,
		log: (message: string) => void,
		workflow: WorkflowPrimitive,
		budget: BudgetStub,
	) => Promise<unknown>;

	const result = await fn(
		primitives.args,
		primitives.agent,
		primitives.parallel,
		primitives.pipeline,
		primitives.phase,
		primitives.log,
		primitives.workflow,
		primitives.budget,
	);
	return result;
}

// ─── agent() primitive ───

// agent(prompt, opts?) → string|null (最终 assistant 文本)。subagent 死/无文本 → null。
// schema DEFERRED: 传 opts.schema 记 warn 忽略, 返回纯文本。
type AgentOpts = {
	label?: string;
	phase?: string;
	model?: ModelAlias;
	effort?: string;
	agentType?: string;
	schema?: unknown;
};
type AgentPrimitive = (
	prompt: string,
	opts?: AgentOpts,
) => Promise<string | null>;

type AgentCtx = {
	runId: string;
	toolUseContext: ToolUseContext;
	canUseTool: CanUseToolFn;
	querySource: QuerySource;
	abortController: AbortController;
	onProgress?: (event: { type: string; [k: string]: unknown }) => void;
	// audit 1.4.6: 每次 agent() 全 loop token 累加 (runOneAgent 求和所有
	// collected usage)。budget.spent/remaining 读此真值, 替代 STUB 恒 0/Infinity。
	budgetUsedTokens: number;
};

function createAgentPrimitive(ctx: AgentCtx): AgentPrimitive {
	let agentCounter = 0;
	return async (prompt, opts) => {
		if (ctx.abortController.signal.aborted) {
			throw new Error("Workflow aborted");
		}
		if (opts?.schema) {
			logForDebugging(
				`[Workflow] agent() schema option not supported in v1, ignoring`,
			);
		}
		const agentType = opts?.agentType ?? "general-purpose";
		const agentDefinition: AgentDefinition | undefined =
			ctx.toolUseContext.options.agentDefinitions.activeAgents.find(
				(a) => a.agentType === agentType,
			);
		if (!agentDefinition) {
			logForDebugging(
				`[Workflow] agent type "${agentType}" not found, defaulting to general-purpose`,
			);
			const fallback =
				ctx.toolUseContext.options.agentDefinitions.activeAgents.find(
					(a) => a.agentType === "general-purpose",
				);
			if (!fallback) {
				throw new Error(`No agent available for type "${agentType}"`);
			}
			return runOneAgent(ctx, fallback, prompt, opts, ++agentCounter);
		}
		return runOneAgent(ctx, agentDefinition, prompt, opts, ++agentCounter);
	};
}

async function runOneAgent(
	ctx: AgentCtx,
	agentDefinition: AgentDefinition,
	prompt: string,
	opts: AgentOpts | undefined,
	idx: number,
): Promise<string | null> {
	const promptMessages = [createUserMessage({ content: prompt })];
	const transcriptSubdir = `workflows/${ctx.runId}`;
	const label = opts?.label ?? `${agentDefinition.agentType}-${idx}`;
	ctx.onProgress?.({ type: "agent_start", label, phase: opts?.phase });
	emitPerfettoInstant("workflow_agent_start", "workflow", {
		runId: ctx.runId,
		agentType: agentDefinition.agentType,
		label,
	});

	const collected: AssistantMessage[] = [];
	const generator = runAgent({
		agentDefinition,
		promptMessages,
		toolUseContext: ctx.toolUseContext,
		canUseTool: ctx.canUseTool,
		isAsync: false,
		querySource: ctx.querySource,
		availableTools: ctx.toolUseContext.options.tools,
		override: { abortController: ctx.abortController },
		model: opts?.model,
		transcriptSubdir,
	});

	for await (const message of generator) {
		if (ctx.abortController.signal.aborted) {
			throw new Error("Workflow aborted");
		}
		if (message.type === "assistant") {
			collected.push(message as AssistantMessage);
		}
	}

	// 取最后一条 assistant 消息的文本 (finalizeAgentTool 太重, 直接取)。
	const last = collected[collected.length - 1];
	const text = last ? getAssistantMessageText(last) : null;

	// audit 1.4.6: 累加本 agent 全 loop token (所有 collected assistant usage 求和,
	// 非 AgentTool 1.4.5 末轮估算)。message.usage 可能 undefined (虚拟/错误消息) → guard。
	// budget.spent/remaining 读此 ctx.budgetUsedTokens 真值, 替代 STUB 恒 0/Infinity。
	for (const msg of collected) {
		if (msg.message?.usage) {
			ctx.budgetUsedTokens += getTokenCountFromUsage(msg.message.usage);
		}
	}
	ctx.onProgress?.({
		type: "agent_end",
		label,
		phase: opts?.phase,
		hasText: text != null,
	});
	emitPerfettoInstant("workflow_agent_end", "workflow", {
		runId: ctx.runId,
		label,
		hasText: text != null,
	});
	return text;
}

// ─── parallel / pipeline primitives ───

type ParallelPrimitive = <T>(
	thunks: Array<() => Promise<T>>,
) => Promise<Array<T | null>>;

function createParallelPrimitive(): ParallelPrimitive {
	return async (thunks) =>
		runWithConcurrency(thunks, concurrencyCap(), workflowStaggerMs());
}

type Stage = (
	prev: unknown,
	original: unknown,
	index: number,
) => Promise<unknown>;
type PipelinePrimitive = (
	items: unknown[],
	...stages: Array<Stage>
) => Promise<Array<unknown | null>>;

function createPipelinePrimitive(): PipelinePrimitive {
	return async (items, ...stages) => {
		// 每 item 独立穿所有 stage (无 barrier)。stage throw → 该 item drop null 跳余 stage。
		const thunks = items.map((original, index) => async () => {
			let prev: unknown = null;
			for (const stage of stages) {
				try {
					prev = await stage(prev, original, index);
				} catch (err) {
					logForDebugging(
						`[Workflow] pipeline item ${index} stage failed: ${(err as Error).message}`,
					);
					return null;
				}
			}
			return prev;
		});
		return runWithConcurrency(thunks, concurrencyCap(), workflowStaggerMs());
	};
}

// ─── phase / log / workflow / budget primitives ───

type WorkflowPrimitive = (
	nameOrRef: string,
	args?: unknown,
) => Promise<unknown>;
type BudgetStub = {
	total: number | null;
	spent: () => number;
	remaining: () => number;
};

// audit 1.4.6: 导出供单测 (createMiscPrimitives 构建 budget/spent/remaining 读
// ctx.budgetUsedTokens 真值; 测注入 fake ctx.budgetUsedTokens + env total)。
export function createMiscPrimitives(ctx: AgentCtx): {
	phase: (title: string) => void;
	log: (message: string) => void;
	workflow: WorkflowPrimitive;
	budget: BudgetStub;
} {
	let currentPhase = "";
	return {
		phase(title) {
			currentPhase = title;
			emitPerfettoInstant("workflow_phase", "workflow", {
				runId: ctx.runId,
				phase: title,
			});
		},
		log(message) {
			ctx.onProgress?.({ type: "log", message, phase: currentPhase });
			logForDebugging(`[Workflow ${ctx.runId}] ${message}`);
		},
		// 嵌套 workflow DEFERRED v1 (spec 限一层)。
		async workflow(_nameOrRef, _args) {
			throw new Error(
				"nested workflow() not supported in minimal runtime (v1)",
			);
		},
		// audit 1.4.6: 真实 token 预算 (原 STUB remaining()=>Infinity 静默失效)。
		// total = FUSION_WORKFLOW_BUDGET_TOKENS (null = 无强制 → remaining Infinity,
		// 与旧 STUB byte-identical)。spent 读 ctx.budgetUsedTokens (runOneAgent
		// 全 loop 累加)。remaining = total==null ? Infinity : max(0, total-spent)。
		budget: {
			total: workflowBudgetTotal(),
			spent: () => ctx.budgetUsedTokens,
			remaining: () => {
				const cap = workflowBudgetTotal();
				return cap == null
					? Number.POSITIVE_INFINITY
					: Math.max(0, cap - ctx.budgetUsedTokens);
			},
		},
	};
}

// ─── executeWorkflow entry ───

type ExecuteWorkflowParams = {
	scriptSource: string;
	args: unknown;
	runId: string;
	toolUseContext: ToolUseContext;
	canUseTool: CanUseToolFn;
	querySource: QuerySource;
	abortController: AbortController;
	onProgress?: (event: { type: string; [k: string]: unknown }) => void;
};

// 抛错由调用方 (WorkflowTool.execute) catch → activeRuns error + 返回 error。
// 成功返回脚本 return 的结果对象 (可 undefined)。
export async function executeWorkflow(
	params: ExecuteWorkflowParams,
): Promise<unknown> {
	const ctx: AgentCtx = {
		runId: params.runId,
		toolUseContext: params.toolUseContext,
		canUseTool: params.canUseTool,
		querySource: params.querySource,
		abortController: params.abortController,
		onProgress: params.onProgress,
		budgetUsedTokens: 0,
	};
	const agent = createAgentPrimitive(ctx);
	const parallel = createParallelPrimitive();
	const pipeline = createPipelinePrimitive();
	const { phase, log, workflow, budget } = createMiscPrimitives(ctx);

	const primitives: PrimitiveArgs = {
		args: params.args,
		agent,
		parallel,
		pipeline,
		phase,
		log,
		workflow,
		budget,
	};

	logForDebugging(`[Workflow] run ${params.runId} executing runtime`);
	return evaluateScript(params.scriptSource, primitives);
}
