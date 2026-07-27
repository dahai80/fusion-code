/**
 * SDK Control Schemas - Zod schemas for the control protocol.
 *
 * These schemas define the control protocol between SDK implementations and the CLI.
 * Used by SDK builders (e.g., Python SDK) to communicate with the CLI process.
 *
 * SDK consumers should use coreSchemas.ts instead.
 */

import { z } from "zod/v4";
import { lazySchema } from "../../utils/lazySchema.js";
import {
	AccountInfoSchema,
	AgentDefinitionSchema,
	AgentInfoSchema,
	FastModeStateSchema,
	HookEventSchema,
	HookInputSchema,
	McpServerConfigForProcessTransportSchema,
	McpServerStatusSchema,
	ModelInfoSchema,
	PermissionModeSchema,
	PermissionUpdateSchema,
	SDKMessageSchema,
	SDKPostTurnSummaryMessageSchema,
	SDKStreamlinedTextMessageSchema,
	SDKStreamlinedToolUseSummaryMessageSchema,
	SDKUserMessageSchema,
	SlashCommandSchema,
} from "./coreSchemas.js";

// ============================================================================
// External Type Placeholders
// ============================================================================

// JSONRPCMessage from @modelcontextprotocol/sdk - treat as unknown
export const JSONRPCMessagePlaceholder = lazySchema(() => z.unknown());

// ============================================================================
// Hook Callback Types
// ============================================================================

export const SDKHookCallbackMatcherSchema = lazySchema(() =>
	z
		.object({
			matcher: z.string().optional(),
			hookCallbackIds: z.array(z.string()),
			timeout: z.number().optional(),
		})
		.describe("Configuration for matching and routing hook callbacks."),
);

// ============================================================================
// Control Request Types
// ============================================================================

export const SDKControlInitializeRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("initialize"),
			hooks: z
				.record(HookEventSchema(), z.array(SDKHookCallbackMatcherSchema()))
				.optional(),
			sdkMcpServers: z.array(z.string()).optional(),
			jsonSchema: z.record(z.string(), z.unknown()).optional(),
			systemPrompt: z.string().optional(),
			appendSystemPrompt: z.string().optional(),
			agents: z.record(z.string(), AgentDefinitionSchema()).optional(),
			promptSuggestions: z.boolean().optional(),
			agentProgressSummaries: z.boolean().optional(),
		})
		.describe(
			"Initializes the SDK session with hooks, MCP servers, and agent configuration.",
		),
);

export const SDKControlInitializeResponseSchema = lazySchema(() =>
	z
		.object({
			commands: z.array(SlashCommandSchema()),
			agents: z.array(AgentInfoSchema()),
			output_style: z.string(),
			available_output_styles: z.array(z.string()),
			models: z.array(ModelInfoSchema()),
			account: AccountInfoSchema(),
			pid: z
				.number()
				.optional()
				.describe("@internal CLI process PID for tmux socket isolation"),
			fast_mode_state: FastModeStateSchema().optional(),
		})
		.describe(
			"Response from session initialization with available commands, models, and account info.",
		),
);

export const SDKControlInterruptRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("interrupt"),
		})
		.describe("Interrupts the currently running conversation turn."),
);

export const SDKControlPermissionRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("can_use_tool"),
			tool_name: z.string(),
			input: z.record(z.string(), z.unknown()),
			permission_suggestions: z.array(PermissionUpdateSchema()).optional(),
			blocked_path: z.string().optional(),
			decision_reason: z.string().optional(),
			title: z.string().optional(),
			display_name: z.string().optional(),
			tool_use_id: z.string(),
			agent_id: z.string().optional(),
			description: z.string().optional(),
		})
		.describe("Requests permission to use a tool with the given input."),
);

export const SDKControlSetPermissionModeRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("set_permission_mode"),
			mode: PermissionModeSchema(),
			ultraplan: z
				.boolean()
				.optional()
				.describe("@internal CCR ultraplan session marker."),
		})
		.describe("Sets the permission mode for tool execution handling."),
);

export const SDKControlSetModelRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("set_model"),
			model: z.string().optional(),
		})
		.describe("Sets the model to use for subsequent conversation turns."),
);

export const SDKControlSetMaxThinkingTokensRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("set_max_thinking_tokens"),
			max_thinking_tokens: z.number().nullable(),
		})
		.describe(
			"Sets the maximum number of thinking tokens for extended thinking.",
		),
);

export const SDKControlMcpStatusRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("mcp_status"),
		})
		.describe("Requests the current status of all MCP server connections."),
);

export const SDKControlMcpStatusResponseSchema = lazySchema(() =>
	z
		.object({
			mcpServers: z.array(McpServerStatusSchema()),
		})
		.describe(
			"Response containing the current status of all MCP server connections.",
		),
);

export const SDKControlGetContextUsageRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("get_context_usage"),
		})
		.describe(
			"Requests a breakdown of current context window usage by category.",
		),
);

const ContextCategorySchema = lazySchema(() =>
	z.object({
		name: z.string(),
		tokens: z.number(),
		color: z.string(),
		isDeferred: z.boolean().optional(),
	}),
);

const ContextGridSquareSchema = lazySchema(() =>
	z.object({
		color: z.string(),
		isFilled: z.boolean(),
		categoryName: z.string(),
		tokens: z.number(),
		percentage: z.number(),
		squareFullness: z.number(),
	}),
);

export const SDKControlGetContextUsageResponseSchema = lazySchema(() =>
	z
		.object({
			categories: z.array(ContextCategorySchema()),
			totalTokens: z.number(),
			maxTokens: z.number(),
			rawMaxTokens: z.number(),
			percentage: z.number(),
			gridRows: z.array(z.array(ContextGridSquareSchema())),
			model: z.string(),
			memoryFiles: z.array(
				z.object({
					path: z.string(),
					type: z.string(),
					tokens: z.number(),
				}),
			),
			mcpTools: z.array(
				z.object({
					name: z.string(),
					serverName: z.string(),
					tokens: z.number(),
					isLoaded: z.boolean().optional(),
				}),
			),
			deferredBuiltinTools: z
				.array(
					z.object({
						name: z.string(),
						tokens: z.number(),
						isLoaded: z.boolean(),
					}),
				)
				.optional(),
			systemTools: z
				.array(z.object({ name: z.string(), tokens: z.number() }))
				.optional(),
			systemPromptSections: z
				.array(z.object({ name: z.string(), tokens: z.number() }))
				.optional(),
			agents: z.array(
				z.object({
					agentType: z.string(),
					source: z.string(),
					tokens: z.number(),
				}),
			),
			slashCommands: z
				.object({
					totalCommands: z.number(),
					includedCommands: z.number(),
					tokens: z.number(),
				})
				.optional(),
			skills: z
				.object({
					totalSkills: z.number(),
					includedSkills: z.number(),
					tokens: z.number(),
					skillFrontmatter: z.array(
						z.object({
							name: z.string(),
							source: z.string(),
							tokens: z.number(),
						}),
					),
				})
				.optional(),
			autoCompactThreshold: z.number().optional(),
			isAutoCompactEnabled: z.boolean(),
			messageBreakdown: z
				.object({
					toolCallTokens: z.number(),
					toolResultTokens: z.number(),
					attachmentTokens: z.number(),
					assistantMessageTokens: z.number(),
					userMessageTokens: z.number(),
					toolCallsByType: z.array(
						z.object({
							name: z.string(),
							callTokens: z.number(),
							resultTokens: z.number(),
						}),
					),
					attachmentsByType: z.array(
						z.object({ name: z.string(), tokens: z.number() }),
					),
				})
				.optional(),
			apiUsage: z
				.object({
					input_tokens: z.number(),
					output_tokens: z.number(),
					cache_creation_input_tokens: z.number(),
					cache_read_input_tokens: z.number(),
				})
				.nullable(),
		})
		.describe(
			"Breakdown of current context window usage by category (system prompt, tools, messages, etc.).",
		),
);

export const SDKControlRewindFilesRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("rewind_files"),
			user_message_id: z.string(),
			dry_run: z.boolean().optional(),
		})
		.describe("Rewinds file changes made since a specific user message."),
);

export const SDKControlRewindFilesResponseSchema = lazySchema(() =>
	z
		.object({
			canRewind: z.boolean(),
			error: z.string().optional(),
			filesChanged: z.array(z.string()).optional(),
			insertions: z.number().optional(),
			deletions: z.number().optional(),
		})
		.describe("Result of a rewindFiles operation."),
);

export const SDKControlCancelAsyncMessageRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("cancel_async_message"),
			message_uuid: z.string(),
		})
		.describe(
			"Drops a pending async user message from the command queue by uuid. No-op if already dequeued for execution.",
		),
);

export const SDKControlCancelAsyncMessageResponseSchema = lazySchema(() =>
	z
		.object({
			cancelled: z.boolean(),
		})
		.describe(
			"Result of a cancel_async_message operation. cancelled=false means the message was not in the queue (already dequeued or never enqueued).",
		),
);

export const SDKControlSeedReadStateRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("seed_read_state"),
			path: z.string(),
			mtime: z.number(),
		})
		.describe(
			"Seeds the readFileState cache with a path+mtime entry. Use when a prior Read was removed from context (e.g. by snip) so Edit validation would fail despite the client having observed the Read. The mtime lets the CLI detect if the file changed since the seeded Read — same staleness check as the normal path.",
		),
);

export const SDKHookCallbackRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("hook_callback"),
			callback_id: z.string(),
			input: HookInputSchema(),
			tool_use_id: z.string().optional(),
		})
		.describe("Delivers a hook callback with its input data."),
);

export const SDKControlMcpMessageRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("mcp_message"),
			server_name: z.string(),
			message: JSONRPCMessagePlaceholder(),
		})
		.describe("Sends a JSON-RPC message to a specific MCP server."),
);

export const SDKControlMcpSetServersRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("mcp_set_servers"),
			servers: z.record(z.string(), McpServerConfigForProcessTransportSchema()),
		})
		.describe("Replaces the set of dynamically managed MCP servers."),
);

export const SDKControlMcpSetServersResponseSchema = lazySchema(() =>
	z
		.object({
			added: z.array(z.string()),
			removed: z.array(z.string()),
			errors: z.record(z.string(), z.string()),
		})
		.describe(
			"Result of replacing the set of dynamically managed MCP servers.",
		),
);

export const SDKControlReloadPluginsRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("reload_plugins"),
		})
		.describe(
			"Reloads plugins from disk and returns the refreshed session components.",
		),
);

export const SDKControlReloadPluginsResponseSchema = lazySchema(() =>
	z
		.object({
			commands: z.array(SlashCommandSchema()),
			agents: z.array(AgentInfoSchema()),
			plugins: z.array(
				z.object({
					name: z.string(),
					path: z.string(),
					source: z.string().optional(),
				}),
			),
			mcpServers: z.array(McpServerStatusSchema()),
			error_count: z.number(),
		})
		.describe(
			"Refreshed commands, agents, plugins, and MCP server status after reload.",
		),
);

export const SDKControlMcpReconnectRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("mcp_reconnect"),
			serverName: z.string(),
		})
		.describe("Reconnects a disconnected or failed MCP server."),
);

export const SDKControlMcpToggleRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("mcp_toggle"),
			serverName: z.string(),
			enabled: z.boolean(),
		})
		.describe("Enables or disables an MCP server."),
);

export const SDKControlStopTaskRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("stop_task"),
			task_id: z.string(),
		})
		.describe("Stops a running task."),
);

export const SDKControlApplyFlagSettingsRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("apply_flag_settings"),
			settings: z.record(z.string(), z.unknown()),
		})
		.describe(
			"Merges the provided settings into the flag settings layer, updating the active configuration.",
		),
);

export const SDKControlGetSettingsRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("get_settings"),
		})
		.describe(
			"Returns the effective merged settings and the raw per-source settings.",
		),
);

export const SDKControlGetSettingsResponseSchema = lazySchema(() =>
	z
		.object({
			effective: z.record(z.string(), z.unknown()),
			sources: z
				.array(
					z.object({
						source: z.enum([
							"userSettings",
							"projectSettings",
							"localSettings",
							"flagSettings",
							"policySettings",
						]),
						settings: z.record(z.string(), z.unknown()),
					}),
				)
				.describe(
					"Ordered low-to-high priority — later entries override earlier ones.",
				),
			applied: z
				.object({
					model: z.string(),
					// String levels only — numeric effort is ant-only and the
					// Zod→proto generator can't emit enum∪number unions.
					effort: z.enum(["low", "medium", "high", "max"]).nullable(),
				})
				.optional()
				.describe(
					"Runtime-resolved values after env overrides, session state, and model-specific defaults are applied. Unlike `effective` (disk merge), these reflect what will actually be sent to the API.",
				),
		})
		.describe(
			"Effective merged settings plus raw per-source settings in merge order.",
		),
);

export const SDKControlElicitationRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("elicitation"),
			mcp_server_name: z.string(),
			message: z.string(),
			mode: z.enum(["form", "url"]).optional(),
			url: z.string().optional(),
			elicitation_id: z.string().optional(),
			requested_schema: z.record(z.string(), z.unknown()).optional(),
		})
		.describe(
			"Requests the SDK consumer to handle an MCP elicitation (user input request).",
		),
);

export const SDKControlElicitationResponseSchema = lazySchema(() =>
	z
		.object({
			action: z.enum(["accept", "decline", "cancel"]),
			content: z.record(z.string(), z.unknown()).optional(),
		})
		.describe("Response from the SDK consumer for an elicitation request."),
);

// ============================================================================
// Code API Schemas (Issues #3, #4, #5)
// ============================================================================

// Issue #5: Command Execution

export const SDKControlCodeExecRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("code_exec"),
			command: z.string().describe("Shell command to execute"),
			cwd: z.string().optional().describe("Working directory for the command"),
			timeout: z
				.number()
				.optional()
				.describe("Timeout in seconds (default: 120)"),
		})
		.describe("Executes a shell command and returns output."),
);

export const SDKControlCodeExecResponseSchema = lazySchema(() =>
	z
		.object({
			pid: z.number().describe("Process ID of the executed command"),
			exit_code: z
				.number()
				.nullable()
				.describe("Exit code (null if timed out or still running)"),
			stdout: z.string().describe("Combined stdout output"),
			stderr: z.string().describe("Combined stderr output"),
		})
		.describe("Result of command execution."),
);

export const SDKControlCodeProcessesRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("code_processes"),
		})
		.describe("Lists running child processes spawned by code.exec."),
);

export const SDKControlCodeProcessesResponseSchema = lazySchema(() =>
	z
		.object({
			processes: z.array(
				z.object({
					pid: z.number(),
					command: z.string(),
					cwd: z.string().optional(),
					status: z.enum(["running", "exited", "signaled"]),
					exit_code: z.number().nullable().optional(),
				}),
			),
		})
		.describe("List of tracked child processes."),
);

export const SDKControlCodeKillRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("code_kill"),
			pid: z.number().describe("Process ID to kill"),
			signal: z
				.string()
				.optional()
				.describe("Signal to send (default: SIGTERM)"),
		})
		.describe("Kills a running child process by PID."),
);

export const SDKControlCodeKillResponseSchema = lazySchema(() =>
	z
		.object({
			killed: z
				.boolean()
				.describe("Whether the process was successfully killed"),
		})
		.describe("Result of kill operation."),
);

// Issue #4: File Operations

export const SDKControlCodeFileReadRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("code_file_read"),
			path: z.string().describe("Absolute or relative file path to read"),
			encoding: z
				.string()
				.optional()
				.describe("File encoding (default: utf-8)"),
			offset: z
				.number()
				.optional()
				.describe("Line offset to start reading from"),
			limit: z.number().optional().describe("Maximum number of lines to read"),
		})
		.describe("Reads a file and returns its content."),
);

export const SDKControlCodeFileReadResponseSchema = lazySchema(() =>
	z
		.object({
			content: z.string().describe("File content"),
			size: z.number().describe("File size in bytes"),
			encoding: z.string().describe("Encoding used to read the file"),
		})
		.describe("Result of file read operation."),
);

export const SDKControlCodeFileWriteRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("code_file_write"),
			path: z.string().describe("Absolute or relative file path to write"),
			content: z.string().describe("Content to write to the file"),
			create_dirs: z
				.boolean()
				.optional()
				.describe("Create parent directories if they don't exist"),
			encoding: z
				.string()
				.optional()
				.describe("File encoding (default: utf-8)"),
		})
		.describe("Writes content to a file, creating it if it doesn't exist."),
);

export const SDKControlCodeFileWriteResponseSchema = lazySchema(() =>
	z
		.object({
			written: z
				.boolean()
				.describe("Whether the file was successfully written"),
			size: z.number().describe("Number of bytes written"),
		})
		.describe("Result of file write operation."),
);

export const SDKControlCodeDiffRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("code_diff"),
			original: z.string().describe("Original file content"),
			modified: z.string().describe("Modified file content"),
			path: z.string().optional().describe("File path for diff header"),
			language: z
				.string()
				.optional()
				.describe("Language for syntax-aware diff"),
		})
		.describe("Generates a unified diff between two text contents."),
);

export const SDKControlCodeDiffResponseSchema = lazySchema(() =>
	z
		.object({
			patch: z.string().describe("Unified diff output"),
			additions: z.number().describe("Number of added lines"),
			deletions: z.number().describe("Number of deleted lines"),
		})
		.describe("Result of diff generation."),
);

export const SDKControlCodeApplyPatchRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("code_apply_patch"),
			path: z.string().describe("File path to apply the patch to"),
			patch: z.string().describe("Unified diff patch to apply"),
			backup: z
				.boolean()
				.optional()
				.describe("Create a .bak backup before applying (default: true)"),
		})
		.describe("Applies a unified diff patch to a file with optional backup."),
);

export const SDKControlCodeApplyPatchResponseSchema = lazySchema(() =>
	z
		.object({
			applied: z
				.boolean()
				.describe("Whether the patch was successfully applied"),
			backup_path: z
				.string()
				.optional()
				.describe("Path to backup file if backup was created"),
		})
		.describe("Result of patch application."),
);

export const SDKControlCodeSearchFilesRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("code_search_files"),
			pattern: z.string().describe("Search pattern (regex or glob)"),
			path: z
				.string()
				.optional()
				.describe("Directory to search in (default: cwd)"),
			type: z
				.enum(["content", "filename"])
				.optional()
				.describe(
					"Search type: content grep or filename glob (default: content)",
				),
			max_results: z
				.number()
				.optional()
				.describe("Maximum number of results (default: 20)"),
		})
		.describe("Searches files by content pattern or filename glob."),
);

export const SDKControlCodeSearchFilesResponseSchema = lazySchema(() =>
	z
		.object({
			results: z.array(
				z.object({
					path: z.string().describe("File path"),
					line: z
						.number()
						.optional()
						.describe("Line number (for content search)"),
					content: z
						.string()
						.optional()
						.describe("Matching line content (for content search)"),
				}),
			),
			total: z
				.number()
				.describe("Total matches found (may exceed max_results)"),
		})
		.describe("Result of file search operation."),
);

// Issue #3: Artifact Chat

export const SDKControlArtifactChatRequestSchema = lazySchema(() =>
	z
		.object({
			subtype: z.literal("artifact_chat"),
			kind: z
				.enum(["app", "game", "tool", "document", "template", "code"])
				.describe("Artifact kind to generate"),
			message: z.string().describe("User description of what to generate"),
			session_id: z
				.string()
				.optional()
				.describe("Session ID for conversation continuity"),
			artifact_id: z
				.string()
				.optional()
				.describe("Existing artifact ID for follow-up iterations"),
		})
		.describe("Generates or iterates on an artifact through AI conversation."),
);

export const SDKControlArtifactChatResponseSchema = lazySchema(() =>
	z
		.object({
			artifact_id: z.string().describe("Created or updated artifact ID"),
			name: z.string().describe("Artifact name"),
			version: z.number().describe("Artifact version number"),
			type: z.string().describe("Artifact type"),
			ref_text: z.string().describe("Compact reference tag for the artifact"),
		})
		.describe("Result of artifact chat generation."),
);

// ============================================================================
// Control Request/Response Wrappers
// ============================================================================

export const SDKControlRequestInnerSchema = lazySchema(() =>
	z.union([
		SDKControlInterruptRequestSchema(),
		SDKControlPermissionRequestSchema(),
		SDKControlInitializeRequestSchema(),
		SDKControlSetPermissionModeRequestSchema(),
		SDKControlSetModelRequestSchema(),
		SDKControlSetMaxThinkingTokensRequestSchema(),
		SDKControlMcpStatusRequestSchema(),
		SDKControlGetContextUsageRequestSchema(),
		SDKHookCallbackRequestSchema(),
		SDKControlMcpMessageRequestSchema(),
		SDKControlRewindFilesRequestSchema(),
		SDKControlCancelAsyncMessageRequestSchema(),
		SDKControlSeedReadStateRequestSchema(),
		SDKControlMcpSetServersRequestSchema(),
		SDKControlReloadPluginsRequestSchema(),
		SDKControlMcpReconnectRequestSchema(),
		SDKControlMcpToggleRequestSchema(),
		SDKControlStopTaskRequestSchema(),
		SDKControlApplyFlagSettingsRequestSchema(),
		SDKControlGetSettingsRequestSchema(),
		SDKControlElicitationRequestSchema(),
		SDKControlCodeExecRequestSchema(),
		SDKControlCodeProcessesRequestSchema(),
		SDKControlCodeKillRequestSchema(),
		SDKControlCodeFileReadRequestSchema(),
		SDKControlCodeFileWriteRequestSchema(),
		SDKControlCodeDiffRequestSchema(),
		SDKControlCodeApplyPatchRequestSchema(),
		SDKControlCodeSearchFilesRequestSchema(),
		SDKControlArtifactChatRequestSchema(),
	]),
);

export const SDKControlRequestSchema = lazySchema(() =>
	z.object({
		type: z.literal("control_request"),
		request_id: z.string(),
		request: SDKControlRequestInnerSchema(),
	}),
);

export const ControlResponseSchema = lazySchema(() =>
	z.object({
		subtype: z.literal("success"),
		request_id: z.string(),
		response: z.record(z.string(), z.unknown()).optional(),
	}),
);

export const ControlErrorResponseSchema = lazySchema(() =>
	z.object({
		subtype: z.literal("error"),
		request_id: z.string(),
		error: z.string(),
		pending_permission_requests: z
			.array(z.lazy(() => SDKControlRequestSchema()))
			.optional(),
	}),
);

export const SDKControlResponseSchema = lazySchema(() =>
	z.object({
		type: z.literal("control_response"),
		response: z.union([ControlResponseSchema(), ControlErrorResponseSchema()]),
	}),
);

export const SDKControlCancelRequestSchema = lazySchema(() =>
	z
		.object({
			type: z.literal("control_cancel_request"),
			request_id: z.string(),
		})
		.describe("Cancels a currently open control request."),
);

export const SDKKeepAliveMessageSchema = lazySchema(() =>
	z
		.object({
			type: z.literal("keep_alive"),
		})
		.describe("Keep-alive message to maintain WebSocket connection."),
);

export const SDKUpdateEnvironmentVariablesMessageSchema = lazySchema(() =>
	z
		.object({
			type: z.literal("update_environment_variables"),
			variables: z.record(z.string(), z.string()),
		})
		.describe("Updates environment variables at runtime."),
);

// ============================================================================
// Aggregate Message Types
// ============================================================================

export const StdoutMessageSchema = lazySchema(() =>
	z.union([
		SDKMessageSchema(),
		SDKStreamlinedTextMessageSchema(),
		SDKStreamlinedToolUseSummaryMessageSchema(),
		SDKPostTurnSummaryMessageSchema(),
		SDKControlResponseSchema(),
		SDKControlRequestSchema(),
		SDKControlCancelRequestSchema(),
		SDKKeepAliveMessageSchema(),
	]),
);

export const StdinMessageSchema = lazySchema(() =>
	z.union([
		SDKUserMessageSchema(),
		SDKControlRequestSchema(),
		SDKControlResponseSchema(),
		SDKKeepAliveMessageSchema(),
		SDKUpdateEnvironmentVariablesMessageSchema(),
	]),
);
