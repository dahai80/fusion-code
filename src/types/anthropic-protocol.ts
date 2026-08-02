/**
 * Anthropic Messages API 协议类型（本地定义）
 *
 * 从 @anthropic-ai/sdk 中抽取的纯类型定义，用于解耦类型依赖。
 * 运行时依赖（Anthropic 客户端类、Error 子类）仍直接从 SDK 导入。
 *
 * 分类：
 *   1. Message Block 类型 — 请求/响应中的内容块参数
 *   2. Beta Message 类型 — Beta API 的扩展类型
 *   3. 工具相关类型 — 工具定义、工具结果
 *   4. 通用类型 — Usage、MessageParam 等
 *   5. 客户端类型 — Anthropic、ClientOptions
 *   6. 流式类型 — Stream、BetaMessageStreamParams
 *   7. Error 类型 — APIError (type-only)
 */

// ─── 从 SDK re-export 类型 ──────────────────────────────────
// 逐步替换：先将所有 import type 指向此文件，后续可脱离 SDK 自行定义

// 1. Message Block 类型（请求参数）
export type {
    ContentBlockParam,
    TextBlockParam,
    ImageBlockParam,
    ThinkingBlockParam,
    RedactedThinkingBlockParam,
    ToolResultBlockParam,
    ToolUseBlockParam,
    Base64ImageSource,
} from "@anthropic-ai/sdk/resources/index.mjs";

// 2. Message Block 类型（响应）
export type {
    ContentBlock,
    TextBlock,
    ThinkingBlock,
    RedactedThinkingBlock,
    ToolUseBlock,
} from "@anthropic-ai/sdk/resources/index.mjs";

// 3. Beta Message 类型
export type {
    BetaContentBlock,
    BetaContentBlockParam,
    BetaImageBlockParam,
    BetaThinkingBlock,
    BetaRedactedThinkingBlock,
    BetaRedactedThinkingBlockParam,
    BetaRequestDocumentBlock,
    BetaToolUseBlock,
    BetaTool,
    BetaToolUnion,
    BetaToolResultBlockParam,
    BetaToolChoiceAuto,
    BetaToolChoiceTool,
    BetaWebSearchTool20250305,
    BetaUsage,
    BetaMessageDeltaUsage,
    BetaJSONOutputFormat,
    BetaOutputConfig,
    BetaRawMessageStreamEvent,
    BetaMessageParam,
    BetaMessageStreamParams,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.mjs";

// 4. 通用类型
export type {
    MessageParam,
} from "@anthropic-ai/sdk/resources/index.mjs";

// 5. Anthropic 客户端类型（仅类型，运行时实例化仍用 SDK）
// default export → `import type Anthropic from ...`
export type { default as AnthropicDefault } from "@anthropic-ai/sdk";
// named export → `import type { Anthropic } from ...`
export type { Anthropic } from "@anthropic-ai/sdk";
export type { ClientOptions } from "@anthropic-ai/sdk";

// 6. Beta Message 响应类型
export type {
    BetaMessage,
    BetaStopReason,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.mjs";

// 7. 流式类型
export type { Stream } from "@anthropic-ai/sdk/core/streaming.mjs";

// 8. Error 类型（type-only — 运行时仍需从 SDK import）
export type { APIError } from "@anthropic-ai/sdk";
