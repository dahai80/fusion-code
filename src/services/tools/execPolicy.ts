// insight-0902 G2: execpolicy — declarative execution-policy capability lists
// for shell-capable MCP/plugin tools. Extends the existing Bash-only
// declarative permission engine (bashPermissions) to non-Bash tools that can
// execute shell-equivalent commands, via the capability-deny block in
// toolExecution.ts.
//
// Default-off (FUSION_CODE_EXECPOLICY_STRICT=1) = byte-identical-off: when the
// env gate is unset, isExecPolicyDenied returns false unconditionally and the
// deny block in toolExecution is a no-op pass-through.

import { logForDebugging } from "../../utils/debug.js";

export type ExecPolicy = {
	allow?: string[];
	deny?: string[];
	ask?: string[];
};

// Minimal tool-shape the classifier needs. Mirrors the Tool interface subset.
export type ShellCapableTool = {
	name: string;
	isMcp?: boolean;
	isLsp?: boolean;
	isShellCapable?: boolean;
};

// insight-0902 G2: a tool is shell-capable for execpolicy purposes when it
// explicitly opts in via `isShellCapable === true`. MCP-sourced tools that
// don't opt in are NOT classified (avoids false positives on legit non-shell
// MCP tools). Explicit opt-in, not heuristic guessing.
export function isShellCapableTool(tool: ShellCapableTool): boolean {
	return tool.isShellCapable === true;
}

// Case-insensitive exact match (same semantics as fusionRules.isToolDenied).
function matchesAny(name: string, patterns: string[] | undefined): boolean {
	if (!patterns || patterns.length === 0) return false;
	const lower = name.toLowerCase();
	return patterns.some((p) => p.toLowerCase() === lower);
}

// insight-0902 G2: true when execpolicy enforcement is active AND the tool is
// shell-capable AND its name matches the deny list (and not the allow list).
// Returns false unconditionally when the env gate is off (byte-identical-off).
export function isExecPolicyDenied(
	tool: ShellCapableTool,
	policy: ExecPolicy | undefined,
	envGateOn: boolean,
): boolean {
	if (!envGateOn) return false;
	if (!policy) return false;
	if (!isShellCapableTool(tool)) return false;
	// allow takes precedence over deny (escape hatch for broad deny patterns).
	if (matchesAny(tool.name, policy.allow)) {
		return false;
	}
	if (matchesAny(tool.name, policy.deny)) {
		logForDebugging(`execpolicy: denying shell-capable tool ${tool.name}`);
		return true;
	}
	return false;
}

// insight-0902 G2: read the env gate once. Exported so tests can stub env.
export function isExecPolicyStrictEnabled(): boolean {
	return process.env.FUSION_CODE_EXECPOLICY_STRICT === "1";
}
