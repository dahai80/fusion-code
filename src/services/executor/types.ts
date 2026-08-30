// fusion-executor Layer B wire models — TS mirror of fe-core Rust structs.
// Field names snake_case to match serde wire (executor serializes Rust field
// names verbatim). Exit codes: 0=ok, -124=timeout, -1=blocked/internal.
// Source of truth: fusion-executor/crates/fe-core/src/lib.rs (read-only, cross-repo).

export type RollbackPolicy = {
	max_consecutive_failures: number;
	file_damage_check: boolean;
};

export type ExecutionRequest = {
	command: string;
	task_id?: string;
	cwd?: string;
	timeout_sec: number;
	env_vars?: Record<string, string>;
	enable_rollback_snapshot: boolean;
	auto_rollback_policy?: RollbackPolicy;
	seatbelt?: boolean;
};

export type Diagnostics = {
	error_type?: string;
	file_path?: string;
	line_number?: number;
	code_snippet?: string;
	raw_trace?: string;
};

export type ExecutionResult = {
	exit_code: number;
	stdout: string;
	stderr: string;
	task_id?: string;
	command?: string;
	duration_sec: number;
	timed_out: boolean;
	blocked_by_security: boolean;
	security_reason?: string;
	snapshot_id?: string;
	diagnostics?: Diagnostics;
	auto_rolled_back: boolean;
};

// executor.snapshot_create / executor.rollback wire (Phase 3b turn-boundary).
// Source: fusion-executor/crates/fe-ipc/src/lib.rs:1417/1445 (read-only, cross-repo).
// snapshot_create params {cwd} → {snapshot_id}; rollback params {snapshot_id, cwd}
// → {ok: true} (executor returns -32012 + throws on failure, caller treats throw).
export type SnapshotResult = { snapshot_id: string };
export type RollbackResult = { ok: boolean };

// executor.execute_stream frame `result` payload — multiple frames per request,
// all sharing the request id. chunk = live stdio slice; done = terminal result.
export type ExecutorStreamChunk =
	| { type: "chunk"; data: string }
	| { type: "done"; result: ExecutionResult };

// Wire type for executor file-tool responses (file_edit/write_file/multi_edit/
// apply_patch). Source of truth: fusion-executor crates/fe-tools/src/lib.rs:54
// `EditResult{ok:bool, path:Option<String>, error:Option<String>, matches:u32}`.
// File-tool writes carry NO executor Diagnostics (unlike bash execute) —
// EditResult.error is the failure signal; ok:true is the success signal.
export type EditResult = {
	ok: boolean;
	path?: string;
	error?: string;
	matches?: number;
};

// Exit code constants mirror fe-core EXIT_OK/EXIT_TIMEOUT/EXIT_BLOCKED.
export const EXECUTOR_EXIT_OK = 0;
export const EXECUTOR_EXIT_TIMEOUT = -124;
export const EXECUTOR_EXIT_BLOCKED = -1;
