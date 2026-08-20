// SDK Core Types - Common serializable types used by both SDK consumers and SDK builders.
//
// Types are generated from Zod schemas in coreSchemas.ts.
// To modify types:
// 1. Edit Zod schemas in coreSchemas.ts
// 2. Run: bun scripts/generate-sdk-types.ts
//
// Schemas are available in coreSchemas.ts for runtime validation but are not
// part of the public API.

// Re-export sandbox types for SDK consumers
export type {
	SandboxFilesystemConfig,
	SandboxIgnoreViolations,
	SandboxNetworkConfig,
	SandboxSettings,
} from "../sandboxTypes.js";
// Re-export all generated types
// log: export * doesn't propagate through src/* path alias, must list explicitly
// NOTE: generated exports are type-only (export type); use `export type` so the
// re-export stays type-only and doesn't trigger runtime "export not found" in dev.
export type {
	AsyncHookJSONOutput,
	ExitReason,
	HookEvent,
	HookInput,
	HookJSONOutput,
	ModelUsage,
	PermissionMode,
	PermissionResult,
	SDKAssistantMessage,
	SDKAssistantMessageError,
	SDKBaseMessage,
	SDKCompactBoundaryMessage,
	SDKCompactMetadata,
	SDKMessage,
	SDKPartialAssistantMessage,
	SDKPermissionDenial,
	SDKRateLimitInfo,
	SDKResultMessage,
	SDKSessionInfo,
	SDKStatus,
	SDKStatusMessage,
	SDKSystemMessage,
	SDKToolProgressMessage,
	SDKUserMessage,
	SDKUserMessageReplay,
	SyncHookJSONOutput,
} from "./coreTypes.generated.js";

// Re-export utility types that can't be expressed as Zod schemas
export type { NonNullableUsage } from "./sdkUtilityTypes.js";

// Const arrays for runtime usage
export const HOOK_EVENTS = [
	"PreToolUse",
	"PostToolUse",
	"PostToolUseFailure",
	"Notification",
	"UserPromptSubmit",
	"SessionStart",
	"SessionEnd",
	"Stop",
	"StopFailure",
	"SubagentStart",
	"SubagentStop",
	"PreCompact",
	"PostCompact",
	"PermissionRequest",
	"PermissionDenied",
	"Setup",
	"TeammateIdle",
	"TaskCreated",
	"TaskCompleted",
	"Elicitation",
	"ElicitationResult",
	"ConfigChange",
	"WorktreeCreate",
	"WorktreeRemove",
	"InstructionsLoaded",
	"CwdChanged",
	"FileChanged",
	"DirectoryAdded",
] as const;

export const EXIT_REASONS = [
	"clear",
	"resume",
	"logout",
	"prompt_input_exit",
	"other",
	"bypass_permissions_disabled",
] as const;
