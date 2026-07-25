/**
 * Query loop transition types.
 *
 * Terminal — final return value of the query generator (loop-exit reasons).
 * Continue — signal that the query loop should re-iterate (transition reasons).
 */

export type Terminal =
    | { reason: 'completed' }
    | { reason: 'blocking_limit' }
    | { reason: 'mlx_memory_limit' }
    | { reason: 'image_error' }
    | { reason: 'model_error'; error: unknown }
    | { reason: 'aborted_streaming' }
    | { reason: 'aborted_tools' }
    | { reason: 'hook_stopped' }
    | { reason: 'prompt_too_long' }
    | { reason: 'stop_hook_prevented' }
    | { reason: 'max_turns' }

export type Continue =
    | { reason: 'next_turn' }
    | { reason: 'collapse_drain_retry' }
    | { reason: 'reactive_compact_retry' }
    | { reason: 'max_output_tokens_escalate' }
    | { reason: 'max_output_tokens_recovery' }
    | { reason: 'stop_hook_blocking' }
    | { reason: 'token_budget_continuation' }
