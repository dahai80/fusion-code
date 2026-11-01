import type {
    Checkpoint,
    FileChange,
    HistoryMessage,
    PermissionMode,
    RepoRecord,
    SessionEvent,
    SessionPermissions,
    UsageSummary,
    WebSession,
} from '../shared/types';

// Same-origin REST client. Behind the gateway the module is served at
// /shell/fusion-code/ and the proxy keeps /api + /health same-origin; in
// dev, Vite proxies them to the backend. Absolute '/api' paths work in both.

export type SessionDetail = {
    session: WebSession;
    running: boolean;
    events: SessionEvent[];
    history: HistoryMessage[];
    changes: FileChange[];
};

export type Branch = { name: string; current: boolean };

async function get<T>(path: string): Promise<T> {
    const res = await fetch(path, { headers: { accept: 'application/json' } });
    if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
}

async function del<T>(path: string): Promise<T> {
    const res = await fetch(path, { method: 'DELETE' });
    if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
}

export const api = {
    listRepos: () => get<{ repos: RepoRecord[] }>('/api/repos'),
    connectRepo: (input: { name?: string; path?: string; gitUrl?: string; environment?: string }) =>
        post<{ repo: RepoRecord }>('/api/repos', input),
    getRepo: (id: string) => get<{ repo: RepoRecord; branches: Branch[]; current: string }>(`/api/repos/${id}`),
    repoBranches: (id: string) => get<{ branches: Branch[]; current: string }>(`/api/repos/${id}/branches`),
    repoChanges: (id: string) => get<{ files: FileChange[] }>(`/api/repos/${id}/changes`),
    removeRepo: (id: string) => del<{ ok: boolean }>(`/api/repos/${id}`),
    updateRepo: (id: string, patchInput: { name?: string; testCommand?: string; environment?: string }) =>
        patch<{ repo: RepoRecord }>(`/api/repos/${id}`, patchInput),

    listSessions: () => get<{ sessions: WebSession[] }>('/api/sessions'),
    createSession: (input: { title: string; repoId: string; branch: string; environment?: string }) =>
        post<{ session: WebSession }>('/api/sessions', input),
    getSession: (id: string) => get<SessionDetail>(`/api/sessions/${id}`),
    setPermissions: (id: string, mode: PermissionMode, allowedTools: string[]) =>
        post<{ permissions: SessionPermissions }>(`/api/sessions/${id}/permissions`, { mode, allowedTools }),
    startRun: (id: string, message: string) => post<{ ok: boolean }>(`/api/sessions/${id}/run`, { message }),

    // #229: diff viewer + checkpoint verify/rollback + PR flow.
    fileDiff: (id: string, filePath: string) =>
        get<{ path: string; diff: string }>(`/api/sessions/${id}/diff?path=${encodeURIComponent(filePath)}`),
    verifyCheckpoint: (id: string, messageUuid: string) =>
        post<{ ok: boolean; output: string; checkpoint: Checkpoint }>(
            `/api/sessions/${id}/checkpoints/${encodeURIComponent(messageUuid)}/verify`
        ),
    rollbackCheckpoint: (id: string, messageUuid: string) =>
        post<{ ok: boolean }>(`/api/sessions/${id}/checkpoints/${encodeURIComponent(messageUuid)}/rollback`),
    createPr: (id: string, input: { title: string; body?: string }) =>
        post<{ ok: boolean; url: string; branch: string }>(`/api/sessions/${id}/pr`, input),

    // #230: usage view.
    usage: () => get<UsageSummary>('/api/usage'),
};

// Session WS: live event stream with automatic reconnect + backlog replay.
export function connectSessionWs(
    sessionId: string,
    onEvent: (event: SessionEvent) => void,
    onStatus?: (running: boolean) => void
): () => void {
    let ws: WebSocket | null = null;
    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let seenSeq = 0;

    const connect = () => {
        if (closed) return;
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${proto}//${location.host}/ws/${sessionId}`);
        ws.onmessage = (raw) => {
            try {
                const msg = JSON.parse(String(raw.data)) as {
                    type: string;
                    event?: SessionEvent;
                    running?: boolean;
                    error?: string;
                };
                if (msg.type === 'event' && msg.event) {
                    if (msg.event.seq > seenSeq) {
                        seenSeq = msg.event.seq;
                        onEvent(msg.event);
                    }
                } else if (msg.type === 'hello') {
                    onStatus?.(msg.running === true);
                } else if (msg.type === 'pong') {
                    onStatus?.(msg.running === true);
                } else if (msg.type === 'error') {
                    console.error('[fusion-code-web] ws error:', msg.error);
                }
            } catch (err) {
                console.error('[fusion-code-web] ws parse failed:', err);
            }
        };
        ws.onclose = () => {
            if (!closed) {
                retryTimer = setTimeout(connect, 2000);
            }
        };
        ws.onerror = () => {
            console.warn('[fusion-code-web] ws error, reconnecting');
        };
    };
    connect();

    return () => {
        closed = true;
        if (retryTimer) clearTimeout(retryTimer);
        ws?.close();
    };
}

export function wsSend(sessionId: string, message: string): void {
    // Lazy: message() reaches the server through the REST run endpoint so a
    // send never races a reconnecting socket.
    void api.startRun(sessionId, message).catch((err) => {
        console.error('[fusion-code-web] send failed:', err);
    });
}
