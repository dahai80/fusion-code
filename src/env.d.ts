// Local type stubs for exports stripped from the Anthropic SDK fork.
// These are type-only declarations; no runtime code is generated.

// Missing export from src/utils/betas.js
declare module '../../utils/betas.js' {
    export function getBedrockExtraBodyParamsBetas(): string[]
}

// Missing hook input type exports from src/entrypoints/agentSdkTypes.js
// These are event-specific shapes of the generic HookInput type.
declare module 'src/entrypoints/agentSdkTypes.js' {
    import type { HookInput } from './sdk/coreTypes.generated.js'

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
}
