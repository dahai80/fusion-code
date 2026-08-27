// Ctx envelope (ar-plan PR #3, S1.a).
// Carries per-session capability handles so consumers read ctx.llm.supportsX()
// instead of scattered provider-if branches. fs/tools/exec seams added in PR #4.
import { logForDebugging } from "../../utils/debug.js";
import { createLlmCapability } from "./capability.js";
import type { LlmCapability } from "./capability.js";

export interface Ctx {
	readonly llm: LlmCapability;
	// ctx.fs/tools added in PR #4 (optional there, absent here).
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
	logForDebugging(
		`[ctx] createCtx session=${sessionId} model=${modelId} provider=${llm.provider} toolCalling=${llm.supportsToolCalling()}`,
	);
	return { llm, cwd, sessionId };
}
