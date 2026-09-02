// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { toolMatchesName, type Tool, type Tools } from "./Tool.js";
import {
	filterToolsByProfile,
	getSessionProfile,
} from "./services/profile/index.js";
import { AgentTool } from "./tools/AgentTool/AgentTool.js";
import { SkillTool } from "./tools/SkillTool/SkillTool.js";
import { BashTool } from "./tools/BashTool/BashTool.js";
import { FileEditTool } from "./tools/FileEditTool/FileEditTool.js";
import { MultiEditTool } from "./tools/MultiEditTool/MultiEditTool.js";
import { FileReadTool } from "./tools/FileReadTool/FileReadTool.js";
import { FileWriteTool } from "./tools/FileWriteTool/FileWriteTool.js";
import { GlobTool } from "./tools/GlobTool/GlobTool.js";
import { NotebookEditTool } from "./tools/NotebookEditTool/NotebookEditTool.js";
import { WebFetchTool } from "./tools/WebFetchTool/WebFetchTool.js";
import { TaskStopTool } from "./tools/TaskStopTool/TaskStopTool.js";
import { BriefTool } from "./tools/BriefTool/BriefTool.js";
// log: REPLTool + SuggestBackgroundPRTool ant-only require() blocks removed —
// target modules never existed (only REPLTool/constants.js is live). Dead in
// shipped builds (USER_TYPE==="external"→false) but require() in a dead branch
// does NOT DCE (transform-time resolve), so they survived in the bundle.
import { SleepTool } from "./tools/SleepTool/SleepTool.js";
// Cloud-only tools removed: RemoteTriggerTool, MonitorTool, SendUserFileTool,
// PushNotificationTool, SubscribePRTool
/* eslint-enable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
import { TaskOutputTool } from "./tools/TaskOutputTool/TaskOutputTool.js";
import { WebSearchTool } from "./tools/WebSearchTool/WebSearchTool.js";
import { TodoWriteTool } from "./tools/TodoWriteTool/TodoWriteTool.js";
import { ExitPlanModeV2Tool } from "./tools/ExitPlanModeTool/ExitPlanModeV2Tool.js";
import { TestingPermissionTool } from "./tools/testing/TestingPermissionTool.js";
import { GrepTool } from "./tools/GrepTool/GrepTool.js";
// TungstenTool removed - cloud-only/ant-internal
/* eslint-disable @typescript-eslint/no-require-imports */
const TeamCreateTool = (() => {
	try {
		return require("./tools/TeamCreateTool/TeamCreateTool.js").TeamCreateTool;
	} catch {
		return null;
	}
})();
const TeamDeleteTool = (() => {
	try {
		return require("./tools/TeamDeleteTool/TeamDeleteTool.js").TeamDeleteTool;
	} catch {
		return null;
	}
})();
/* eslint-enable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-require-imports */
const getSendMessageTool = () =>
	require("./tools/SendMessageTool/SendMessageTool.js")
		.SendMessageTool as typeof import("./tools/SendMessageTool/SendMessageTool.js").SendMessageTool;
/* eslint-enable @typescript-eslint/no-require-imports */
import { AskUserQuestionTool } from "./tools/AskUserQuestionTool/AskUserQuestionTool.js";
import { ArtifactCreateTool } from "./tools/ArtifactCreateTool/ArtifactCreateTool.js";
import { ArtifactUpdateTool } from "./tools/ArtifactUpdateTool/ArtifactUpdateTool.js";
import { LoadArtifactTool } from "./tools/LoadArtifactTool/LoadArtifactTool.js";
import { PatchArtifactTool } from "./tools/PatchArtifactTool/PatchArtifactTool.js";
import { LSPTool } from "./tools/LSPTool/LSPTool.js";
import { CronCreateTool } from "./tools/CronCreateTool/CronCreateTool.js";
import { CronDeleteTool } from "./tools/CronDeleteTool/CronDeleteTool.js";
import { CronListTool } from "./tools/CronListTool/CronListTool.js";
import { ScheduleWakeupTool } from "./tools/ScheduleWakeupTool/ScheduleWakeupTool.js";
import { GoalCreateTool } from "./tools/GoalCreateTool/GoalCreateTool.js";
import { GoalGetTool } from "./tools/GoalGetTool/GoalGetTool.js";
import { GoalSetBudgetTool } from "./tools/GoalSetBudgetTool/GoalSetBudgetTool.js";
import { GoalUpdateTool } from "./tools/GoalUpdateTool/GoalUpdateTool.js";
import { DMailTool } from "./tools/DMailTool/DMailTool.js";
import { CtxInspectTool } from "./tools/CtxInspectTool/CtxInspectTool.js";
import { ReportFindingsTool } from "./tools/ReportFindingsTool/ReportFindingsTool.js";
import { WorkflowTool } from "./tools/WorkflowTool/WorkflowTool.js";
import { DesignSyncTool } from "./tools/DesignSyncTool/DesignSyncTool.js";
import { CreateSessionSkillTool } from "./tools/CreateSessionSkillTool/CreateSessionSkillTool.js";
import { isSessionSkillsEnabled } from "./tools/CreateSessionSkillTool/runtime.js";
import { ListMcpResourcesTool } from "./tools/ListMcpResourcesTool/ListMcpResourcesTool.js";
import { ReadMcpResourceTool } from "./tools/ReadMcpResourceTool/ReadMcpResourceTool.js";
import { ToolSearchTool } from "./tools/ToolSearchTool/ToolSearchTool.js";
import { EnterPlanModeTool } from "./tools/EnterPlanModeTool/EnterPlanModeTool.js";
import { EnterWorktreeTool } from "./tools/EnterWorktreeTool/EnterWorktreeTool.js";
import { ExitWorktreeTool } from "./tools/ExitWorktreeTool/ExitWorktreeTool.js";
import { ConfigTool } from "./tools/ConfigTool/ConfigTool.js";
import { TaskCreateTool } from "./tools/TaskCreateTool/TaskCreateTool.js";
import { TaskGetTool } from "./tools/TaskGetTool/TaskGetTool.js";
import { TaskUpdateTool } from "./tools/TaskUpdateTool/TaskUpdateTool.js";
import { TaskListTool } from "./tools/TaskListTool/TaskListTool.js";
import uniqBy from "lodash-es/uniqBy.js";
import { isToolSearchEnabledOptimistic } from "./utils/toolSearch.js";
import { isTodoV2Enabled } from "./utils/tasks.js";
// Cloud-only VerifyPlanExecutionTool removed
import { SYNTHETIC_OUTPUT_TOOL_NAME } from "./tools/SyntheticOutputTool/SyntheticOutputTool.js";
export {
	ALL_AGENT_DISALLOWED_TOOLS,
	CUSTOM_AGENT_DISALLOWED_TOOLS,
	ASYNC_AGENT_ALLOWED_TOOLS,
	COORDINATOR_MODE_ALLOWED_TOOLS,
} from "./constants/tools.js";
// SnipTool (HISTORY_SNIP) + ListPeersTool (UDS_INBOX) require() blocks removed:
// both targets were never committed — the tool-class modules don't exist. Dead
// in shipped builds (flags off → feature() DCE) but unresolved when dev-full
// force-enables the flags. The HISTORY_SNIP/UDS_INBOX *wiring* (snipCompact,
// snipProjection, prompt.ts) remains; only the tool registration is gated on
// modules that were never added. Restore the blocks if/when the tool classes
// are actually committed.
const SnipTool: unknown = null;
const ListPeersTool: unknown = null;
import type { ToolPermissionContext } from "./Tool.js";
import { getDenyRuleForTool } from "./utils/permissions/permissions.js";
import { hasEmbeddedSearchTools } from "./utils/embeddedTools.js";
import { isEnvTruthy } from "./utils/envUtils.js";
import { isFusionMlxProvider } from "./utils/model/providers.js";
import { getMainLoopModel } from "./utils/model/model.js";
import { isPowerShellToolEnabled } from "./utils/shell/shellToolUtils.js";
import { isWorktreeModeEnabled } from "./utils/worktreeModeEnabled.js";
import {
	REPL_TOOL_NAME,
	REPL_ONLY_TOOLS,
	isReplModeEnabled,
} from "./tools/REPLTool/constants.js";
export { REPL_ONLY_TOOLS };
/* eslint-disable @typescript-eslint/no-require-imports */
const getPowerShellTool = () => {
	if (!isPowerShellToolEnabled()) return null;
	return (
		require("./tools/PowerShellTool/PowerShellTool.js") as typeof import("./tools/PowerShellTool/PowerShellTool.js")
	).PowerShellTool;
};
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Predefined tool presets that can be used with --tools flag
 */
export const TOOL_PRESETS = ["default"] as const;

export type ToolPreset = (typeof TOOL_PRESETS)[number];

export function parseToolPreset(preset: string): ToolPreset | null {
	const presetString = preset.toLowerCase();
	if (!TOOL_PRESETS.includes(presetString as ToolPreset)) {
		return null;
	}
	return presetString as ToolPreset;
}

/**
 * Get the list of tool names for a given preset
 * Filters out tools that are disabled via isEnabled() check
 * @param preset The preset name
 * @returns Array of tool names
 */
export function getToolsForDefaultPreset(): string[] {
	const tools = getAllBaseTools();
	const isEnabled = tools.map((tool) => tool.isEnabled());
	return tools.filter((_, i) => isEnabled[i]).map((tool) => tool.name);
}

/**
 * Get the complete exhaustive list of all tools that could be available
 * in the current environment (respecting process.env flags).
 * This is the source of truth for ALL tools.
 */
/**
 * NOTE: This MUST stay in sync with https://console.statsig.com/4aF3Ewatb6xPVpCwxb5nA3/dynamic_configs/claude_code_global_system_caching, in order to cache the system prompt across users.
 */
export function getAllBaseTools(): Tools {
	return [
		AgentTool,
		TaskOutputTool,
		BashTool,
		// Ant-native builds have bfs/ugrep embedded in the bun binary (same ARGV0
		// trick as ripgrep). When available, find/grep in Claude's shell are aliased
		// to these fast tools, so the dedicated Glob/Grep tools are unnecessary.
		...(hasEmbeddedSearchTools() ? [] : [GlobTool, GrepTool]),
		ExitPlanModeV2Tool,
		FileReadTool,
		FileEditTool,
		MultiEditTool,
		FileWriteTool,
		NotebookEditTool,
		WebFetchTool,
		TodoWriteTool,
		WebSearchTool,
		TaskStopTool,
		AskUserQuestionTool,
		SkillTool,
		EnterPlanModeTool,
		...(process.env.USER_TYPE === "ant" ? [ConfigTool] : []),
		...(isTodoV2Enabled()
			? [TaskCreateTool, TaskGetTool, TaskUpdateTool, TaskListTool]
			: []),
		LSPTool,
		CronCreateTool,
		CronDeleteTool,
		CronListTool,
		ScheduleWakeupTool,
		GoalCreateTool,
		GoalGetTool,
		GoalSetBudgetTool,
		GoalUpdateTool,
		DMailTool,
		CtxInspectTool,
		ReportFindingsTool,
		WorkflowTool,
		DesignSyncTool,
		// P5.4 session skills: 会话级一次性技能 (in-memory, 不持久, 仅元数据审计)。
		// 双门禁: feature("SESSION_SKILLS") 编译期 (CreateSessionSkillTool.isEnabled 内) +
		// FUSION_CODE_SESSION_SKILLS_ENABLED 运行期 (此处 preset 门控 + isEnabled 二次校验)。
		// 关闭时两层都 false → 工具不入 preset 列表, byte-identical。
		...(isSessionSkillsEnabled() ? [CreateSessionSkillTool] : []),
		...(isWorktreeModeEnabled() ? [EnterWorktreeTool, ExitWorktreeTool] : []),
		SleepTool,
		...(TeamCreateTool ? [TeamCreateTool] : []),
		...(TeamDeleteTool ? [TeamDeleteTool] : []),
		getSendMessageTool(),
		...(ListPeersTool ? [ListPeersTool] : []),
		BriefTool,
		ArtifactCreateTool,
		ArtifactUpdateTool,
		LoadArtifactTool,
		PatchArtifactTool,
		...(getPowerShellTool() ? [getPowerShellTool()] : []),
		...(SnipTool ? [SnipTool] : []),
		...(process.env.NODE_ENV === "test" ? [TestingPermissionTool] : []),
		ListMcpResourcesTool,
		ReadMcpResourceTool,
		...(isToolSearchEnabledOptimistic() ? [ToolSearchTool] : []),
	];
}

/**
 * Filters out tools that are blanket-denied by the permission context.
 * A tool is filtered out if there's a deny rule matching its name with no
 * ruleContent (i.e., a blanket deny for that tool).
 *
 * Uses the same matcher as the runtime permission check (step 1a), so MCP
 * server-prefix rules like `mcp__server` strip all tools from that server
 * before the model sees them — not just at call time.
 */
export function filterToolsByDenyRules<
	T extends {
		name: string;
		mcpInfo?: { serverName: string; toolName: string };
	},
>(tools: readonly T[], permissionContext: ToolPermissionContext): T[] {
	return tools.filter((tool) => !getDenyRuleForTool(permissionContext, tool));
}

const CORE_TOOLS = new Set([
	"Bash",
	"Read",
	"Write",
	"Edit",
	"MultiEdit",
	"Glob",
	"Grep",
]);
const MEDIUM_TOOLS = new Set([
	...CORE_TOOLS,
	"AskUserQuestion",
	"TodoWrite",
	"WebFetch",
	"WebSearch",
]);
const FULL_TOOLS = new Set([
	...MEDIUM_TOOLS,
	"Agent",
	"TaskCreate",
	"TaskGet",
	"TaskUpdate",
	"TaskList",
	"NotebookEdit",
	"Skill",
	"EnterPlanMode",
	"ExitPlanMode",
	"Sleep",
	"TeamCreate",
	"TeamDelete",
	"CtxInspect",
	"CreateArtifact",
	"UpdateArtifact",
	"LoadArtifact",
	"PatchArtifact",
	"CreateGoal",
	"GetGoal",
	"SetGoalBudget",
	"UpdateGoal",
	"SendDMail",
]);

function getMlxToolFilter(): Set<string> | null {
	if (!isFusionMlxProvider()) return null;
	try {
		const modelId = (getMainLoopModel() ?? "").toLowerCase();
		if (
			modelId.includes("0.5b") ||
			modelId.includes("1b") ||
			modelId.includes("2b")
		) {
			return CORE_TOOLS;
		}
		if (
			modelId.includes("3b") ||
			modelId.includes("7b") ||
			modelId.includes("8b") ||
			modelId.includes("9b")
		) {
			return MEDIUM_TOOLS;
		}
		return FULL_TOOLS;
	} catch {
		return MEDIUM_TOOLS;
	}
}

export const getTools = (permissionContext: ToolPermissionContext): Tools => {
	// Simple mode: only Bash, Read, and Edit tools
	if (isEnvTruthy(process.env.FUSION_CODE_SIMPLE)) {
		// --bare + REPL mode: REPL wraps Bash/Read/Edit/etc inside the VM, so
		// return REPL instead of the raw primitives. Matches the non-bare path
		// below which also hides REPL_ONLY_TOOLS when REPL is enabled.
		// log: REPLTool class never committed (only constants.js exists), so the
		// --bare+REPL short-circuit is currently unreachable — fall through to
		// raw primitives. Restore the REPLTool branch if/when the tool class lands.
		const simpleTools: Tool[] = [BashTool, FileReadTool, FileEditTool];
		return filterToolsByDenyRules(simpleTools, permissionContext);
	}

	// MLX local mode: filter tool set based on model size
	// Enabled by default for MLX — smaller models struggle with too many tools
	const specialTools = new Set([
		ListMcpResourcesTool.name,
		ReadMcpResourceTool.name,
		SYNTHETIC_OUTPUT_TOOL_NAME,
	]);

	const mlxToolFilter = isFusionMlxProvider() ? getMlxToolFilter() : null;
	if (mlxToolFilter) {
		const baseTools = getAllBaseTools().filter(
			(tool) => !specialTools.has(tool.name),
		);
		const filtered = baseTools.filter((tool) => mlxToolFilter.has(tool.name));
		const denied = filterToolsByDenyRules(filtered, permissionContext);
		return filterToolsByProfile(denied, getSessionProfile());
	}

	const tools = getAllBaseTools().filter(
		(tool) => !specialTools.has(tool.name),
	);

	// Filter out tools that are denied by the deny rules
	let allowedTools = filterToolsByDenyRules(tools, permissionContext);

	// When REPL mode is enabled, hide primitive tools from direct use.
	// They're still accessible inside REPL via the VM context.
	if (isReplModeEnabled()) {
		const replEnabled = allowedTools.some((tool) =>
			toolMatchesName(tool, REPL_TOOL_NAME),
		);
		if (replEnabled) {
			allowedTools = allowedTools.filter(
				(tool) => !REPL_ONLY_TOOLS.has(tool.name),
			);
		}
	}

	const isEnabled = allowedTools.map((_) => _.isEnabled());
	const enabledTools = allowedTools.filter((_, i) => isEnabled[i]);
	// ar-plan PR #9 (S3): profile 层在 MLX 分层之后叠加 (两正交)。
	// getSessionProfile() = null (无 --profile) → 原样返回 byte-identical。
	return filterToolsByProfile(enabledTools, getSessionProfile());
};

/**
 * Assemble the full tool pool for a given permission context and MCP tools.
 *
 * This is the single source of truth for combining built-in tools with MCP tools.
 * Both REPL.tsx (via useMergedTools hook) and runAgent.ts (for coordinator workers)
 * use this function to ensure consistent tool pool assembly.
 *
 * The function:
 * 1. Gets built-in tools via getTools() (respects mode filtering)
 * 2. Filters MCP tools by deny rules
 * 3. Deduplicates by tool name (built-in tools take precedence)
 *
 * @param permissionContext - Permission context for filtering built-in tools
 * @param mcpTools - MCP tools from appState.mcp.tools
 * @returns Combined, deduplicated array of built-in and MCP tools
 */
export function assembleToolPool(
	permissionContext: ToolPermissionContext,
	mcpTools: Tools,
): Tools {
	const builtInTools = getTools(permissionContext);

	// Filter out MCP tools that are in the deny list
	const allowedMcpTools = filterToolsByDenyRules(mcpTools, permissionContext);

	// Sort each partition for prompt-cache stability, keeping built-ins as a
	// contiguous prefix. The server's claude_code_system_cache_policy places a
	// global cache breakpoint after the last prefix-matched built-in tool; a flat
	// sort would interleave MCP tools into built-ins and invalidate all downstream
	// cache keys whenever an MCP tool sorts between existing built-ins. uniqBy
	// preserves insertion order, so built-ins win on name conflict.
	// Avoid Array.toSorted (Node 20+) — we support Node 18. builtInTools is
	// readonly so copy-then-sort; allowedMcpTools is a fresh .filter() result.
	const byName = (a: Tool, b: Tool) => a.name.localeCompare(b.name);
	return uniqBy(
		[...builtInTools].sort(byName).concat(allowedMcpTools.sort(byName)),
		"name",
	);
}

/**
 * Get all tools including both built-in tools and MCP tools.
 *
 * This is the preferred function when you need the complete tools list for:
 * - Tool search threshold calculations (isToolSearchEnabled)
 * - Token counting that includes MCP tools
 * - Any context where MCP tools should be considered
 *
 * Use getTools() only when you specifically need just built-in tools.
 *
 * @param permissionContext - Permission context for filtering built-in tools
 * @param mcpTools - MCP tools from appState.mcp.tools
 * @returns Combined array of built-in and MCP tools
 */
export function getMergedTools(
	permissionContext: ToolPermissionContext,
	mcpTools: Tools,
): Tools {
	const builtInTools = getTools(permissionContext);
	return [...builtInTools, ...mcpTools];
}
