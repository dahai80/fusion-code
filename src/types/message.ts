import type { UUID } from 'crypto'
import type {
    BetaContentBlock,
    BetaMessage,
    BetaRawMessageStreamEvent,
    BetaRedactedThinkingBlock,
    BetaThinkingBlock,
    BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ContentBlockParam, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages/messages.mjs'
import type { APIError } from '@anthropic-ai/sdk'
import type { HookEvent, SDKAssistantMessageError } from '../entrypoints/agentSdkTypes.js'
import type { PermissionMode } from './permissions.js'

// Re-export SDK types that message types depend on
export type {
    BetaContentBlock,
    BetaMessage,
    BetaRedactedThinkingBlock,
    BetaThinkingBlock,
    BetaToolUseBlock,
    ContentBlockParam,
    ToolResultBlockParam,
}

// ============================================================================
// Message origin
// ============================================================================

export type MessageOrigin =
    | { kind: 'task-notification' }
    | { kind: 'coordinator' }
    | { kind: 'channel'; server: string }
    | { kind: 'human' }

// ============================================================================
// System message level
// ============================================================================

export type SystemMessageLevel = 'info' | 'warn' | 'error' | 'suggestion' // log: fix TS2339

// ============================================================================
// Compact metadata
// ============================================================================

export type PartialCompactDirection = 'from' | 'to' | 'up_to' // log: fix TS2339

export type CompactMetadata = {
    trigger: 'manual' | 'auto'
    preTokens: number
    userContext?: string
    messagesSummarized?: number
    preCompactDiscoveredTools?: string[] // log: fix TS2339
    preservedSegment?: {
        headUuid: string
        anchorUuid: string
        tailUuid: string
    }
}

export type MicrocompactMetadata = {
    trigger: 'auto'
    preTokens: number
    tokensSaved: number
    compactedToolIds: string[]
    clearedAttachmentUUIDs: string[]
}

// ============================================================================
// Stop hook info
// ============================================================================

export type StopHookInfo = {
    command: string
    promptText?: string
    durationMs?: number // log: fix TS2339
}

// ============================================================================
// User message
// ============================================================================

export type UserMessage = {
    type: 'user'
    message: {
        role: 'user'
        content: string | ContentBlockParam[]
    }
    isMeta?: true
    isVisibleInTranscriptOnly?: true
    isVirtual?: true
    isCompactSummary?: true
    summarizeMetadata?: {
        messagesSummarized: number
        userContext?: string
        direction?: PartialCompactDirection
    }
    uuid: UUID
    timestamp: string
    toolUseResult?: unknown
    mcpMeta?: {
        _meta?: Record<string, unknown>
        structuredContent?: Record<string, unknown>
    }
    imagePasteIds?: number[]
    sourceToolAssistantUUID?: UUID
    permissionMode?: PermissionMode
    planContent?: string
    origin?: MessageOrigin
}

// ============================================================================
// Assistant message
// ============================================================================

export type AssistantMessage = {
    type: 'assistant'
    uuid: UUID
    timestamp: string
    message: Omit<BetaMessage, 'content'> & {
        content: BetaContentBlock[]
    }
    requestId?: string
    apiError?: {
        status: number
        code?: string
        message: string
    }
    error?: SDKAssistantMessageError
    errorDetails?: string
    isApiErrorMessage?: boolean
    isVirtual?: true
    advisorModel?: string
    isMeta?: boolean // log: fix TS2339
    research?: unknown // log: fix TS2339
}

// ============================================================================
// Attachment message
// ============================================================================

export type AttachmentMessage<T = Record<string, unknown> & { type: string }> = {
    type: 'attachment'
    attachment: T
    uuid: UUID
    timestamp: string
}

// ============================================================================
// Hook result message — alias for attachment messages from hooks
// ============================================================================

export type HookResultMessage = AttachmentMessage

// ============================================================================
// Progress message
// ============================================================================

export type ProgressMessage<P = Record<string, unknown>> = {
    type: 'progress'
    data: P
    toolUseID: string
    parentToolUseID: string
    uuid: UUID
    timestamp: string
}

// ============================================================================
// Tombstone message
// ============================================================================

export type TombstoneMessage = {
    type: 'tombstone'
    message: Message
}

// ============================================================================
// Tool use summary message
// ============================================================================

export type ToolUseSummaryMessage = {
    type: 'tool_use_summary'
    summary: string
    precedingToolUseIds: string[]
    uuid: UUID
    timestamp: string
}

// ============================================================================
// Stream event types
// ============================================================================

export type StreamEvent = {
    type: 'stream_event'
    event: BetaRawMessageStreamEvent
    ttftMs?: number
    session_id?: string
    parent_tool_use_id?: string | null
    uuid?: UUID
}

export type RequestStartEvent = {
    type: 'stream_request_start'
}

// ============================================================================
// System message subtypes
// ============================================================================

export type SystemInformationalMessage = {
    type: 'system'
    subtype: 'informational'
    content: string
    isMeta: false
    timestamp: string
    uuid: UUID
    toolUseID?: string
    level: SystemMessageLevel
    preventContinuation?: boolean
}

export type SystemPermissionRetryMessage = {
    type: 'system'
    subtype: 'permission_retry'
    content: string
    commands: string[]
    level: SystemMessageLevel
    isMeta: boolean
    timestamp: string
    uuid: UUID
}

export type SystemBridgeStatusMessage = {
    type: 'system'
    subtype: 'bridge_status'
    content: string
    url: string
    upgradeNudge?: string
    isMeta: boolean
    timestamp: string
    uuid: UUID
}

export type SystemScheduledTaskFireMessage = {
    type: 'system'
    subtype: 'scheduled_task_fire'
    content: string
    isMeta: boolean
    timestamp: string
    uuid: UUID
}

export type SystemStopHookSummaryMessage = {
    type: 'system'
    subtype: 'stop_hook_summary'
    hookCount: number
    hookInfos: StopHookInfo[]
    hookErrors: string[]
    preventedContinuation: boolean
    stopReason: string | undefined
    hasOutput: boolean
    level: SystemMessageLevel
    timestamp: string
    uuid: UUID
    toolUseID?: string
    hookLabel?: string
    totalDurationMs?: number
}

export type SystemTurnDurationMessage = {
    type: 'system'
    subtype: 'turn_duration'
    durationMs: number
    budgetTokens?: number
    budgetLimit?: number
    budgetNudges?: number
    messageCount?: number
    timestamp: string
    uuid: UUID
    isMeta: boolean
}

export type SystemAwaySummaryMessage = {
    type: 'system'
    subtype: 'away_summary'
    content: string
    timestamp: string
    uuid: UUID
    isMeta: boolean
}

export type SystemMemorySavedMessage = {
    type: 'system'
    subtype: 'memory_saved'
    writtenPaths: string[]
    timestamp: string
    uuid: UUID
    isMeta: boolean
}

export type SystemAgentsKilledMessage = {
    type: 'system'
    subtype: 'agents_killed'
    timestamp: string
    uuid: UUID
    isMeta: boolean
}

export type SystemApiMetricsMessage = {
    type: 'system'
    subtype: 'api_metrics'
    ttftMs: number
    otps: number
    isP50?: boolean
    hookDurationMs?: number
    turnDurationMs?: number
    toolDurationMs?: number
    classifierDurationMs?: number
    toolCount?: number
    hookCount?: number
    classifierCount?: number
    configWriteCount?: number
    timestamp: string
    uuid: UUID
    isMeta: boolean
}

export type SystemLocalCommandMessage = {
    type: 'system'
    subtype: 'local_command'
    content: string
    level: SystemMessageLevel
    timestamp: string
    uuid: UUID
    isMeta: boolean
}

export type SystemCompactBoundaryMessage = {
    type: 'system'
    subtype: 'compact_boundary'
    content: string
    isMeta: boolean
    timestamp: string
    uuid: UUID
    level: SystemMessageLevel
    compactMetadata: CompactMetadata
    logicalParentUuid?: UUID
}

export type SystemMicrocompactBoundaryMessage = {
    type: 'system'
    subtype: 'microcompact_boundary'
    content: string
    isMeta: boolean
    timestamp: string
    uuid: UUID
    level: SystemMessageLevel
    microcompactMetadata: MicrocompactMetadata
}

export type SystemAPIErrorMessage = {
    type: 'system'
    subtype: 'api_error'
    level: 'error'
    cause?: Error
    error: APIError
    retryInMs: number
    retryAttempt: number
    maxRetries: number
    timestamp: string
    uuid: UUID
}

export type SystemThinkingMessage = {
    type: 'system'
    subtype: 'thinking'
    content?: string
    timestamp: string
    uuid: UUID
    isMeta?: boolean
}

export type SystemFileSnapshotMessage = {
    type: 'system'
    subtype: 'file_snapshot'
    content: string
    level: SystemMessageLevel
    isMeta: boolean
    timestamp: string
    uuid: UUID
    snapshotFiles: Array<{
        key: string
        path: string
        content: string
    }>
}

// ============================================================================
// System message union
// ============================================================================

export type SystemMessage =
    | SystemInformationalMessage
    | SystemPermissionRetryMessage
    | SystemBridgeStatusMessage
    | SystemScheduledTaskFireMessage
    | SystemStopHookSummaryMessage
    | SystemTurnDurationMessage
    | SystemAwaySummaryMessage
    | SystemMemorySavedMessage
    | SystemAgentsKilledMessage
    | SystemApiMetricsMessage
    | SystemLocalCommandMessage
    | SystemCompactBoundaryMessage
    | SystemMicrocompactBoundaryMessage
    | SystemAPIErrorMessage
    | SystemThinkingMessage
    | SystemFileSnapshotMessage

// ============================================================================
// Message discriminated union
// ============================================================================

export type Message =
    | UserMessage
    | AssistantMessage
    | AttachmentMessage
    | ProgressMessage
    | SystemMessage

// ============================================================================
// Normalized messages (content is always an array)
// ============================================================================

export type NormalizedUserMessage = Omit<UserMessage, 'message'> & {
    message: {
        role: 'user'
        content: ContentBlockParam[]
    }
    sourceToolUseID?: string // log: fix TS2339
}

export type NormalizedAssistantMessage<T = BetaContentBlock> = Omit<AssistantMessage, 'message'> & {
    message: Omit<BetaMessage, 'content'> & {
        content: [T, ...BetaContentBlock[]]
    }
}

export type NormalizedMessage =
    | NormalizedUserMessage
    | NormalizedAssistantMessage
    | AttachmentMessage
    | ProgressMessage
    | SystemMessage

// ============================================================================
// Message without progress (for grouping)
// ============================================================================

export type MessageWithoutProgress = Exclude<NormalizedMessage, ProgressMessage>

// ============================================================================
// Collapsed read/search group
// ============================================================================

export type CollapsibleMessage =
    | NormalizedAssistantMessage<BetaToolUseBlock>
    | GroupedToolUseMessage

export type CollapsedReadSearchGroup = {
    type: 'collapsed_read_search'
    searchCount: number
    readCount: number
    listCount: number
    replCount: number
    memorySearchCount: number
    memoryReadCount: number
    memoryWriteCount: number
    readFilePaths: string[]
    searchArgs: unknown[] // log: fix TS2339
    latestDisplayHint: string
    messages: CollapsibleMessage[]
    displayMessage: CollapsibleMessage
    uuid: UUID
    timestamp: string
    teamMemorySearchCount?: number
    teamMemoryReadCount?: number
    teamMemoryWriteCount?: number
    mcpCallCount?: number
    mcpServerNames?: string[]
    bashCount?: number
    gitOpBashCount?: number
    commits?: Array<{ kind: string; sha: string }> // log: fix TS2339
    pushes?: Array<{ branch: string }> // log: fix TS2339
    hookInfos?: Array<{ command: string; durationMs?: number }>
    hookCount?: number
    hookTotalMs?: number
    relevantMemories?: Array<{ path: string; content?: string }>
    preCompactDiscoveredTools?: unknown
    branches?: Array<{ action: string; ref: string }> // log: fix TS2339
    prs?: Array<{ action: string; number: number; url?: string }> // log: fix TS2339
}

// ============================================================================
// Grouped tool use message
// ============================================================================

export type GroupedToolUseMessage = {
    type: 'grouped_tool_use'
    toolName: string
    messages: NormalizedAssistantMessage<BetaToolUseBlock>[]
    results: NormalizedUserMessage[]
    displayMessage: NormalizedAssistantMessage<BetaToolUseBlock>
    uuid: string
    timestamp: string
    messageId: string
}

// ============================================================================
// Renderable message — what the UI actually renders
// ============================================================================

export type RenderableMessage = MessageWithoutProgress | CollapsedReadSearchGroup | GroupedToolUseMessage
