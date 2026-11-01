import { afterEach, describe, expect, test } from "bun:test";
import {
	DEFAULT_NONINTERACTIVE_THRESHOLD,
	TOOL_ERROR_LOOP_ENV,
	getToolErrorLoopThreshold,
	shouldTripToolErrorLoop,
	toolErrorSignature,
	updateToolErrorLoopState,
	type ToolErrorLoopState,
} from "../utils/toolErrorCircuitBreaker.js";

// #227: circuit breaker for one-shot agent loops stuck re-issuing the same
// failing tool call. Pure-logic tests for the streak/threshold helpers.

const EXTRA_ENV_KEYS = [TOOL_ERROR_LOOP_ENV];

const ORIGINAL_ENV = new Map(
	EXTRA_ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
	for (const key of EXTRA_ENV_KEYS) {
		if (ORIGINAL_ENV.get(key) === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = ORIGINAL_ENV.get(key);
		}
	}
});

function errorResult(
	toolUseId: string,
	text: string,
): { type: string; message: { content: unknown[] } } {
	return {
		type: "user",
		message: {
			content: [
				{
					type: "tool_result",
					tool_use_id: toolUseId,
					content: text,
					is_error: true,
				},
			],
		},
	};
}

function successResult(
	toolUseId: string,
): { type: string; message: { content: unknown[] } } {
	return {
		type: "user",
		message: {
			content: [
				{
					type: "tool_result",
					tool_use_id: toolUseId,
					content: "ok",
					is_error: false,
				},
			],
		},
	};
}

describe("toolErrorSignature", () => {
	test("collapses whitespace so re-wrapped errors match", () => {
		expect(toolErrorSignature("Read", "File does not\n  exist: /a/b")).toBe(
			toolErrorSignature("Read", "File does not exist: /a/b"),
		);
	});

	test("different tool names never match", () => {
		expect(toolErrorSignature("Read", "boom")).not.toBe(
			toolErrorSignature("Glob", "boom"),
		);
	});
});

describe("updateToolErrorLoopState", () => {
	const blocks = [{ id: "t1", name: "Read" }];

	test("null stays null on success-only batches", () => {
		expect(updateToolErrorLoopState(null, blocks, [successResult("t1")])).toBe(
			null,
		);
	});

	test("same error repeated increments the streak", () => {
		const batch = [errorResult("t1", "File does not exist: /nope")];
		let state: ToolErrorLoopState | null = null;
		state = updateToolErrorLoopState(state, blocks, batch);
		expect(state?.count).toBe(1);
		state = updateToolErrorLoopState(state, blocks, batch);
		expect(state?.count).toBe(2);
		state = updateToolErrorLoopState(state, blocks, batch);
		expect(state?.count).toBe(3);
		expect(state?.toolName).toBe("Read");
	});

	test("different error signature resets the streak to 1", () => {
		let state: ToolErrorLoopState | null = updateToolErrorLoopState(
			null,
			blocks,
			[errorResult("t1", "error A")],
		);
		state = updateToolErrorLoopState(state, blocks, [
			errorResult("t1", "error B"),
		]);
		expect(state?.count).toBe(1);
		expect(state?.errorText).toBe("error B");
	});

	test("a successful call resets the streak", () => {
		let state: ToolErrorLoopState | null = updateToolErrorLoopState(
			null,
			blocks,
			[errorResult("t1", "error A")],
		);
		state = updateToolErrorLoopState(state, blocks, [successResult("t1")]);
		expect(state).toBe(null);
	});

	test("multiple identical errors in one batch each count", () => {
		const state = updateToolErrorLoopState(null, blocks, [
			errorResult("t1", "same"),
			errorResult("t1", "same"),
		]);
		expect(state?.count).toBe(2);
	});

	test("no tool uses means state passes through", () => {
		const prev: ToolErrorLoopState = {
			signature: "x",
			toolName: "Read",
			errorText: "x",
			count: 2,
		};
		expect(updateToolErrorLoopState(prev, [], [])).toBe(prev);
	});

	test("array-shaped tool_result content extracts text", () => {
		const batch = [
			{
				type: "user",
				message: {
					content: [
						{
							type: "tool_result",
							tool_use_id: "t1",
							content: [{ type: "text", text: "nested boom" }],
							is_error: true,
						},
					],
				},
			},
		];
		const state = updateToolErrorLoopState(null, blocks, batch);
		expect(state?.errorText).toBe("nested boom");
		expect(state?.count).toBe(1);
	});
});

describe("getToolErrorLoopThreshold", () => {
	test("non-interactive defaults to 5", () => {
		expect(getToolErrorLoopThreshold(true)).toBe(
			DEFAULT_NONINTERACTIVE_THRESHOLD,
		);
	});

	test("interactive defaults to 0 (disabled)", () => {
		expect(getToolErrorLoopThreshold(false)).toBe(0);
	});

	test("explicit env wins in both modes", () => {
		process.env[TOOL_ERROR_LOOP_ENV] = "3";
		expect(getToolErrorLoopThreshold(true)).toBe(3);
		expect(getToolErrorLoopThreshold(false)).toBe(3);
	});

	test("env 0 disables", () => {
		process.env[TOOL_ERROR_LOOP_ENV] = "0";
		expect(getToolErrorLoopThreshold(true)).toBe(0);
	});
});

describe("shouldTripToolErrorLoop", () => {
	test("trips at threshold, not below", () => {
		const state: ToolErrorLoopState = {
			signature: "s",
			toolName: "Read",
			errorText: "e",
			count: 4,
		};
		expect(shouldTripToolErrorLoop(state, 5)).toBe(false);
		state.count = 5;
		expect(shouldTripToolErrorLoop(state, 5)).toBe(true);
	});

	test("never trips when disabled (threshold 0) or state null", () => {
		expect(shouldTripToolErrorLoop(null, 5)).toBe(false);
		const state: ToolErrorLoopState = {
			signature: "s",
			toolName: "Read",
			errorText: "e",
			count: 99,
		};
		expect(shouldTripToolErrorLoop(state, 0)).toBe(false);
	});
});
