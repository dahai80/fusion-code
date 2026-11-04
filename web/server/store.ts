import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
    Checkpoint,
    DiffComment,
    PermissionMode,
    RepoRecord,
    SessionPermissions,
    TurnUsage,
    WebSession,
} from '../shared/types';
import { dataDir, log, logWarn } from './config';

// JSON-file persistence for repos / sessions / permissions. Small datasets
// (tens of records), single process — atomic-enough write via tmp+rename is
// overkill for v1; the CLI's own session files remain the durable record.

type StoreShape = {
    repos: RepoRecord[];
    sessions: WebSession[];
    permissions: Record<string, SessionPermissions>;
    // Global default for NEW sessions (settings page). Absent = hardcoded
    // read-only default below.
    defaultPermissions?: SessionPermissions;
    // #237: inline diff comments keyed by session id.
    comments?: Record<string, DiffComment[]>;
};

function storePath(): string {
    return join(dataDir(), 'store.json');
}

function emptyStore(): StoreShape {
    return { repos: [], sessions: [], permissions: {} };
}

function loadStore(): StoreShape {
    try {
        const raw = JSON.parse(readFileSync(storePath(), 'utf-8'));
        return {
            repos: Array.isArray(raw.repos) ? raw.repos : [],
            sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
            permissions: raw.permissions && typeof raw.permissions === 'object' ? raw.permissions : {},
            comments: raw.comments && typeof raw.comments === 'object' ? raw.comments : {},
        };
    } catch {
        return emptyStore();
    }
}

function saveStore(store: StoreShape): void {
    try {
        mkdirSync(dataDir(), { recursive: true });
        writeFileSync(storePath(), JSON.stringify(store, null, 4));
    } catch (err) {
        logWarn(`store write failed: ${err}`);
    }
}

let store: StoreShape | null = null;

function s(): StoreShape {
    if (!store) {
        store = loadStore();
        log(`store loaded: ${store.repos.length} repos, ${store.sessions.length} sessions`);
    }
    return store;
}

export function listRepos(): RepoRecord[] {
    return [...s().repos].sort((a, b) => b.createdAt - a.createdAt);
}

export function getRepo(id: string): RepoRecord | undefined {
    return s().repos.find((r) => r.id === id);
}

export function repoByPath(path: string): RepoRecord | undefined {
    return s().repos.find((r) => r.path === path);
}

export function addRepo(input: { name: string; path: string; originUrl?: string; environment?: string }): RepoRecord {
    const existing = repoByPath(input.path);
    if (existing) {
        existing.name = input.name || existing.name;
        existing.originUrl = input.originUrl ?? existing.originUrl;
        saveStore(s());
        log(`repo updated: ${existing.id} ${existing.path}`);
        return existing;
    }
    const repo: RepoRecord = {
        id: randomUUID(),
        name: input.name,
        path: input.path,
        originUrl: input.originUrl,
        environment: input.environment ?? 'default',
        createdAt: Date.now(),
    };
    s().repos.push(repo);
    saveStore(s());
    log(`repo added: ${repo.id} ${repo.path}`);
    return repo;
}

export function removeRepo(id: string): boolean {
    const st = s();
    const before = st.repos.length;
    st.repos = st.repos.filter((r) => r.id !== id);
    st.sessions = st.sessions.filter((sess) => sess.repoId !== id);
    if (st.repos.length !== before) {
        saveStore(st);
        log(`repo removed: ${id}`);
        return true;
    }
    return false;
}

export function listSessions(): WebSession[] {
    return [...s().sessions].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSession(id: string): WebSession | undefined {
    return s().sessions.find((sess) => sess.id === id);
}

export function upsertSession(session: WebSession): void {
    const st = s();
    const idx = st.sessions.findIndex((sess) => sess.id === session.id);
    if (idx >= 0) {
        st.sessions[idx] = session;
    } else {
        st.sessions.push(session);
    }
    saveStore(st);
}

export function createSession(input: {
    title: string;
    repoId: string;
    branch: string;
    environment: string;
    isolateWorktree?: boolean;
    model?: string;
}): WebSession {
    const session: WebSession = {
        id: randomUUID(),
        title: input.title,
        repoId: input.repoId,
        branch: input.branch,
        environment: input.environment,
        status: 'idle',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isolateWorktree: input.isolateWorktree ?? false,
        // #240: explicit per-session model pick (undefined = follow the
        // policy chain at run time). Validated by the caller against the
        // allowlist/privacy policy before reaching here.
        modelOverride: input.model,
    };
    s().sessions.push(session);
    saveStore(s());
    log(
        `session created: ${session.id} repo=${input.repoId} branch=${input.branch} isolate=${session.isolateWorktree} model=${session.modelOverride ?? '-'}`
    );
    return session;
}

export function setSessionKernelId(sessionId: string, kernelSessionId: string): void {
    const st = s();
    const session = st.sessions.find((sess) => sess.id === sessionId);
    if (!session) return;
    if (session.kernelSessionId !== kernelSessionId) {
        session.kernelSessionId = kernelSessionId;
        saveStore(st);
        log(`session kernel id linked: ${sessionId} -> ${kernelSessionId}`);
    }
}

export function getSessionByKernelId(kernelSessionId: string): WebSession | undefined {
    return s().sessions.find((sess) => sess.kernelSessionId === kernelSessionId);
}

const DEFAULT_PERMISSIONS: SessionPermissions = { mode: 'allowlist', allowedTools: ['Read', 'Glob', 'Grep'] };

// Global default permissions for new sessions (settings-editable); falls
// back to the hardcoded read-only default when never configured.
export function getDefaultPermissions(): SessionPermissions {
    const configured = s().defaultPermissions;
    return configured ? { ...configured, allowedTools: [...configured.allowedTools] } : { ...DEFAULT_PERMISSIONS };
}

export function setDefaultPermissions(mode: PermissionMode, allowedTools: string[]): SessionPermissions {
    const perms: SessionPermissions = { mode, allowedTools };
    s().defaultPermissions = perms;
    saveStore(s());
    log(`default permissions set: mode=${mode} tools=${allowedTools.join(',')}`);
    return perms;
}

export function getPermissions(sessionId: string): SessionPermissions {
    return s().permissions[sessionId] ?? getDefaultPermissions();
}

export function setPermissions(sessionId: string, mode: PermissionMode, allowedTools: string[]): SessionPermissions {
    const perms: SessionPermissions = { mode, allowedTools };
    s().permissions[sessionId] = perms;
    saveStore(s());
    log(`permissions set: ${sessionId} mode=${mode} tools=${allowedTools.join(',')}`);
    return perms;
}

// Test-only: drop the cached store so a new FUSION_CODE_WEB_DATA_DIR takes
// effect (each test gets a fresh temp dir).
export function __resetStoreForTest(): void {
    store = null;
}

export function updateRepo(
    id: string,
    patch: { name?: string; testCommand?: string; environment?: string; setupCommand?: string }
): RepoRecord | undefined {
    const st = s();
    const repo = st.repos.find((r) => r.id === id);
    if (!repo) return undefined;
    if (patch.name !== undefined) repo.name = patch.name;
    if (patch.testCommand !== undefined) repo.testCommand = patch.testCommand;
    if (patch.environment !== undefined) repo.environment = patch.environment;
    if (patch.setupCommand !== undefined) repo.setupCommand = patch.setupCommand;
    saveStore(st);
    log(`repo updated: ${id}`);
    return repo;
}

// v2 environment templates: record the result of an on-demand setup run.
export function markRepoSetup(id: string, ok: boolean, output: string): RepoRecord | undefined {
    const st = s();
    const repo = st.repos.find((r) => r.id === id);
    if (!repo) return undefined;
    repo.lastSetup = { ok, at: Date.now(), output };
    saveStore(st);
    log(`repo setup recorded: ${id} ok=${ok}`);
    return repo;
}

export function addCheckpoint(sessionId: string, checkpoint: Checkpoint): void {
    const st = s();
    const session = st.sessions.find((sess) => sess.id === sessionId);
    if (!session) return;
    if (!session.checkpoints) session.checkpoints = [];
    if (session.checkpoints.some((c) => c.messageUuid === checkpoint.messageUuid)) return;
    session.checkpoints.push(checkpoint);
    saveStore(st);
}

export function markCheckpointVerified(sessionId: string, messageUuid: string, ok: boolean, output: string): void {
    const st = s();
    const session = st.sessions.find((sess) => sess.id === sessionId);
    const cp = session?.checkpoints?.find((c) => c.messageUuid === messageUuid);
    if (!cp) return;
    cp.verified = { ok, at: Date.now(), output: output.slice(0, 2000) };
    saveStore(st);
}

export function addTurnUsage(sessionId: string, usage: TurnUsage): void {
    const st = s();
    const session = st.sessions.find((sess) => sess.id === sessionId);
    if (!session) return;
    if (!session.usage) session.usage = [];
    session.usage.push(usage);
    saveStore(st);
}

export function setSessionPr(sessionId: string, prUrl: string, prBranch: string): void {
    const st = s();
    const session = st.sessions.find((sess) => sess.id === sessionId);
    if (!session) return;
    session.prUrl = prUrl;
    session.prBranch = prBranch;
    saveStore(st);
    log(`session PR created: ${sessionId} ${prUrl}`);
}

// #237: inline diff comments.
export function listDiffComments(sessionId: string): DiffComment[] {
    return [...(s().comments?.[sessionId] ?? [])];
}

export function addDiffComment(sessionId: string, input: { path: string; line: number; text: string }): DiffComment {
    const st = s();
    if (!st.comments) st.comments = {};
    const comment: DiffComment = {
        id: randomUUID(),
        path: input.path,
        line: input.line,
        text: input.text,
        at: Date.now(),
    };
    st.comments[sessionId] = [...(st.comments[sessionId] ?? []), comment];
    saveStore(st);
    log(`diff comment added: session=${sessionId} path=${input.path} line=${input.line}`);
    return comment;
}
