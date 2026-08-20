import { feature } from "bun:bundle";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod/v4";
import { buildTool } from "../../Tool.js";
import { logForDebugging } from "../../utils/debug.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { emitPerfettoInstant } from "../../utils/telemetry/perfettoTracing.js";
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

		// 双门禁: feature("WORKFLOW_SCRIPTS") (编译期, build:dev:full) AND
		// FUSION_WORKFLOW_RUNTIME_ENABLED=1 (运行期)。两层都满足才跑 runtime;
		// 否则 byte-identical 验证桩 (旧行为)。
		if (feature("WORKFLOW_SCRIPTS") && isWorkflowRuntimeEnabled()) {
			activeRuns.set(runId, { status: "running", startTime: Date.now() });
			emitPerfettoInstant("workflow_run_started", "workflow", { runId });
			logForDebugging(
				`[Workflow] runtime enabled: executing script for run ${runId}`,
			);
			try {
				const result = await executeWorkflow({
					scriptSource,
					args: input.args,
					runId,
					toolUseContext: context,
					canUseTool:
						canUseTool ?? ((async () => ({ behavior: "allow" })) as never),
					querySource: context?.options?.querySource ?? ("tool" as never),
					abortController: context?.abortController ?? new AbortController(),
					onProgress: onProgress as never,
				});
				activeRuns.set(runId, { status: "completed", startTime: Date.now() });
				emitPerfettoInstant("workflow_run_completed", "workflow", { runId });
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
				return {
					data: {
						runId,
						status: "error" as const,
						message: `Workflow failed: ${(err as Error).message ?? err}`,
					},
				};
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
