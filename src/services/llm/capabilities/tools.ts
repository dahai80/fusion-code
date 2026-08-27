// ToolsCapability seam (ar-plan PR #4, S1.c).
// Provider-neutral tool-registry facade — list/getTool/isDenied behind one
// interface so consumers inject ctx.tools instead of importing getAllBaseTools
// + findToolByName + isToolDenied directly (de-couples A3). BaseToolsCapability
// wraps the 3 existing registry primitives, no re-listing. callTool() deferred —
// it needs full ToolUseContext (canUseTool/parentMessage/onProgress), which
// would over-couple; the registry+denial lookup face is what A3 centralizes.
// Byte-identical when no consumer migrated.

import { findToolByName, type Tool, type Tools } from "../../../Tool.js";
import { getAllBaseTools } from "../../../tools.js";
import { logForDebugging } from "../../../utils/debug.js";
import { isToolDenied } from "../../../utils/fusionRules.js";

export interface ToolsCapability {
	readonly provider: "base";
	list(): string[];
	getTool(name: string): Tool | undefined;
	isDenied(name: string): boolean;
}

export class BaseToolsCapability implements ToolsCapability {
	readonly provider = "base" as const;

	list(): string[] {
		const tools: Tools = getAllBaseTools();
		const enabled = tools.filter((t) => t.isEnabled()).map((t) => t.name);
		return enabled;
	}

	getTool(name: string): Tool | undefined {
		const tool = findToolByName(getAllBaseTools(), name);
		if (!tool) {
			logForDebugging(`[ctx.tools] getTool miss: ${name}`);
		}
		return tool;
	}

	isDenied(name: string): boolean {
		return isToolDenied(name);
	}
}
