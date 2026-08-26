import { describe, expect, mock, test } from "bun:test";
import {
	type DoctorWarning,
	type FixState,
	runAutoFix,
} from "../../components/DoctorWarnings.js";

function makeWarning(
	opts: Partial<DoctorWarning> & { issue: string },
): DoctorWarning {
	return {
		issue: opts.issue,
		fix: opts.fix ?? "manual fix",
		fixAction: opts.fixAction,
	};
}

function captureStates(): {
	states: FixState[];
	set: (s: FixState) => void;
} {
	const states: FixState[] = [];
	return {
		states,
		set: (s: FixState) => {
			states.push(s);
		},
	};
}

describe("DoctorWarnings runAutoFix", () => {
	test("all success -> done with count", async () => {
		const called: string[] = [];
		const actionable = [
			makeWarning({
				issue: "OOM imminent",
				fixAction: async () => {
					called.push("a");
					return { success: true, freed: 5000 };
				},
			}),
			makeWarning({
				issue: "OOM high",
				fixAction: async () => {
					called.push("b");
					return { success: true };
				},
			}),
		];
		const { states, set } = captureStates();
		await runAutoFix(actionable, set);
		expect(called).toEqual(["a", "b"]);
		expect(states[0].kind).toBe("running");
		const last = states[states.length - 1];
		expect(last.kind).toBe("done");
		expect(last.kind === "done" && last.message).toContain("2 actions");
	});

	test("single success -> singular action wording", async () => {
		const actionable = [
			makeWarning({
				issue: "OOM",
				fixAction: async () => ({ success: true }),
			}),
		];
		const { states, set } = captureStates();
		await runAutoFix(actionable, set);
		const last = states[states.length - 1];
		expect(last.kind).toBe("done");
		expect(last.kind === "done" && last.message).toContain("1 action");
	});

	test("all fail -> error with joined messages", async () => {
		const actionable = [
			makeWarning({
				issue: "OOM imminent",
				fixAction: async () => {
					throw new Error("network down");
				},
			}),
			makeWarning({
				issue: "OOM high",
				fixAction: async () => {
					throw new Error("timeout");
				},
			}),
		];
		const { states, set } = captureStates();
		await runAutoFix(actionable, set);
		const last = states[states.length - 1];
		expect(last.kind).toBe("error");
		expect(last.kind === "error" && last.message).toContain("network down");
		expect(last.kind === "error" && last.message).toContain("timeout");
	});

	test("partial -> error with ok and failed counts", async () => {
		const actionable = [
			makeWarning({
				issue: "ok-one",
				fixAction: async () => ({ success: true }),
			}),
			makeWarning({
				issue: "bad-one",
				fixAction: async () => {
					throw new Error("boom");
				},
			}),
		];
		const { states, set } = captureStates();
		await runAutoFix(actionable, set);
		const last = states[states.length - 1];
		expect(last.kind).toBe("error");
		expect(last.kind === "error" && last.message).toContain("1 ok");
		expect(last.kind === "error" && last.message).toContain("1 failed");
		expect(last.kind === "error" && last.message).toContain("boom");
	});

	test("non-Error thrown -> stringified in message", async () => {
		const actionable = [
			makeWarning({
				issue: "weird",
				fixAction: async () => {
					throw "string error";
				},
			}),
		];
		const { states, set } = captureStates();
		await runAutoFix(actionable, set);
		const last = states[states.length - 1];
		expect(last.kind).toBe("error");
		expect(last.kind === "error" && last.message).toContain("string error");
	});

	test("empty actionable -> done with 0", async () => {
		const { states, set } = captureStates();
		await runAutoFix([], set);
		const last = states[states.length - 1];
		expect(last.kind).toBe("done");
		expect(last.kind === "done" && last.message).toContain("0 actions");
	});

	test("warning without fixAction skipped, no crash", async () => {
		const called: string[] = [];
		const actionable = [
			makeWarning({ issue: "no-action" }),
			makeWarning({
				issue: "has-action",
				fixAction: async () => {
					called.push("ran");
					return { success: true };
				},
			}),
		];
		const { states, set } = captureStates();
		await runAutoFix(actionable, set);
		expect(called).toEqual(["ran"]);
		const last = states[states.length - 1];
		expect(last.kind).toBe("done");
	});

	test("setFixState receives running first", async () => {
		const actionable = [
			makeWarning({
				issue: "x",
				fixAction: async () => ({ success: true }),
			}),
		];
		const { states, set } = captureStates();
		await runAutoFix(actionable, set);
		expect(states[0].kind).toBe("running");
		expect(states.length).toBe(2);
	});

	test("mock fn fixAction called once per warning", async () => {
		const fn = mock(async () => ({ success: true }));
		const actionable = [
			makeWarning({ issue: "a", fixAction: fn }),
			makeWarning({ issue: "b", fixAction: fn }),
		];
		const { set } = captureStates();
		await runAutoFix(actionable, set);
		expect(fn).toHaveBeenCalledTimes(2);
	});
});
