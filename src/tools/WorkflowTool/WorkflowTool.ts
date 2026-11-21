import { feature } from "bun:bundle";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod/v4";
import type { SetAppState } from "../../Task.js";
import { createTaskStateBase, generateTaskId } from "../../Task.js";
import { buildTool } from "../../Tool.js";
import type { TaskState } from "../../tasks/types.js";
import { logForDebugging } from "../../utils/debug.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { registerTask, updateTaskState } from "../../utils/task/framework.js";
import { emitPerfettoInstant } from "../../utils/telemetry/perfettoTracing.js";
import {
	clearWorkflowAbort,
	countActiveWorkflowRuns,
	registerWorkflowAbort,
} from "./abortRegistry.js";
import { WORKFLOW_TOOL_NAME } from "./constants.js";
import { DESCRIPTION, getPrompt } from "./prompt.js";
import { executeWorkflow, isWorkflowRuntimeEnabled } from "./runtime.js";
import { parseYamlWorkflow } from "./yamlLoader.js";

const inputSchema = lazySchema(() =>
	z.strictObject({
		script: z
			.string()
			.optional()
			.describe(
				"Self-contained workflow script. Must begin with export const meta = { name, description, phases } followed by the script body using agent()/parallel()/pipeline()/phase().",
			),
		name: z
			.string()
			.optional()
			.describe(
				"Name of a predefined workflow (built-in or from .claude/workflows/).",
			),
		args: z
			.unknown()
			.optional()
			.describe(
				"Optional input value exposed to the script as the global args.",
			),
		scriptPath: z
			.string()
			.optional()
			.describe("Path to a workflow script file on disk."),
		resumeFromRunId: z
			.string()
			.optional()
			.describe("Run ID of a prior Workflow invocation to resume from."),
	}),
);
type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
	z.object({
		runId: z.string().optional(),
		status: z.enum(["started", "completed", "error"]),
		message: z.string().optional(),
	}),
);
type OutputSchema = ReturnType<typeof outputSchema>;

export type Output = z.infer<OutputSchema>;

const activeRuns = new Map<string, { status: string; startTime: number }>();

export function getActiveRuns(): Array<{
	runId: string;
	status: string;
	startTime: number;
}> {
	return Array.from(activeRuns.entries()).map(([runId, data]) => ({
		runId,
		...data,
	}));
}

// audit 1.4.1/2.1.3 + 0905 P0-C: no global workflow admission; concurrent workflows multiplied into OOM.
// Default to a finite cap (old =Infinity unbounded = N workflows × 16 agents × MLX requests = OOM).
// FUSION_MAX_CONCURRENT_WORKFLOWS explicitly set to a positive integer overrides; "0" explicitly unbounded (compat with old behavior).
const DEFAULT_MAX_CONCURRENT_WORKFLOWS = 4;
function maxConcurrentWorkflows(): number {
	const raw = process.env.FUSION_MAX_CONCURRENT_WORKFLOWS;
	if (raw === undefined || raw === "") {
		return DEFAULT_MAX_CONCURRENT_WORKFLOWS;
	}
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) {
		logForDebugging(
			`[Workflow] invalid FUSION_MAX_CONCURRENT_WORKFLOWS "${raw}", defaulting to ${DEFAULT_MAX_CONCURRENT_WORKFLOWS}`,
		);
		return DEFAULT_MAX_CONCURRENT_WORKFLOWS;
	}
	if (parsed === 0) return Infinity; // explicitly unbounded (compat with old unbounded behavior)
	return Math.floor(parsed);
}

async function resolveScriptSource(input: {
	script?: string;
	name?: string;
	scriptPath?: string;
}): Promise<string | null> {
	if (input.script) return input.script;

	if (input.scriptPath) {
		try {
			const content = await readFile(input.scriptPath, "utf-8");
			if (
				input.scriptPath.endsWith(".yaml") ||
				input.scriptPath.endsWith(".yml")
			) {
				const converted = parseYamlWorkflow(content, input.scriptPath);
				if (!converted) {
					logForDebugging(
						`[Workflow] failed to parse YAML script: ${input.scriptPath}`,
					);
					return null;
				}
				return converted;
			}
			return content;
		} catch (err) {
			logForDebugging(
				`[Workflow] failed to read script file: ${(err as Error).message}`,
			);
			return null;
		}
	}

	if (input.name) {
		const { homedir } = await import("node:os");
		const { join } = await import("node:path");
		const { access } = await import("node:fs/promises");
		const dir = join(homedir(), ".claude", "workflows");
		for (const ext of [".js", ".ts", ".mjs", ".yaml", ".yml"]) {
			const filePath = join(dir, input.name + ext);
			try {
				await access(filePath);
				const content = await readFile(filePath, "utf-8");
				if (ext === ".yaml" || ext === ".yml") {
					const converted = parseYamlWorkflow(content, input.name);
					if (!converted) {
						logForDebugging(
							`[Workflow] failed to parse YAML workflow: ${filePath}`,
						);
						return null;
					}
					logForDebugging(`[Workflow] converted YAML workflow: ${input.name}`);
					return converted;
				}
				return content;
			} catch {}
		}
		logForDebugging(`[Workflow] workflow "${input.name}" not found in ${dir}`);
		return null;
	}

	return null;
}

export const WorkflowTool = buildTool({
	name: WORKFLOW_TOOL_NAME,
	searchHint: "orchestrate multi-agent workflow",
	maxResultSizeChars: 500_000,
	async description() {
		return DESCRIPTION;
	},
	async prompt() {
		return getPrompt();
	},
	get inputSchema(): InputSchema {
		return inputSchema();
	},
	get outputSchema(): OutputSchema {
		return outputSchema();
	},
	async execute(input, context, canUseTool?, _parentMessage?, onProgress?) {
		// log: fixed execute signature
		const runId = `wf_${randomUUID().slice(0, 8)}`;
		logForDebugging(
			`[Workflow] executing: ${input.name || input.scriptPath || "inline script"}`,
		);

		const scriptSource = await resolveScriptSource(input);
		if (!scriptSource) {
			return {
				data: {
					runId,
					status: "error" as const,
					message:
						"No workflow script provided. Pass script, name, or scriptPath.",
				},
			};
		}

		const hasMeta = scriptSource.includes("export const meta");
		if (!hasMeta) {
			return {
				data: {
					runId,
					status: "error" as const,
					message:
						"Workflow script must begin with: export const meta = { name, description, phases }",
				},
			};
		}

		// Double gate: feature("WORKFLOW_SCRIPTS") (compile time, build:dev:full) AND
		// FUSION_WORKFLOW_RUNTIME_ENABLED=1 (runtime). Runtime runs only when both are satisfied;
		// otherwise byte-identical validation stub (old behavior).
		if (feature("WORKFLOW_SCRIPTS") && isWorkflowRuntimeEnabled()) {
			// audit 1.4.1/2.1.3: global admission cap. Reject when over the cap, no queuing
			// (queuing needs a global scheduler, see the 1.4.3 cross-repo defer). Default Infinity (env unset) = byte-identical unbounded.
			const cap = maxConcurrentWorkflows();
			const inFlight = countActiveWorkflowRuns();
			if (inFlight >= cap) {
				logForDebugging(
					`[Workflow] admission denied: ${inFlight} in-flight >= cap ${cap} (FUSION_MAX_CONCURRENT_WORKFLOWS)`,
				);
				return {
					data: {
						runId,
						status: "error" as const,
						message: `Workflow admission denied: ${inFlight} concurrent workflow${inFlight === 1 ? "" : "s"} already running (cap ${cap === Infinity ? "unlimited" : cap}). Wait for one to finish or raise FUSION_MAX_CONCURRENT_WORKFLOWS.`,
					},
				};
			}

			// audit 1.4.2: create and register the abortController so the kill path can trigger .abort().
			// runtime.ts already checks signal.aborted at lines 328/390; triggering is all that is needed. Previously the controller
			// was orphaned (nowhere stored), so kill never took effect.
			const abortController = context?.abortController ?? new AbortController();
			registerWorkflowAbort(runId, abortController);

			activeRuns.set(runId, { status: "running", startTime: Date.now() });
			emitPerfettoInstant("workflow_run_started", "workflow", { runId });
			logForDebugging(
				`[Workflow] runtime enabled: executing script for run ${runId}`,
			);

			// audit 1.4.2: register the local_workflow task into AppState.tasks so stopTask /
			// killAllActive / the reaper can find and kill it by type=local_workflow.
			// setAppStateForTasks preferred (async agent convention), falling back to setAppState.
			const setAppState = context?.setAppStateForTasks ?? context?.setAppState;
			const registeredTaskId = setAppState
				? generateTaskId("local_workflow")
				: undefined;
			if (registeredTaskId) {
				try {
					registerTask(
						{
							...createTaskStateBase(
								registeredTaskId,
								"local_workflow",
								input.name || input.scriptPath || "workflow",
								undefined,
							),
							type: "local_workflow" as const,
							status: "running" as const,
							agents: [],
							currentAgentIndex: 0,
							abortController,
							runId, // audit 1.4.2: killWorkflowTask looks up the abortRegistry in reverse
							summary: undefined,
						},
						setAppState,
					);
				} catch (err) {
					logForDebugging(
						`[Workflow] failed to register local_workflow task: ${(err as Error).message}`,
					);
				}
			}

			try {
				const result = await executeWorkflow({
					scriptSource,
					args: input.args,
					runId,
					toolUseContext: context,
					canUseTool:
						canUseTool ?? ((async () => ({ behavior: "allow" })) as never),
					querySource: context?.options?.querySource ?? ("tool" as never),
					abortController,
					onProgress: onProgress as never,
				});
				activeRuns.set(runId, { status: "completed", startTime: Date.now() });
				emitPerfettoInstant("workflow_run_completed", "workflow", { runId });
				finalizeWorkflowTask(registeredTaskId, "completed", setAppState);
				return {
					data: {
						runId,
						status: "completed" as const,
						message: `Workflow run completed. Result: ${safeStringify(result)}`,
					},
				};
			} catch (err) {
				activeRuns.set(runId, { status: "error", startTime: Date.now() });
				emitPerfettoInstant("workflow_run_error", "workflow", {
					runId,
					error: String((err as Error).message ?? err),
				});
				// Aborted (killed) → killed message; otherwise the original failure message. LocalWorkflowTask.kill
				// already set the task status to killed; this covers aborts that did not go through the kill path (e.g. parent abort).
				const aborted = abortController.signal.aborted;
				finalizeWorkflowTask(
					registeredTaskId,
					aborted ? "killed" : "failed",
					setAppState,
				);
				return {
					data: {
						runId,
						status: "error" as const,
						message: aborted
							? `Workflow run ${runId} was cancelled.`
							: `Workflow failed: ${(err as Error).message ?? err}`,
					},
				};
			} finally {
				clearWorkflowAbort(runId);
			}
		}

		activeRuns.set(runId, { status: "started", startTime: Date.now() });
		logForDebugging(`[Workflow] run ${runId} started (stub mode)`);

		try {
			const scriptName = input.name || input.scriptPath || "inline";
			logForDebugging(
				`[Workflow] script validated: ${scriptName}, meta export found`,
			);

			return {
				data: {
					runId,
					status: "started" as const,
					message: `Workflow "${scriptName}" started. Use /workflows to monitor progress. Run ID: ${runId}`,
				},
			};
		} catch (err) {
			activeRuns.delete(runId);
			return {
				data: {
					runId,
					status: "error" as const,
					message: `Workflow failed: ${(err as Error).message}`,
				},
			};
		}
	},
	mapToolResultToToolResultBlockParam(content, toolUseID) {
		const { status, message, runId } = content as Output;
		const parts = [`Workflow ${status}`];
		if (runId) parts.push(`runId: ${runId}`);
		if (message) parts.push(message);
		return {
			tool_use_id: toolUseID,
			type: "tool_result",
			content: parts.join(" | "),
		};
	},
});

function safeStringify(value: unknown): string {
	try {
		const s = typeof value === "string" ? value : JSON.stringify(value);
		return s ?? "undefined";
	} catch {
		return String(value);
	}
}

// audit 1.4.2: push the registered local_workflow task to a terminal state (completed/killed/failed).
// Unregistered (registeredTaskId empty) or setAppState missing → no-op. Idempotent: already-terminal states are left alone.
function finalizeWorkflowTask(
	registeredTaskId: string | undefined,
	finalStatus: "completed" | "killed" | "failed",
	setAppState: SetAppState | undefined,
): void {
	if (!registeredTaskId || !setAppState) return;
	try {
		updateTaskState<TaskState>(registeredTaskId, setAppState, (task) => ({
			...task,
			status: finalStatus,
			endTime: Date.now(),
		}));
	} catch (err) {
		logForDebugging(
			`[Workflow] finalizeWorkflowTask(${registeredTaskId}, ${finalStatus}) failed: ${(err as Error).message}`,
		);
	}
}
