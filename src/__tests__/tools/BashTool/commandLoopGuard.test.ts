import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	checkCommandLoop,
	clearCommandLoopHistory,
} from "src/tools/BashTool/commandLoopGuard.js";

describe("commandLoopGuard", () => {
	beforeEach(() => {
		clearCommandLoopHistory();
	});

	afterEach(() => {
		clearCommandLoopHistory();
	});

	test("distinct commands do not block", () => {
		expect(checkCommandLoop("ls", "a", 0).shouldBlock).toBe(false);
		expect(checkCommandLoop("pwd", "b", 0).shouldBlock).toBe(false);
		expect(checkCommandLoop("whoami", "c", 0).shouldBlock).toBe(false);
	});

	test("same command with changing output does not block", () => {
		for (let i = 0; i < 5; i++) {
			const r = checkCommandLoop("cat log", `line ${i}`, 0);
			expect(r.shouldBlock).toBe(false);
		}
	});

	test("blocks after threshold identical repeats", () => {
		for (let i = 0; i < 3; i++) {
			const r = checkCommandLoop("pytest", "all passed", 0);
			expect(r.shouldBlock).toBe(false);
		}
		const blocked = checkCommandLoop("pytest", "all passed", 0);
		expect(blocked.shouldBlock).toBe(true);
		expect(blocked.reason).toContain("pytest");
	});

	test("exit 0 repeats get success-guidance message", () => {
		for (let i = 0; i < 3; i++) {
			checkCommandLoop("pytest", "3 passed in 0.01s", 0);
		}
		const blocked = checkCommandLoop("pytest", "3 passed in 0.01s", 0);
		expect(blocked.shouldBlock).toBe(true);
		expect(blocked.reason).toContain("already exited 0");
		expect(blocked.reason).toContain("already succeeded");
	});

	test("nonzero exit repeats get loop message", () => {
		for (let i = 0; i < 3; i++) {
			checkCommandLoop("make", "error E1", 2);
		}
		const blocked = checkCommandLoop("make", "error E1", 2);
		expect(blocked.shouldBlock).toBe(true);
		expect(blocked.reason).toContain("stuck in a command execution loop");
	});

	test("same output from different commands does not count", () => {
		checkCommandLoop("cmdA", "same", 0);
		checkCommandLoop("cmdB", "same", 0);
		checkCommandLoop("cmdC", "same", 0);
		const r = checkCommandLoop("cmdA", "same", 0);
		expect(r.shouldBlock).toBe(false);
	});

	test("clearCommandLoopHistory resets state", () => {
		for (let i = 0; i < 3; i++) {
			checkCommandLoop("t", "same", 0);
		}
		clearCommandLoopHistory();
		const r = checkCommandLoop("t", "same", 0);
		expect(r.shouldBlock).toBe(false);
	});
});
