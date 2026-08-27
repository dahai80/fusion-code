// Ctx envelope (ar-plan PR #3 S1.a + PR #4 S1.b-e).
// Carries per-session capability handles so consumers read ctx.llm.supportsX()
// / ctx.fs.read() / ctx.tools.list() instead of importing concrete adapters.
// fs + tools are pure facades (always present, invoked only by migrated
// consumers — 0 this PR). exec + sandbox are opt-in env-gated (default off →
// undefined → byte-identical). Existing BashTool routing stays untouched.
import { logForDebugging } from "../../utils/debug.js";
import { createLlmCapability } from "./capability.js";
import type { LlmCapability } from "./capability.js";
import type { FsCapability } from "./capabilities/fs.js";
import type { ToolsCapability } from "./capabilities/tools.js";
import type { ExecCapability } from "./capabilities/exec.js";
import type { SandboxCapability } from "./capabilities/sandbox.js";

export interface Ctx {
	readonly llm: LlmCapability;
	readonly fs: FsCapability;
	readonly tools: ToolsCapability;
	readonly exec?: ExecCapability;
	readonly sandbox?: SandboxCapability;
	readonly cwd: string;
	readonly sessionId: string;
}

// Build a Ctx for a session. Async because MLX capability resolution probes
// the local model server (getMlxModelCapabilities). Consumers that can't await
// keep using the old provider-if path (byte-identical fallback).
export async function createCtx(
	modelId: string,
	cwd: string,
	sessionId: string,
): Promise<Ctx> {
	const llm = await createLlmCapability(modelId);
	const { LocalFsCapability } = await import("./capabilities/fs.js");
	const { BaseToolsCapability } = await import("./capabilities/tools.js");
	// Build with a mutable exec slot, then return as the readonly Ctx.
	let exec: ExecCapability | undefined;
	// exec seam opt-in (default off, byte-identical when off). Picks executor
	// backend when the executor is routable, else in-process.
	if (process.env.FUSION_CODE_CTX_EXEC_ENABLED === "1") {
		const { InProcessExecCapability, ExecutorExecCapability } = await import(
			"./capabilities/exec.js"
		);
		const { isExecutorRouteable } = await import(
			"../executor/executorDriver.js"
		);
		exec = isExecutorRouteable({ command: "" })
			? new ExecutorExecCapability()
			: new InProcessExecCapability(cwd);
	}
	const ctx: Ctx = {
		llm,
		fs: new LocalFsCapability(cwd),
		tools: new BaseToolsCapability(),
		exec,
		cwd,
		sessionId,
	};
	logForDebugging(
		`[ctx] createCtx session=${sessionId} model=${modelId} provider=${llm.provider} toolCalling=${llm.supportsToolCalling()} exec=${ctx.exec ? ctx.exec.backend : "off"}`,
	);
	return ctx;
}
