import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_ENTRY = join(import.meta.dir, "../../src/entrypoints/cli.tsx");

// #227: end-to-end wire test for the tool-error circuit breaker. A mock
// Anthropic-compatible endpoint always answers with the same Read tool_use
// on a nonexistent path — the exact loop shape from the issue (one full
// request per turn, error fed back, model never self-corrects). The breaker
// must abort the one-shot task after 5 consecutive identical errors with a
// structured error_tool_error_loop result and exit code 1, instead of
// looping forever.

const MISSING_PATH = "/nonexistent/fusion-code-circuit-breaker-test/file.txt";

function sseResponse(): Response {
	const events = [
		`event: message_start\ndata: ${JSON.stringify({
			type: "message_start",
			message: {
				id: "msg_circuit",
				type: "message",
				role: "assistant",
				model: "test-model",
				content: [],
				stop_reason: null,
				usage: { input_tokens: 10, output_tokens: 5 },
			},
		})}\n\n`,
		`event: content_block_start\ndata: ${JSON.stringify({
			type: "content_block_start",
			index: 0,
			content_block: {
				type: "tool_use",
				id: "toolu_circuit",
				name: "Read",
				input: {},
			},
		})}\n\n`,
		`event: content_block_delta\ndata: ${JSON.stringify({
			type: "content_block_delta",
			index: 0,
			delta: {
				type: "input_json_delta",
				partial_json: JSON.stringify({ file_path: MISSING_PATH }),
			},
		})}\n\n`,
		`event: content_block_stop\ndata: ${JSON.stringify({
			type: "content_block_stop",
			index: 0,
		})}\n\n`,
		`event: message_delta\ndata: ${JSON.stringify({
			type: "message_delta",
			delta: { stop_reason: "tool_use" },
			usage: { output_tokens: 10 },
		})}\n\n`,
		`event: message_stop\ndata: ${JSON.stringify({
			type: "message_stop",
		})}\n\n`,
	].join("");
	return new Response(events, {
		status: 200,
		headers: {
			"content-type": "text/event-stream",
		},
	});
}

const tempDirs: string[] = [];

afterAll(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("tool error circuit breaker (one-shot -p)", () => {
	test("aborts after 5 consecutive identical tool errors with structured result", async () => {
		let requestCount = 0;
		const server = Bun.serve({
			port: 0,
			fetch: (req) => {
				const url = new URL(req.url);
				if (req.method === "POST" && url.pathname === "/v1/messages") {
					requestCount++;
					return sseResponse();
				}
				return new Response("not found", { status: 404 });
			},
		});

		const configDir = mkdtempSync(join(tmpdir(), "fc-circuit-"));
		const workDir = mkdtempSync(join(tmpdir(), "fc-circuit-cwd-"));
		tempDirs.push(configDir, workDir);

		try {
			const proc = Bun.spawn(
				[
					"bun",
					CLI_ENTRY,
					"-p",
					"Read the target file.",
					"--model",
					"test-model",
					"--output-format",
					"json",
					"--dangerously-skip-permissions",
				],
				{
					cwd: workDir,
					env: {
						...process.env,
						NODE_ENV: "test",
						FUSION_BASE_URL: `http://127.0.0.1:${server.port}`,
						FUSION_CLIENT_KEY: "test-key",
						FUSION_CODE_CONFIG_DIR: configDir,
						CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
						DISABLE_AUTOUPDATER: "1",
						DISABLE_TELEMETRY: "1",
						FUSION_MLX_DISABLED: "1",
					},
					stdout: "pipe",
					stderr: "pipe",
				},
			);

			const killTimer = setTimeout(() => proc.kill(), 120_000);
			const [exitCode, stdout] = await Promise.all([
				proc.exited,
				new Response(proc.stdout).text(),
			]);
			clearTimeout(killTimer);
			const stderrText = await new Response(proc.stderr).text();

			expect(requestCount, stderrText).toBe(5);
			expect(exitCode, stderrText).toBe(1);
			expect(stdout, stderrText).toContain("error_tool_error_loop");
			// Read reports the failure cwd-relative, so assert on the
			// stable part of the error text, not the absolute input path.
			expect(stdout, stderrText).toContain("File does not exist");
		} finally {
			server.stop(true);
		}
	}, 180_000);

	test("--max-duration aborts a task that exceeds the wall-clock limit", async () => {
		let requestCount = 0;
		const server = Bun.serve({
			port: 0,
			fetch: (req) => {
				const url = new URL(req.url);
				if (req.method === "POST" && url.pathname === "/v1/messages") {
					requestCount++;
					// Slow-walk each turn past the 1s budget.
					return new Promise<Response>((resolve) => {
						setTimeout(() => resolve(sseResponse()), 1200);
					});
				}
				return new Response("not found", { status: 404 });
			},
		});

		const configDir = mkdtempSync(join(tmpdir(), "fc-maxdur-"));
		const workDir = mkdtempSync(join(tmpdir(), "fc-maxdur-cwd-"));
		tempDirs.push(configDir, workDir);

		try {
			const proc = Bun.spawn(
				[
					"bun",
					CLI_ENTRY,
					"-p",
					"Read the target file.",
					"--model",
					"test-model",
					"--output-format",
					"json",
					"--dangerously-skip-permissions",
					"--max-duration",
					"2",
				],
				{
					cwd: workDir,
					env: {
						...process.env,
						NODE_ENV: "test",
						FUSION_BASE_URL: `http://127.0.0.1:${server.port}`,
						FUSION_CLIENT_KEY: "test-key",
						FUSION_CODE_CONFIG_DIR: configDir,
						CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
						DISABLE_AUTOUPDATER: "1",
						DISABLE_TELEMETRY: "1",
						FUSION_MLX_DISABLED: "1",
						// widen the breaker so the duration guard is what fires
						FUSION_CODE_MAX_CONSECUTIVE_TOOL_ERRORS: "999",
					},
					stdout: "pipe",
					stderr: "pipe",
				},
			);

			const killTimer = setTimeout(() => proc.kill(), 120_000);
			const [exitCode, stdout] = await Promise.all([
				proc.exited,
				new Response(proc.stdout).text(),
			]);
			clearTimeout(killTimer);
			const stderrText = await new Response(proc.stderr).text();

			expect(exitCode, stderrText).toBe(1);
			expect(stdout, stderrText).toContain("error_max_duration");
		} finally {
			server.stop(true);
		}
	}, 180_000);
});
