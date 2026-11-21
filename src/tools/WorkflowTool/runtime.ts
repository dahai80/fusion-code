// item 25A (CC 2.1.229): minimal workflow execution runtime.
// Double gate: feature("WORKFLOW_SCRIPTS") (compile time) AND FUSION_WORKFLOW_RUNTIME_ENABLED=1 (runtime).
// When disabled, WorkflowTool.execute() behaves byte-identical to the old stub.
// agent() uses runAgent drain → getAssistantMessageText for the final text, transcriptSubdir="workflows/<runId>".
// v1 DEFERRED: schema (agent returns plain text), nested workflow() (throws NotImplemented). budget landed (audit 1.4.6).

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

// Runtime gate. The compile-time gate feature("WORKFLOW_SCRIPTS") lives inside WorkflowTool.execute().
// The runtime executes only when both layers are satisfied; otherwise byte-identical validation stub.
export function isWorkflowRuntimeEnabled(): boolean {
	return process.env.FUSION_WORKFLOW_RUNTIME_ENABLED === "1";
}

// ─── concurrency cap (prevents runaway cost, aligned with prompt.ts docs min(16, cpu-2)) ───

function concurrencyCap(): number {
	const cpus =
		typeof navigator !== "undefined" && navigator.hardwareConcurrency
			? navigator.hardwareConcurrency
			: 4;
	return Math.max(1, Math.min(16, cpus - 2));
}

// ─── staggered fan-out (item 25B, CC 2.1.229 PREFIX_STAGGER_MS) ───
//
// Stagger the start of concurrent-pool workers so later agents can reuse the prompt
// prefix cache already warmed by earlier agents (local MLX without KV sharing makes sibling
// agents recompute prefill; staggering gives a reuse window).
// default off: env unset/invalid → 0 = 25A byte-identical (no delay, all started at once).
// Only the initial burst is staggered (first cap workers); replacement workers start with no delay (one in, one out, no burst).

// Exported for tests (same as extractMeta). Production only calls it internally from createParallel/PipelinePrimitive.
export function workflowStaggerMs(): number {
	// FUSION_ name preferred (fusion-code convention), falls back to the CC original name.
	const raw =
		process.env.FUSION_WORKFLOW_PREFIX_STAGGER_MS ??
		process.env.FUSION_CODE_WORKFLOW_PREFIX_STAGGER_MS;
	if (raw === undefined || raw === "") return 0;
	const parsed = Number(raw);
	// Non-numeric/negative/NaN → fail-off = 0 (no blocking, 25A behavior).
	if (!Number.isFinite(parsed) || parsed < 0) {
		logForDebugging(
			`[Workflow] invalid PREFIX_STAGGER_MS "${raw}", defaulting to 0 (off)`,
		);
		return 0;
	}
	return parsed;
}

// ─── audit 1.4.6: workflow token budget gate (previously budget STUB remaining()=>Infinity) ───
//
// The budget primitive used to always return Infinity → workflow scripts' self-limiting budget
// logic silently did nothing and long workflows ran unbounded.
// Real budget: AgentCtx.budgetUsedTokens accumulates the full-loop tokens of every agent() call (runOneAgent
// sums all collected AssistantMessage.message.usage, not the AgentTool 1.4.5 last-round estimate),
// budget.total comes from FUSION_WORKFLOW_BUDGET_TOKENS (null = no enforcement → remaining Infinity,
// byte-identical to the old STUB); spent() returns the accumulator's true value; remaining() = total==null ? Infinity
// : max(0, total-spent). Env unset = total null = old behavior. The runtime double gate (feature
// WORKFLOW_SCRIPTS + FUSION_WORKFLOW_RUNTIME_ENABLED) defaults off → off path byte-identical.
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

// Default delay function. Tests can inject a synchronous/short-delay implementation (no fake timers; reuses the item 16 lesson).
export type DelayFn = (ms: number) => Promise<void>;
const defaultDelay: DelayFn = (ms) =>
	ms > 0
		? new Promise<void>((resolve) => setTimeout(resolve, ms))
		: Promise.resolve();

// ─── concurrency pool: bounded by cap, each thunk throw → that item null (does not reject the whole) ───
//
// staggerMs > 0: worker k waits (k * staggerMs) before its first task — only the first cap workers,
// staggering the initial burst. Which worker picks up item idx is nondeterministic (next++ race), but start delays are staggered by worker index.
// staggerMs = 0: no delay, 25A behavior byte-identical.

// Exported for tests (inject delayFn to verify stagger order, no fake timers).
export async function runWithConcurrency<T>(
	thunks: Array<() => Promise<T>>,
	cap: number,
	staggerMs = 0,
	delay: DelayFn = defaultDelay,
): Promise<Array<T | null>> {
	const results: Array<T | null> = new Array(thunks.length).fill(null);
	let next = 0;
	const worker = async (workerIndex: number) => {
		// Initial burst stagger: worker k waits k * staggerMs before starting to claim tasks.
		if (staggerMs > 0 && workerIndex > 0) {
			await delay(workerIndex * staggerMs);
		}
		while (true) {
			const idx = next++;
			if (idx >= thunks.length) return;
			try {
				results[idx] = await thunks[idx]();
			} catch (err) {
				// Rule 12: a single item's failure does not sink the whole; record null for that item.
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

// ─── meta extraction (brace-balancing counter, supports nested objects) ───

// Returns { meta, body } — meta is the parsed object, body is the remainder after stripping the const meta = ...; statement.
// The marker can be "export const meta" or "const __meta__" (after transpilation).
// Failure throws Error (fail visibly).
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
	// Locate the first "{" after "=" and start brace balancing.
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
		// Evaluate the object literal with new Function (eval is protected by the double gate).
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
	// Strip the marker...= ...; statement → remaining body. Swallow the trailing ";".
	let stmtEnd = i;
	if (source[stmtEnd] === ";") stmtEnd++;
	const body = (source.slice(0, start) + source.slice(stmtEnd)).trim();
	return { meta, body };
}

// Exported: extracts meta from the raw (untranspiled) source (marker = "export const meta").
// For tests. Production evaluateScript extracts after transpilation.
export function extractMeta(source: string): {
	meta: { name: string; description: string; phases?: unknown };
	body: string;
} {
	return extractMetaFrom(source, "export const meta");
}

// ─── script eval (transpile → extract meta → strip export → wrap in async IIFE) ───

// Note: new Function evaluates the model-authored script (global scope), which can in theory
// reach dangerous globals. Protected by the double gate (compile+run), matching the risk acceptance
// of CC's own Workflow tool. A full sandbox is beyond v1 scope.
// If transpile fails → skip transpilation and support pure JS only (a .ts-source error is thrown explicitly by the catch).
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
	// Transpile pipeline: the script has top-level await/return + export const meta (not valid ESM),
	// so Bun.Transpiler(loader:ts) directly would throw (modules do not allow top-level return/export).
	// Transform: export const meta → const __meta__ (keep the object, drop the export keyword),
	//       wrap in async function _w(){...} (making top-level await/return legal), transpile strips TS types,
	//       unwrap → remaining body.
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
		// Unwrap: remove the leading "async function _w() {" line and the trailing "}".
		const inner = transpiled
			.replace(/^\s*async function _w\(\)\s*\{/, "")
			.replace(/\}\s*$/, "");
		// Extract meta (post-transpile marker = "const __meta__") and strip it → body.
		if (!hasMetaMarker) {
			throw new Error(
				"Workflow script must begin with: export const meta = { name, description, phases }",
			);
		}
		const extracted = extractMetaFrom(inner, "const __meta__");
		body = extracted.body;
	} catch (err) {
		// Transpile failed: fall back to extracting meta from the raw source (pure JS sources only).
		if (err instanceof Error && err.message.includes("export const meta")) {
			throw err;
		}
		logForDebugging(
			`[Workflow] transpile failed, using raw source: ${(err as Error).message}`,
		);
		const extracted = extractMeta(scriptSource);
		body = extracted.body;
	}

	// Validate there are no leftover statement-level exports (new Function would throw).
	if (/\bexport\b\s/.test(body)) {
		throw new Error(
			"Workflow script body must not contain additional export statements",
		);
	}

	// Wrap: agent/parallel/... passed as function parameters (in scope); top-level await+return is legal inside the async IIFE.
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

// agent(prompt, opts?) → string|null (final assistant text). Subagent died / no text → null.
// schema DEFERRED: passing opts.schema logs a warn and is ignored; plain text is returned.
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
	// audit 1.4.6: full-loop token accumulation across every agent() call (runOneAgent sums all
	// collected usage). budget.spent/remaining read this true value, replacing the STUB's constant 0/Infinity.
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

	// Take the text of the last assistant message (finalizeAgentTool is too heavy; take it directly).
	const last = collected[collected.length - 1];
	const text = last ? getAssistantMessageText(last) : null;

	// audit 1.4.6: accumulate this agent's full-loop tokens (sum of all collected assistant usage,
	// not the AgentTool 1.4.5 last-round estimate). message.usage may be undefined (synthetic/error messages) → guard.
	// budget.spent/remaining read this ctx.budgetUsedTokens true value, replacing the STUB's constant 0/Infinity.
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
		// Each item independently passes through all stages (no barrier). A stage throw → that item is dropped as null, skipping the remaining stages.
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

// audit 1.4.6: exported for unit tests (createMiscPrimitives builds budget/spent/remaining reading
// ctx.budgetUsedTokens truth; tests inject a fake ctx.budgetUsedTokens + env total).
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
		// Nested workflow DEFERRED v1 (spec allows one level only).
		async workflow(_nameOrRef, _args) {
			throw new Error(
				"nested workflow() not supported in minimal runtime (v1)",
			);
		},
		// audit 1.4.6: real token budget (the previous STUB remaining()=>Infinity silently did nothing).
		// total = FUSION_WORKFLOW_BUDGET_TOKENS (null = no enforcement → remaining Infinity,
		// byte-identical to the old STUB). spent reads ctx.budgetUsedTokens (runOneAgent
		// full-loop accumulation). remaining = total==null ? Infinity : max(0, total-spent).
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

// Throws are caught by the caller (WorkflowTool.execute) → activeRuns error + error return.
// On success, returns the result object the script returned (may be undefined).
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
