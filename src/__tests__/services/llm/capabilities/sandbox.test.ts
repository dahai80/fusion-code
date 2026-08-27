import { describe, expect, test } from "bun:test";

const { NoneSandboxProvider } = await import(
	"../../../../services/llm/capabilities/sandbox.js"
);

describe("NoneSandboxProvider", () => {
	test("provider is none", () => {
		expect(new NoneSandboxProvider().provider).toBe("none");
	});

	test("applyTo returns the same object unchanged (no-op identity)", () => {
		const cap = new NoneSandboxProvider();
		const opts = {
			cwd: "/tmp",
			shell: true,
			stdio: ["ignore", "pipe", "pipe"],
		};
		expect(cap.applyTo(opts)).toBe(opts);
	});

	test("applyTo passes through arbitrary shapes", () => {
		const cap = new NoneSandboxProvider();
		const opts = { args: ["a", "b"], env: { X: "1" } };
		expect(cap.applyTo(opts)).toEqual(opts);
	});

	test("checkPath always returns true (no restriction)", () => {
		const cap = new NoneSandboxProvider();
		expect(cap.checkPath("/etc/passwd")).toBe(true);
		expect(cap.checkPath("/Users/x/secret")).toBe(true);
		expect(cap.checkPath("relative/path")).toBe(true);
	});
});
