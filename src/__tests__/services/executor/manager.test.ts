import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	_resetExecutorManagerForTesting,
	getExecutorClient,
	getInitializationStatus,
	initializeExecutorManager,
	isExecutorConnected,
	isExecutorEnabled,
} from "../../../services/executor/manager.js";

const ENV_KEY = "FUSION_CODE_EXECUTOR_ENABLED";

function withEnv(
	value: string | undefined,
	fn: () => void | Promise<void>,
): void | Promise<void> {
	const prev = process.env[ENV_KEY];
	if (value === undefined) {
		delete process.env[ENV_KEY];
	} else {
		process.env[ENV_KEY] = value;
	}
	const restore = (): void => {
		if (prev === undefined) {
			delete process.env[ENV_KEY];
		} else {
			process.env[ENV_KEY] = prev;
		}
	};
	const maybe = fn();
	if (maybe && typeof (maybe as Promise<void>).then === "function") {
		return (maybe as Promise<void>).finally(restore);
	}
	restore();
}

describe("executor manager", () => {
	beforeEach(() => {
		_resetExecutorManagerForTesting();
		delete process.env[ENV_KEY];
	});

	afterEach(() => {
		_resetExecutorManagerForTesting();
		delete process.env[ENV_KEY];
	});

	describe("isExecutorEnabled", () => {
		it("returns false when env unset (default-off)", () => {
			delete process.env[ENV_KEY];
			expect(isExecutorEnabled()).toBe(false);
		});

		it("returns true for truthy values (1/true/yes/on)", () => {
			for (const v of ["1", "true", "yes", "on", "TRUE"]) {
				process.env[ENV_KEY] = v;
				expect(isExecutorEnabled()).toBe(true);
			}
		});

		it("returns false for falsy values (0/false/no/off/empty)", () => {
			for (const v of ["0", "false", "no", "off", ""]) {
				process.env[ENV_KEY] = v;
				expect(isExecutorEnabled()).toBe(false);
			}
		});
	});

	describe("disabled path (byte-identical)", () => {
		it("initializeExecutorManager is a no-op when disabled", () => {
			delete process.env[ENV_KEY];
			initializeExecutorManager();
			expect(getInitializationStatus()).toBe("not-started");
		});

		it("getExecutorClient returns undefined when disabled (fail-open)", () => {
			delete process.env[ENV_KEY];
			initializeExecutorManager();
			expect(getExecutorClient()).toBeUndefined();
		});

		it("isExecutorConnected is false when disabled", () => {
			delete process.env[ENV_KEY];
			expect(isExecutorConnected()).toBe(false);
		});
	});

	describe("enabled but executor unavailable (fail-open)", () => {
		it("init fails gracefully when fusion-executor binary missing", async () => {
			// Force PATH empty so spawn('fusion-executor') ENOENTs.
			const prevPath = process.env.PATH;
			process.env.PATH = "/nonexistent-empty-path";
			process.env[ENV_KEY] = "1";
			try {
				initializeExecutorManager();
				// Init runs async; wait for the promise to settle.
				await new Promise<void>((resolve) => setTimeout(resolve, 2500));
				expect(getInitializationStatus()).toBe("failed");
				// Fail-open: no client returned even though enabled.
				expect(getExecutorClient()).toBeUndefined();
			} finally {
				process.env.PATH = prevPath;
			}
		});
	});

	describe("singleton + generation counter", () => {
		it("_resetExecutorManagerForTesting clears state to not-started", async () => {
			// Drive init through the real (binary-missing) failure path so state
			// becomes 'failed', then verify reset clears it. Awaits to avoid an
			// unhandled ENOENT rejection escaping from the pending init promise.
			const prevPath = process.env.PATH;
			process.env.PATH = "/nonexistent-empty-path";
			process.env[ENV_KEY] = "1";
			initializeExecutorManager();
			await new Promise<void>((resolve) => setTimeout(resolve, 2500));
			process.env.PATH = prevPath;
			_resetExecutorManagerForTesting();
			expect(getInitializationStatus()).toBe("not-started");
			expect(getExecutorClient()).toBeUndefined();
		});

		it("initializeExecutorManager is idempotent when disabled (no-op, no spawn)", () => {
			delete process.env[ENV_KEY];
			initializeExecutorManager();
			const statusAfterFirst = getInitializationStatus();
			initializeExecutorManager();
			const statusAfterSecond = getInitializationStatus();
			// Disabled → both calls no-op, state stays not-started, no throw.
			expect(statusAfterFirst).toBe("not-started");
			expect(statusAfterSecond).toBe("not-started");
		});
	});

	describe("env gating via withEnv helper", () => {
		it("withEnv restores previous env value", () => {
			process.env[ENV_KEY] = "preexisting";
			withEnv("1", () => {
				expect(process.env[ENV_KEY]).toBe("1");
			});
			expect(process.env[ENV_KEY]).toBe("preexisting");
		});

		it("withEnv restores undefined when previously unset", () => {
			delete process.env[ENV_KEY];
			withEnv("1", () => {
				expect(process.env[ENV_KEY]).toBe("1");
			});
			expect(process.env[ENV_KEY]).toBeUndefined();
		});
	});
});
