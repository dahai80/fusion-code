import { describe, expect, it } from "bun:test";

// insight-0902 G2: execpolicy capability-deny for shell-capable MCP/plugin
// tools. Asserts the pure helper logic in isolation (no toolExecution import —
// that pulls the heavy tools graph and a load-time TDZ, same class as the G3/G4
// cycle tests). The deny-block wiring in toolExecution.ts is a thin shim around
// isExecPolicyDenied; the durable, runtime-testable contract is the helper.

import {
	type ExecPolicy,
	isExecPolicyDenied,
	isExecPolicyStrictEnabled,
	isShellCapableTool,
	type ShellCapableTool,
} from "../../../services/tools/index.js";

function makeTool(opts: {
	name: string;
	isShellCapable?: boolean;
}): ShellCapableTool {
	return {
		name: opts.name,
		isShellCapable: opts.isShellCapable,
	};
}

describe("execpolicy capability-deny (insight-0902 G2)", () => {
	it("off env-gate = never deny (byte-identical-off)", () => {
		const tool = makeTool({ name: "mcp__shell", isShellCapable: true });
		const policy: ExecPolicy = { deny: ["mcp__shell"] };
		// envGateOn=false must short-circuit regardless of policy/tool.
		expect(isExecPolicyDenied(tool, policy, false)).toBe(false);
		// even with no policy.
		expect(isExecPolicyDenied(tool, undefined, false)).toBe(false);
	});

	it("denies shell-capable tool matching deny list when gate on", () => {
		const tool = makeTool({ name: "mcp__shell", isShellCapable: true });
		const policy: ExecPolicy = { deny: ["mcp__shell"] };
		expect(isExecPolicyDenied(tool, policy, true)).toBe(true);
	});

	it("does NOT deny a non-shell-capable tool (no false positives)", () => {
		// MCP tool that doesn't opt in to isShellCapable — must pass through.
		const tool = makeTool({ name: "mcp__readonly" });
		const policy: ExecPolicy = { deny: ["mcp__readonly"] };
		expect(isExecPolicyDenied(tool, policy, true)).toBe(false);
	});

	it("allow list takes precedence over deny (escape hatch)", () => {
		const tool = makeTool({ name: "mcp__shell", isShellCapable: true });
		const policy: ExecPolicy = {
			deny: ["mcp__shell"],
			allow: ["mcp__shell"],
		};
		expect(isExecPolicyDenied(tool, policy, true)).toBe(false);
	});

	it("matching is case-insensitive", () => {
		const tool = makeTool({ name: "MCP__Shell", isShellCapable: true });
		const policy: ExecPolicy = { deny: ["mcp__shell"] };
		expect(isExecPolicyDenied(tool, policy, true)).toBe(true);
	});

	it("missing policy = no deny", () => {
		const tool = makeTool({ name: "mcp__shell", isShellCapable: true });
		expect(isExecPolicyDenied(tool, undefined, true)).toBe(false);
	});

	it("isShellCapableTool only returns true for explicit opt-in", () => {
		expect(
			isShellCapableTool(makeTool({ name: "a", isShellCapable: true })),
		).toBe(true);
		expect(
			isShellCapableTool(makeTool({ name: "a", isShellCapable: false })),
		).toBe(false);
		expect(isShellCapableTool(makeTool({ name: "a" }))).toBe(false);
	});

	it("isExecPolicyStrictEnabled reads FUSION_CODE_EXECPOLICY_STRICT", () => {
		const before = process.env.FUSION_CODE_EXECPOLICY_STRICT;
		try {
			delete process.env.FUSION_CODE_EXECPOLICY_STRICT;
			expect(isExecPolicyStrictEnabled()).toBe(false);
			process.env.FUSION_CODE_EXECPOLICY_STRICT = "1";
			expect(isExecPolicyStrictEnabled()).toBe(true);
		} finally {
			if (before === undefined) {
				delete process.env.FUSION_CODE_EXECPOLICY_STRICT;
			} else {
				process.env.FUSION_CODE_EXECPOLICY_STRICT = before;
			}
		}
	});
});
