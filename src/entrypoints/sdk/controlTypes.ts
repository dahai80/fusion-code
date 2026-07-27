/**
 * SDK Control Types - TypeScript types for the control protocol.
 *
 * These types define the control protocol between SDK implementations and the CLI.
 * Used by SDK builders (e.g., Python SDK) to communicate with the CLI process.
 *
 * Types are derived from Zod schemas in controlSchemas.ts.
 * To modify types:
 * 1. Edit Zod schemas in controlSchemas.ts
 * 2. Update corresponding types here
 *
 * SDK consumers should use coreTypes.ts instead.
 */

import type {
    HookEvent,
    PermissionMode,
    SDKMessage,
    SDKUserMessage,
} from './coreTypes.generated.js'

// ============================================================================
// Re-exported / Inline Sub-types (not yet in coreTypes.generated.ts)
// ============================================================================

export type SlashCommand = {
    name: string
    description: string
    argumentHint: string
}

export type AgentInfo = {
    name: string
    description: string
    model?: string
}

export type ModelInfo = {
    value: string
    displayName: string
    description: string
    supportsEffort?: boolean
    supportedEffortLevels?: ('low' | 'medium' | 'high' | 'max')[]
    supportsAdaptiveThinking?: boolean
    supportsFastMode?: boolean
    supportsAutoMode?: boolean
}

export type AccountInfo = {
    email?: string
    organization?: string
    subscriptionType?: string
    tokenSource?: string
    apiKeySource?: string
    apiProvider?: 'firstParty' | 'foundry' | 'openai' | 'fusionMlx'
}

export type FastModeState = 'off' | 'cooldown' | 'on'

export type PermissionRuleValue = {
    toolName: string
    ruleContent?: string
}

export type PermissionUpdateDestination =
    | 'userSettings'
    | 'projectSettings'
    | 'localSettings'
    | 'session'
    | 'cliArg'

export type PermissionUpdate =
    | {
          type: 'addRules'
          rules: PermissionRuleValue[]
          behavior: 'allow' | 'deny' | 'ask'
          destination: PermissionUpdateDestination
      }
    | {
          type: 'replaceRules'
          rules: PermissionRuleValue[]
          behavior: 'allow' | 'deny' | 'ask'
          destination: PermissionUpdateDestination
      }
    | {
          type: 'removeRules'
          rules: PermissionRuleValue[]
          behavior: 'allow' | 'deny' | 'ask'
          destination: PermissionUpdateDestination
      }
    | {
          type: 'setMode'
          mode: PermissionMode
          destination: PermissionUpdateDestination
      }
    | {
          type: 'addDirectories'
          directories: string[]
          destination: PermissionUpdateDestination
      }
    | {
          type: 'removeDirectories'
          directories: string[]
          destination: PermissionUpdateDestination
      }

export type McpStdioServerConfig = {
    type?: 'stdio'
    command: string
    args?: string[]
    env?: Record<string, string>
}

export type McpSSEServerConfig = {
    type: 'sse'
    url: string
    headers?: Record<string, string>
}

export type McpHttpServerConfig = {
    type: 'http'
    url: string
    headers?: Record<string, string>
}

export type McpSdkServerConfig = {
    type: 'sdk'
    name: string
}

export type McpServerConfigForProcessTransport =
    | McpStdioServerConfig
    | McpSSEServerConfig
    | McpHttpServerConfig
    | McpSdkServerConfig

export type McpClaudeAIProxyServerConfig = {
    type: 'claudeai-proxy'
    url: string
    id: string
}

export type McpServerStatusConfig =
    | McpServerConfigForProcessTransport
    | McpClaudeAIProxyServerConfig

export type McpToolInfo = {
    name: string
    description?: string
    annotations?: {
        readOnly?: boolean
        destructive?: boolean
        openWorld?: boolean
    }
}

export type McpServerStatus = {
    name: string
    status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
    serverInfo?: {
        name: string
        version: string
    }
    error?: string
    config?: McpServerStatusConfig
    scope?: string
    tools?: McpToolInfo[]
    capabilities?: {
        experimental?: Record<string, unknown>
    }
}

export type AgentDefinition = {
    description: string
    tools?: string[]
    disallowedTools?: string[]
    prompt: string
    model?: string
    mcpServers?: (string | Record<string, McpServerConfigForProcessTransport>)[]
    criticalSystemReminder_EXPERIMENTAL?: string
    skills?: string[]
    initialPrompt?: string
    maxTurns?: number
    background?: boolean
    memory?: 'user' | 'project' | 'local'
    effort?: 'low' | 'medium' | 'high' | 'max' | number
}

export type SDKStreamlinedTextMessage = {
    type: 'streamlined_text'
    text: string
    session_id: string
    uuid: string
}

export type SDKStreamlinedToolUseSummaryMessage = {
    type: 'streamlined_tool_use_summary'
    tool_summary: string
    session_id: string
    uuid: string
}

export type SDKPostTurnSummaryMessage = {
    type: 'system'
    subtype: 'post_turn_summary'
    summarizes_uuid: string
    status_category: 'blocked' | 'waiting' | 'completed' | 'review_ready' | 'failed'
    status_detail: string
    is_noteworthy: boolean
    title: string
    description: string
    recent_action: string
    needs_action: string
    artifact_urls: string[]
    uuid: string
    session_id: string
}

// ============================================================================
// Hook Callback Types
// ============================================================================

export type SDKHookCallbackMatcher = {
    matcher?: string
    hookCallbackIds: string[]
    timeout?: number
}

// ============================================================================
// Control Request Types
// ============================================================================

export type SDKControlInitializeRequest = {
    subtype: 'initialize'
    hooks?: Partial<Record<HookEvent, SDKHookCallbackMatcher[]>>
    sdkMcpServers?: string[]
    jsonSchema?: Record<string, unknown>
    systemPrompt?: string
    appendSystemPrompt?: string
    agents?: Record<string, AgentDefinition>
    promptSuggestions?: boolean
    agentProgressSummaries?: boolean
}

export type SDKControlInitializeResponse = {
    commands: SlashCommand[]
    agents: AgentInfo[]
    output_style: string
    available_output_styles: string[]
    models: ModelInfo[]
    account: AccountInfo
    pid?: number
    fast_mode_state?: FastModeState
}

export type SDKControlInterruptRequest = {
    subtype: 'interrupt'
}

export type SDKControlPermissionRequest = {
    subtype: 'can_use_tool'
    tool_name: string
    input: Record<string, unknown>
    permission_suggestions?: PermissionUpdate[]
    blocked_path?: string
    decision_reason?: string
    title?: string
    display_name?: string
    tool_use_id: string
    agent_id?: string
    description?: string
}

export type SDKControlSetPermissionModeRequest = {
    subtype: 'set_permission_mode'
    mode: PermissionMode
    ultraplan?: boolean
}

export type SDKControlSetModelRequest = {
    subtype: 'set_model'
    model?: string
}

export type SDKControlSetMaxThinkingTokensRequest = {
    subtype: 'set_max_thinking_tokens'
    max_thinking_tokens: number | null
}

export type SDKControlMcpStatusRequest = {
    subtype: 'mcp_status'
}

export type SDKControlMcpStatusResponse = {
    mcpServers: McpServerStatus[]
}

export type SDKControlGetContextUsageRequest = {
    subtype: 'get_context_usage'
}

export type ContextCategory = {
    name: string
    tokens: number
    color: string
    isDeferred?: boolean
}

export type ContextGridSquare = {
    color: string
    isFilled: boolean
    categoryName: string
    tokens: number
    percentage: number
    squareFullness: number
}

export type SDKControlGetContextUsageResponse = {
    categories: ContextCategory[]
    totalTokens: number
    maxTokens: number
    rawMaxTokens: number
    percentage: number
    gridRows: ContextGridSquare[][]
    model: string
    memoryFiles: {
        path: string
        type: string
        tokens: number
    }[]
    mcpTools: {
        name: string
        serverName: string
        tokens: number
        isLoaded?: boolean
    }[]
    deferredBuiltinTools?: {
        name: string
        tokens: number
        isLoaded: boolean
    }[]
    systemTools?: {
        name: string
        tokens: number
    }[]
    systemPromptSections?: {
        name: string
        tokens: number
    }[]
    agents: {
        agentType: string
        source: string
        tokens: number
    }[]
    slashCommands?: {
        totalCommands: number
        includedCommands: number
        tokens: number
    }
    skills?: {
        totalSkills: number
        includedSkills: number
        tokens: number
        skillFrontmatter: {
            name: string
            source: string
            tokens: number
        }[]
    }
    autoCompactThreshold?: number
    isAutoCompactEnabled: boolean
    messageBreakdown?: {
        toolCallTokens: number
        toolResultTokens: number
        attachmentTokens: number
        assistantMessageTokens: number
        userMessageTokens: number
        toolCallsByType: {
            name: string
            callTokens: number
            resultTokens: number
        }[]
        attachmentsByType: {
            name: string
            tokens: number
        }[]
    }
    apiUsage: {
        input_tokens: number
        output_tokens: number
        cache_creation_input_tokens: number
        cache_read_input_tokens: number
    } | null
}

export type SDKControlRewindFilesRequest = {
    subtype: 'rewind_files'
    user_message_id: string
    dry_run?: boolean
}

export type SDKControlRewindFilesResponse = {
    canRewind: boolean
    error?: string
    filesChanged?: string[]
    insertions?: number
    deletions?: number
}

export type SDKControlCancelAsyncMessageRequest = {
    subtype: 'cancel_async_message'
    message_uuid: string
}

export type SDKControlCancelAsyncMessageResponse = {
    cancelled: boolean
}

export type SDKControlSeedReadStateRequest = {
    subtype: 'seed_read_state'
    path: string
    mtime: number
}

export type SDKHookCallbackRequest = {
    subtype: 'hook_callback'
    callback_id: string
    input: unknown
    tool_use_id?: string
}

export type SDKControlMcpMessageRequest = {
    subtype: 'mcp_message'
    server_name: string
    message: unknown
}

export type SDKControlMcpSetServersRequest = {
    subtype: 'mcp_set_servers'
    servers: Record<string, McpServerConfigForProcessTransport>
}

export type SDKControlMcpSetServersResponse = {
    added: string[]
    removed: string[]
    errors: Record<string, string>
}

export type SDKControlReloadPluginsRequest = {
    subtype: 'reload_plugins'
}

export type SDKControlReloadPluginsResponse = {
    commands: SlashCommand[]
    agents: AgentInfo[]
    plugins: {
        name: string
        path: string
        source?: string
    }[]
    mcpServers: McpServerStatus[]
    error_count: number
}

export type SDKControlMcpReconnectRequest = {
    subtype: 'mcp_reconnect'
    serverName: string
}

export type SDKControlMcpToggleRequest = {
    subtype: 'mcp_toggle'
    serverName: string
    enabled: boolean
}

export type SDKControlStopTaskRequest = {
    subtype: 'stop_task'
    task_id: string
}

export type SDKControlApplyFlagSettingsRequest = {
    subtype: 'apply_flag_settings'
    settings: Record<string, unknown>
}

export type SDKControlGetSettingsRequest = {
    subtype: 'get_settings'
}

export type SDKControlGetSettingsResponse = {
    effective: Record<string, unknown>
    sources: {
        source: 'userSettings' | 'projectSettings' | 'localSettings' | 'flagSettings' | 'policySettings'
        settings: Record<string, unknown>
    }[]
    applied?: {
        model: string
        effort: 'low' | 'medium' | 'high' | 'max' | null
    }
}

export type SDKControlElicitationRequest = {
    subtype: 'elicitation'
    mcp_server_name: string
    message: string
    mode?: 'form' | 'url'
    url?: string
    elicitation_id?: string
    requested_schema?: Record<string, unknown>
}

export type SDKControlElicitationResponse = {
    action: 'accept' | 'decline' | 'cancel'
    content?: Record<string, unknown>
}

// ============================================================================
// Code API Types
// ============================================================================

export type SDKControlCodeExecRequest = {
    subtype: 'code_exec'
    command: string
    cwd?: string
    timeout?: number
}

export type SDKControlCodeExecResponse = {
    pid: number
    exit_code: number | null
    stdout: string
    stderr: string
}

export type SDKControlCodeProcessesRequest = {
    subtype: 'code_processes'
}

export type SDKControlCodeProcessesResponse = {
    processes: {
        pid: number
        command: string
        cwd?: string
        status: 'running' | 'exited' | 'signaled'
        exit_code?: number | null
    }[]
}

export type SDKControlCodeKillRequest = {
    subtype: 'code_kill'
    pid: number
    signal?: string
}

export type SDKControlCodeKillResponse = {
    killed: boolean
}

export type SDKControlCodeFileReadRequest = {
    subtype: 'code_file_read'
    path: string
    encoding?: string
    offset?: number
    limit?: number
}

export type SDKControlCodeFileReadResponse = {
    content: string
    size: number
    encoding: string
}

export type SDKControlCodeFileWriteRequest = {
    subtype: 'code_file_write'
    path: string
    content: string
    create_dirs?: boolean
    encoding?: string
}

export type SDKControlCodeFileWriteResponse = {
    written: boolean
    size: number
}

export type SDKControlCodeDiffRequest = {
    subtype: 'code_diff'
    original: string
    modified: string
    path?: string
    language?: string
}

export type SDKControlCodeDiffResponse = {
    patch: string
    additions: number
    deletions: number
}

export type SDKControlCodeApplyPatchRequest = {
    subtype: 'code_apply_patch'
    path: string
    patch: string
    backup?: boolean
}

export type SDKControlCodeApplyPatchResponse = {
    applied: boolean
    backup_path?: string
}

export type SDKControlCodeSearchFilesRequest = {
    subtype: 'code_search_files'
    pattern: string
    path?: string
    type?: 'content' | 'filename'
    max_results?: number
}

export type SDKControlCodeSearchFilesResponse = {
    results: {
        path: string
        line?: number
        content?: string
    }[]
    total: number
}

export type SDKControlArtifactChatRequest = {
    subtype: 'artifact_chat'
    kind: 'app' | 'game' | 'tool' | 'document' | 'template' | 'code'
    message: string
    session_id?: string
    artifact_id?: string
}

export type SDKControlArtifactChatResponse = {
    artifact_id: string
    name: string
    version: number
    type: string
    ref_text: string
}

// ============================================================================
// Control Request/Response Wrappers
// ============================================================================

export type SDKControlRequestInner =
    | SDKControlInterruptRequest
    | SDKControlPermissionRequest
    | SDKControlInitializeRequest
    | SDKControlSetPermissionModeRequest
    | SDKControlSetModelRequest
    | SDKControlSetMaxThinkingTokensRequest
    | SDKControlMcpStatusRequest
    | SDKControlGetContextUsageRequest
    | SDKHookCallbackRequest
    | SDKControlMcpMessageRequest
    | SDKControlRewindFilesRequest
    | SDKControlCancelAsyncMessageRequest
    | SDKControlSeedReadStateRequest
    | SDKControlMcpSetServersRequest
    | SDKControlReloadPluginsRequest
    | SDKControlMcpReconnectRequest
    | SDKControlMcpToggleRequest
    | SDKControlStopTaskRequest
    | SDKControlApplyFlagSettingsRequest
    | SDKControlGetSettingsRequest
    | SDKControlElicitationRequest
    | SDKControlCodeExecRequest
    | SDKControlCodeProcessesRequest
    | SDKControlCodeKillRequest
    | SDKControlCodeFileReadRequest
    | SDKControlCodeFileWriteRequest
    | SDKControlCodeDiffRequest
    | SDKControlCodeApplyPatchRequest
    | SDKControlCodeSearchFilesRequest
    | SDKControlArtifactChatRequest

export type SDKControlRequest = {
    type: 'control_request'
    request_id: string
    request: SDKControlRequestInner
}

export type ControlResponse = {
    subtype: 'success'
    request_id: string
    response?: Record<string, unknown>
}

export type ControlErrorResponse = {
    subtype: 'error'
    request_id: string
    error: string
    pending_permission_requests?: SDKControlRequest[]
}

export type SDKControlResponse = {
    type: 'control_response'
    response: ControlResponse | ControlErrorResponse
}

export type SDKControlCancelRequest = {
    type: 'control_cancel_request'
    request_id: string
}

export type SDKKeepAliveMessage = {
    type: 'keep_alive'
}

export type SDKUpdateEnvironmentVariablesMessage = {
    type: 'update_environment_variables'
    variables: Record<string, string>
}

// ============================================================================
// Aggregate Message Types
// ============================================================================

export type StdoutMessage =
    | SDKMessage
    | SDKStreamlinedTextMessage
    | SDKStreamlinedToolUseSummaryMessage
    | SDKPostTurnSummaryMessage
    | SDKControlResponse
    | SDKControlRequest
    | SDKControlCancelRequest
    | SDKKeepAliveMessage

export type StdinMessage =
    | SDKUserMessage
    | SDKControlRequest
    | SDKControlResponse
    | SDKKeepAliveMessage
    | SDKUpdateEnvironmentVariablesMessage
