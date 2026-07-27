export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'

export type ExitReason =
  | 'clear'
  | 'resume'
  | 'logout'
  | 'prompt_input_exit'
  | 'other'
  | 'bypass_permissions_disabled'

export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Notification'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'StopFailure'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PostCompact'
  | 'PermissionRequest'
  | 'PermissionDenied'
  | 'Setup'
  | 'TeammateIdle'
  | 'TaskCreated'
  | 'TaskCompleted'
  | 'Elicitation'
  | 'ElicitationResult'
  | 'ConfigChange'
  | 'WorktreeCreate'
  | 'WorktreeRemove'
  | 'InstructionsLoaded'
  | 'CwdChanged'
  | 'FileChanged'

export type ModelUsage = {
  costUSD?: number
  inputTokens?: number
  outputTokens?: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  [key: string]: number | undefined
}

export type SDKStatus = 'compacting' | string | null

export type SDKBaseMessage = {
  type: string
  subtype?: string
  uuid?: string
  session_id?: string
  [key: string]: unknown
}

export type SDKAssistantMessage = SDKBaseMessage & {
  type: 'assistant'
  message?: { content?: unknown[] }
}

export type SDKAssistantMessageError = SDKBaseMessage & {
  type: 'assistant_error'
  message?: string
}

export type SDKPartialAssistantMessage = SDKBaseMessage & {
  type: 'assistant_partial'
  delta?: string
}

export type SDKResultMessage = SDKBaseMessage & {
  type: 'result'
  is_error?: boolean
  result?: string
  duration_ms?: number
  total_cost_usd?: number
}

export type SDKStatusMessage = SDKBaseMessage & {
  type: 'status'
  status: SDKStatus
}

export type SDKSystemMessage = SDKBaseMessage & {
  type: 'system'
  content?: string
}

export type SDKCompactMetadata = { // log: fix TS2339
  trigger: 'manual' | 'auto' // log: fix TS2339
  pre_tokens: number // log: fix TS2339
  preserved_segment?: { // log: fix TS2339
    head_uuid: string // log: fix TS2339
    anchor_uuid: string // log: fix TS2339
    tail_uuid: string // log: fix TS2339
  } // log: fix TS2339
} // log: fix TS2339

export type SDKCompactBoundaryMessage = SDKSystemMessage & {
  subtype: 'compact_boundary' | 'microcompact_boundary'
  compact_metadata: SDKCompactMetadata // log: fix TS2339
}

export type SDKToolProgressMessage = SDKBaseMessage & {
  type: 'tool_progress'
  data?: Record<string, unknown>
}

export type SDKPermissionDenial = SDKBaseMessage & {
  type: 'permission_denial'
  mode?: PermissionMode
  toolName?: string
}

export type SDKRateLimitInfo = {
  remaining?: number
  resetAt?: string
}

export type SDKUserMessage = SDKBaseMessage & {
  type: 'user'
  message?: { content?: unknown; role?: string } // log: fix TS2339
}

export type SDKUserMessageReplay = SDKUserMessage & {
  isReplay?: boolean
}

export type SDKSessionInfo = {
  sessionId: string
  summary?: string
  cwd?: string
  createdAt?: string
  updatedAt?: string
}

export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; toolUseID?: string } // log: fix TS2339
  | { behavior: 'deny'; message?: string; toolUseID?: string }
  | { behavior: 'ask'; updatedInput?: Record<string, unknown>; message?: string; toolUseID?: string }

export type HookInput = {
  session_id?: string
  event?: HookEvent
  [key: string]: unknown
}

export type HookJSONOutput = {
  continue?: boolean
  stopReason?: string
  message?: string
  decision?: 'allow' | 'deny' | 'ask' | 'block' | 'approve'
  [key: string]: unknown
}

export type SyncHookJSONOutput = HookJSONOutput

export type AsyncHookJSONOutput = HookJSONOutput & {
  waitMs?: number
}

export type SDKAuthStatusMessage = SDKBaseMessage & {
  type: 'auth_status'
}

export type SDKToolUseSummaryMessage = SDKBaseMessage & {
  type: 'tool_use_summary'
}

export type SDKRateLimitEventMessage = SDKBaseMessage & {
  type: 'rate_limit_event'
}

export type SDKStreamEventMessage = SDKBaseMessage & {
  type: 'stream_event'
  event?: unknown
}

export type SDKMessage =
  | SDKAssistantMessage
  | SDKAssistantMessageError
  | SDKCompactBoundaryMessage
  | SDKPartialAssistantMessage
  | SDKPermissionDenial
  | SDKResultMessage
  | SDKStatusMessage
  | SDKSystemMessage
  | SDKToolProgressMessage
  | SDKUserMessage
  | SDKUserMessageReplay
  | SDKAuthStatusMessage
  | SDKToolUseSummaryMessage
  | SDKRateLimitEventMessage
  | SDKStreamEventMessage

export type NotificationHookInput = HookInput & {
  hook_event_name: 'Notification'
  message: string
}
export type PostToolUseHookInput = HookInput & {
  hook_event_name: 'PostToolUse'
  tool_name: string
  tool_input: Record<string, unknown>
}
export type PostToolUseFailureHookInput = HookInput & {
  hook_event_name: 'PostToolUseFailure'
  tool_name: string
  tool_input: Record<string, unknown>
  error: string
}
export type PermissionDeniedHookInput = HookInput & {
  hook_event_name: 'PermissionDenied'
  tool_name: string
  tool_input: Record<string, unknown>
}
export type PreCompactHookInput = HookInput & {
  hook_event_name: 'PreCompact'
  custom_instructions?: string
  message_count?: number
}
export type PostCompactHookInput = HookInput & {
  hook_event_name: 'PostCompact'
  was_auto_compact?: boolean
  pre_tokens?: number
  post_tokens?: number
}
export type PreToolUseHookInput = HookInput & {
  hook_event_name: 'PreToolUse'
  tool_name: string
  tool_input: Record<string, unknown>
}
export type SessionStartHookInput = HookInput & {
  hook_event_name: 'SessionStart'
}
export type SessionEndHookInput = HookInput & {
  hook_event_name: 'SessionEnd'
  exit_reason: string
}
export type SetupHookInput = HookInput & {
  hook_event_name: 'Setup'
}
export type StopFailureHookInput = HookInput & {
  hook_event_name: 'StopFailure'
  error: string
}
export type SubagentStartHookInput = HookInput & {
  hook_event_name: 'SubagentStart'
  agent_id: string
  prompt: string
}
export type SubagentStopHookInput = HookInput & {
  hook_event_name: 'SubagentStop'
  agent_id: string
}
export type TeammateIdleHookInput = HookInput & {
  hook_event_name: 'TeammateIdle'
  agent_id: string
}
export type TaskCreatedHookInput = HookInput & {
  hook_event_name: 'TaskCreated'
  task_id: string
}
export type TaskCompletedHookInput = HookInput & {
  hook_event_name: 'TaskCompleted'
  task_id: string
}
export type ConfigChangeHookInput = HookInput & {
  hook_event_name: 'ConfigChange'
}
export type CwdChangedHookInput = HookInput & {
  hook_event_name: 'CwdChanged'
  cwd: string
}
export type FileChangedHookInput = HookInput & {
  hook_event_name: 'FileChanged'
  file_path: string
}
export type InstructionsLoadedHookInput = HookInput & {
  hook_event_name: 'InstructionsLoaded'
}
export type UserPromptSubmitHookInput = HookInput & {
  hook_event_name: 'UserPromptSubmit'
  prompt: string
}
export type PermissionRequestHookInput = HookInput & {
  hook_event_name: 'PermissionRequest'
  tool_name: string
  tool_input: Record<string, unknown>
}
export type ElicitationHookInput = HookInput & {
  hook_event_name: 'Elicitation'
  message: string
}
export type ElicitationResultHookInput = HookInput & {
  hook_event_name: 'ElicitationResult'
}
