# Pre-Landing Review: feat/div-anthropic (PR #66)

- Branch: feat/div-anthropic → main
- Diff: ~2759 lines, 34 files
- Intent: remove @anthropic-ai/sdk runtime coupling via provider-neutral LLM adapter seam + duck-typing error bridge, gated by LLM_ADAPTER_SEAM (default off, in dev-full)
- Reviewer: gstack /review --fix

## Critical Pass

### Enum & Value Completeness + LLM Output Trust Boundary — SSE error event silently dropped
- adapter.ts:265 (pre-fix): `case "error":` fell through to `return null`, swallowing mid-stream API error events.
- SDK reference: core/streaming.js:62 throws `APIError` on `sse.event === 'error'`.
- Impact: a mid-stream overloaded/error event produced no chunk and no throw → stream ended without finish → chunkToPart fabricated `end_turn` → silently-truncated response masked as success. withRetry never saw the error for retry.
- FIX APPLIED: adapter.ts `case "error"` now throws `Error` (name="APIError", .status passthrough); JSON.parse catch special-cases `error` to throw raw data too. Tests added (3).
- Confidence: HIGH (verified against SDK source).

### Informational — fabricated stop_reason masks truncation
- chunkToPart.ts:123 (pre-fix): `delta.stop_reason: chunk.stopReason ?? state.stopReason ?? "end_turn"` defaulted to end_turn when no stop_reason received.
- Impact: defeated claude.ts:2368 `!stopReason` empty-response detection on abnormal stream end.
- FIX APPLIED: default changed to `null` (passthrough only).
- Confidence: HIGH.

## Other categories
- SQL & Data Safety: N/A (no DB).
- Race Conditions: clean — SseState/SdkState fresh per-call (seam.ts:79, chunkToPart.ts:139); abort signal wired to both postMessages and parseSseStream (seam.ts:71,81); reader.releaseLock in finally.
- Shell Injection: N/A.
- LLM Trust Boundary (structured output): chunkToSdkPart passthrough shape; claude.ts switch unchanged → no new trust surface beyond the error-event fix above.

## Verification after fixes
- typecheck: 0 errors
- unit tests: 116 pass / 0 fail
- integration: 319 pass / 1 flaky timeout (offline-mode, unrelated, passes isolated 26ms)
- build dev-full: green
- llm/ tests: 78 pass / 0 fail (3 new error-event tests)

## Notes
- isAbortError rewrite (utils/errors.ts): name/message matching instead of instanceof. Verified SDK APIUserAbortError always uses default message "Request was aborted." → fallback correct today; medium-confidence fragility (SDK wording change would break), acceptable given seam path now emits name="AbortError".
- rateLimitMocking MockAPIError: correct duck-typed replacement, name="APIError" recognized by isApiErrorLike.
