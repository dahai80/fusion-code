// Shared types between the web backend (server/) and the SPA (src/).
// Keep this file dependency-free so both tsconfigs can include it.

export type RepoRecord = {
    id: string;
    name: string;
    path: string;
    originUrl?: string;
    environment: string;
    createdAt: number;
    // Command run by checkpoint [verify] in this repo (e.g. "bun test").
    // Empty = verify disabled until configured.
    testCommand?: string;
    // v2 environment templates: setup command executed on demand in the repo
    // worktree (dependency install etc.). Empty = setup not configured.
    setupCommand?: string;
    // Result of the last on-demand setup run.
    lastSetup?: { ok: boolean; at: number; output: string };
};

export type PermissionMode = 'allowlist' | 'ask';

export type SessionPermissions = {
    mode: PermissionMode;
    allowedTools: string[];
};

export type SessionStatus = 'idle' | 'running' | 'error';

// Checkpoint = a kernel user-message snapshot (#229). The kernel snapshots
// the worktree at every user prompt (file-history); messageUuid addresses
// the snapshot for --rewind-files rollback.
export type Checkpoint = {
    messageUuid: string;
    label: string;
    createdAt: number;
    verified?: { ok: boolean; at: number; output?: string };
};

export type TurnUsage = {
    at: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    durationMs: number;
    model?: string;
};

// #231: design handoff from fusion-design (sync-to-code file-IPC). The web
// server ingests the notification, snapshots the design files and attaches
// them to a new session; the first run consumes them as prompt context.
export type DesignFile = {
    path: string;
    name: string;
    language: string;
    content: string;
    truncated: boolean;
};

export type DesignContext = {
    component: string;
    source: string;
    ingestedAt: number;
    files: DesignFile[];
};

export type WebSession = {
    // Web session id (uuid, stable for the session's life — URLs use it).
    // kernelSessionId links to the kernel transcript once the first run
    // reports it (used for --resume continuity and history display).
    id: string;
    title: string;
    repoId: string;
    branch: string;
    environment: string;
    status: SessionStatus;
    createdAt: number;
    updatedAt: number;
    kernelSessionId?: string;
    lastResultIsError?: boolean;
    errorText?: string;
    checkpoints?: Checkpoint[];
    usage?: TurnUsage[];
    prUrl?: string;
    prBranch?: string;
    designContext?: DesignContext;
    // True until the first run consumes the design context as prompt input.
    designPending?: boolean;
    // #237 GUI parity: run the kernel in an isolated git worktree instead of
    // the repo worktree directly. worktreePath is the created worktree
    // (dataDir/worktrees/<sessionId>), resolved lazily on the first run.
    isolateWorktree?: boolean;
    worktreePath?: string;
    // #240: explicit per-session model pick; undefined = the session follows
    // the model policy chain (module override > platform preference >
    // manifest suggested_model > kernel FUSION_MODEL env) at run time.
    modelOverride?: string;
};

// #237 GUI parity: inline diff comment anchored to a line of the per-file
// diff text (1-based index within the unified diff the viewer renders).
export type DiffComment = {
    id: string;
    path: string;
    line: number;
    text: string;
    at: number;
};

// #240: model capability surface (GET /api/models) — what the session
// composer shows as the effective default and the constraint envelope for
// per-session overrides.
export type ModelInfo = {
    modelCapable: boolean;
    suggestedModel?: string;
    defaultModel?: string;
    defaultSource?: 'session' | 'module' | 'platform' | 'manifest' | 'env';
    privacyMode?: 'standard' | 'local_only';
    allowlist?: string[];
};

// Stream events relayed over the session WS. `kind` mirrors the kernel
// stream-json shapes we care about; payloads are trimmed to display needs.
export type SessionEvent =
    | { seq: number; kind: 'turn_started'; text: string }
    | { seq: number; kind: 'assistant_text'; text: string }
    | { seq: number; kind: 'tool_use'; toolName: string; input: string }
    | { seq: number; kind: 'tool_result'; toolName: string; content: string; isError: boolean }
    | { seq: number; kind: 'turn_completed'; is_error: boolean; duration_ms: number; num_turns: number }
    | { seq: number; kind: 'turn_error'; text: string }
    | { seq: number; kind: 'file_changes'; files: FileChange[] };

export type FileChange = {
    path: string;
    status: 'M' | 'A' | 'D' | 'R' | 'U' | '?';
    additions: number;
    deletions: number;
};

export type HistoryMessage = { role: 'user'; text: string } | { role: 'assistant'; text: string; toolNames: string[] };

export type ApiError = { error: string };

export type UsageRepoRow = {
    repoId: string;
    repoName: string;
    sessions: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
};

export type UsageSessionRow = {
    sessionId: string;
    title: string;
    repoName: string;
    turns: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    updatedAt: number;
};

export type UsageSummary = {
    totalCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTurns: number;
    byRepo: UsageRepoRow[];
    bySession: UsageSessionRow[];
};

// Distributive omit — Omit<Union, K> collapses to common keys otherwise.
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type SessionEventBody = DistributiveOmit<SessionEvent, 'seq'>;
