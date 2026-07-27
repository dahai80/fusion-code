/**
 * TerminalCaptureTool — 终端捕获工具
 *
 * 允许 AI 模型捕获终端输出、运行命令并获取结果。
 * 与 BashTool 类似但专注于捕获模式：运行命令、捕获输出、返回结果。
 *
 * gated by feature('TERMINAL_PANEL')
 */

import { execa } from "execa";
import { z } from "zod/v4";
import { buildTool, type ToolDef } from "../../Tool.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { TERMINAL_CAPTURE_TOOL_NAME } from "./prompt.js";

export { TERMINAL_CAPTURE_TOOL_NAME };

// ─── Input Schema ───────────────────────────────────────────

const inputSchema = lazySchema(() =>
	z.strictObject({
		command: z.string().describe("The shell command to run"),
		description: z
			.string()
			.optional()
			.describe("A brief description of what the command does"),
		timeout: z
			.number()
			.int()
			.min(1000)
			.max(300_000)
			.optional()
			.default(30_000)
			.describe("Timeout in milliseconds (default: 30s, max: 300s)"),
		workdir: z
			.string()
			.optional()
			.describe("Working directory for the command"),
	}),
);
type InputSchema = ReturnType<typeof inputSchema>;

// ─── Output Schema ──────────────────────────────────────────

const outputSchema = lazySchema(() =>
	z.object({
		exit_code: z.number().describe("The exit code of the command"),
		stdout: z.string().describe("The standard output of the command"),
		stderr: z.string().describe("The standard error output of the command"),
		timed_out: z.boolean().describe("Whether the command timed out"),
		duration_ms: z.number().describe("How long the command took to run"),
	}),
);
type OutputSchema = ReturnType<typeof outputSchema>;

// ─── Tool Implementation ────────────────────────────────────

async function terminalCaptureToolCall(
	input: z.infer<InputSchema>,
): Promise<z.infer<OutputSchema>> {
	const startTime = Date.now();

	try {
		const result = await execa(input.command, {
			shell: true,
			cwd: input.workdir,
			timeout: input.timeout || 30_000,
			reject: false,
			all: false,
		});

		return {
			exit_code: result.exitCode ?? -1,
			stdout: result.stdout || "",
			stderr: result.stderr || "",
			timed_out: result.timedOut || false,
			duration_ms: Date.now() - startTime,
		};
	} catch (error) {
		return {
			exit_code: -1,
			stdout: "",
			stderr: `Error executing command: ${(error as Error).message}`,
			timed_out: false,
			duration_ms: Date.now() - startTime,
		};
	}
}

// ─── Tool Definition ────────────────────────────────────────

// log: cast toolDef as any — lazySchema/getter mismatch with ToolDef type
const toolDef = {
	name: TERMINAL_CAPTURE_TOOL_NAME,
	description: `Run a shell command and capture its output. Similar to Bash but optimized for capture-only mode: the command runs, output is captured, and the result is returned. Supports timeout and custom working directory.`,
	get inputSchema(): InputSchema {
		return inputSchema();
	},
	get outputSchema(): OutputSchema {
		return outputSchema();
	},
	async execute(
		input: z.infer<InputSchema>,
		_context?: unknown,
		_canUseTool?: unknown,
		_parentMessage?: unknown,
		_onProgress?: unknown,
	) {
		return { data: await terminalCaptureToolCall(input) };
	},
	userFacingName: () => "TerminalCapture",
	isEnabled: () => true,
} as any;

export const TerminalCaptureTool = buildTool(toolDef);
