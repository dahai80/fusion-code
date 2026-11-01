// Shared types between the web backend (server/) and the SPA (src/).
// Keep this file dependency-free so both tsconfigs can include it.

export type RepoRecord = {
    id: string;
    name: string;
    path: string;
    originUrl?: string;
    environment: string;
    createdAt: number;
};

export type PermissionMode = 'allowlist' | 'ask';

export type SessionPermissions = {
    mode: PermissionMode;
    allowedTools: string[];
};

export type SessionStatus = 'idle' | 'running' | 'error';

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

export type HistoryMessage =
    | { role: 'user'; text: string }
    | { role: 'assistant'; text: string; toolNames: string[] };

export type ApiError = { error: string };

// Distributive omit — Omit<Union, K> collapses to common keys otherwise.
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type SessionEventBody = DistributiveOmit<SessionEvent, 'seq'>;
