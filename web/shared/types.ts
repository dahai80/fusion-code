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
