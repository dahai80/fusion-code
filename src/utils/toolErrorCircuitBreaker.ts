import { logForDebugging } from "./debug.js";
import type { ToolResultBlockParam } from "../types/anthropic-protocol.js";

// #227: one-shot agent tasks (typically small local models) can enter an
// unbounded retry loop on failed tool calls — same bad path or unknown tool
// re-issued every turn, each iteration a full-context LLM request. This
// breaker counts consecutive tool calls that fail with an identical error
// signature and aborts the loop once the count reaches the threshold.

export const TOOL_ERROR_LOOP_ENV = "FUSION_CODE_MAX_CONSECUTIVE_TOOL_ERRORS";
export const DEFAULT_NONINTERACTIVE_THRESHOLD = 5;

export type ToolErrorLoopState = {
    signature: string;
    toolName: string;
    errorText: string;
    count: number;
};

type ToolUseRef = {
    id: string;
    name: string;
};

type ToolResultCarrier = {
    type: string;
    message?: {
        content?: unknown;
    };
};

// Threshold for consecutive identical tool errors before the loop aborts.
// Non-interactive (one-shot -p / SDK) defaults to 5; interactive REPL keeps
// the human in control and defaults to 0 (disabled). Explicit env wins in
// both modes; 0 or negative disables.
export function getToolErrorLoopThreshold(
    isNonInteractiveSession: boolean,
): number {
    const raw = process.env[TOOL_ERROR_LOOP_ENV];
    if (raw !== undefined && raw !== "") {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) {
            return Math.floor(parsed);
        }
        logForDebugging(
            `[circuit-breaker] invalid ${TOOL_ERROR_LOOP_ENV}=${raw}, falling back to default`,
            { level: "warn" },
        );
    }
    return isNonInteractiveSession
        ? DEFAULT_NONINTERACTIVE_THRESHOLD
        : 0;
}

// Error identity: tool name plus normalized error text. Whitespace is
// collapsed so re-wrapped messages still match; volatile tails beyond 400
// chars are ignored so timestamps in long outputs don't defeat the breaker.
export function toolErrorSignature(
    toolName: string,
    errorText: string,
): string {
    const collapsed = errorText.replace(/\s+/g, " ").trim();
    return `${toolName}::${collapsed.slice(0, 400)}`;
}

function extractResultText(block: ToolResultBlockParam): string {
    if (typeof block.content === "string") {
        return block.content;
    }
    if (Array.isArray(block.content)) {
        return block.content
            .map((part) =>
                part && typeof part === "object" && "text" in part
                    ? String(part.text)
                    : "",
            )
            .join(" ")
            .trim();
    }
    return "";
}

// Fold one batch of tool results into the running breaker state.
// - any successful (non-is_error) result resets the streak — forward progress
// - an error with a new signature starts a new streak at 1
// - an error with the same signature increments the streak
// Returns null when no streak is active.
export function updateToolErrorLoopState(
    prev: ToolErrorLoopState | null,
    toolUseBlocks: ToolUseRef[],
    toolResults: ToolResultCarrier[],
): ToolErrorLoopState | null {
    if (toolUseBlocks.length === 0) {
        return prev;
    }
    const nameById = new Map(toolUseBlocks.map((b) => [b.id, b.name]));
    let state: ToolErrorLoopState | null = prev;
    for (const result of toolResults) {
        if (result.type !== "user" || !Array.isArray(result.message?.content)) {
            continue;
        }
        for (const block of result.message.content) {
            if (
                !block ||
                typeof block !== "object" ||
                (block as { type?: string }).type !== "tool_result"
            ) {
                continue;
            }
            const toolResult = block as ToolResultBlockParam;
            const toolName =
                nameById.get(toolResult.tool_use_id) ?? "unknown";
            if (!toolResult.is_error) {
                if (state) {
                    logForDebugging(
                        `[circuit-breaker] streak reset by successful ${toolName} call`,
                    );
                }
                state = null;
                continue;
            }
            const errorText = extractResultText(toolResult);
            const signature = toolErrorSignature(toolName, errorText);
            if (state && state.signature === signature) {
                state = {
                    ...state,
                    count: state.count + 1,
                };
            } else {
                state = {
                    signature,
                    toolName,
                    errorText: errorText.slice(0, 200),
                    count: 1,
                };
            }
        }
    }
    return state;
}

export function shouldTripToolErrorLoop(
    state: ToolErrorLoopState | null,
    threshold: number,
): boolean {
    return state !== null && threshold > 0 && state.count >= threshold;
}
