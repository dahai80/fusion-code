import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PermissionMode, RepoRecord, SessionPermissions, WebSession } from '../shared/types';
import { dataDir, log, logWarn } from './config';

// JSON-file persistence for repos / sessions / permissions. Small datasets
// (tens of records), single process — atomic-enough write via tmp+rename is
// overkill for v1; the CLI's own session files remain the durable record.

type StoreShape = {
    repos: RepoRecord[];
    sessions: WebSession[];
    permissions: Record<string, SessionPermissions>;
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
    };
    s().sessions.push(session);
    saveStore(s());
    log(`session created: ${session.id} repo=${input.repoId} branch=${input.branch}`);
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

export function getPermissions(sessionId: string): SessionPermissions {
    return s().permissions[sessionId] ?? { ...DEFAULT_PERMISSIONS };
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
