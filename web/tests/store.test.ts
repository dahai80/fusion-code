import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    __resetStoreForTest,
    addRepo,
    createSession,
    getPermissions,
    getSession,
    getSessionByKernelId,
    listRepos,
    listSessions,
    removeRepo,
    setPermissions,
    setSessionKernelId,
    upsertSession,
} from '../server/store';

const tempDirs: string[] = [];

beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'fcweb-store-'));
    tempDirs.push(dir);
    process.env.FUSION_CODE_WEB_DATA_DIR = dir;
    __resetStoreForTest();
});

afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    delete process.env.FUSION_CODE_WEB_DATA_DIR;
});

describe('store: repos', () => {
    test('add + list + remove', () => {
        const repo = addRepo({ name: 'demo', path: '/tmp/demo' });
        expect(listRepos().length).toBe(1);
        expect(listRepos()[0].name).toBe('demo');
        expect(removeRepo(repo.id)).toBe(true);
        expect(listRepos().length).toBe(0);
    });

    test('add same path twice updates instead of duplicating', () => {
        addRepo({ name: 'demo', path: '/tmp/demo' });
        const updated = addRepo({ name: 'renamed', path: '/tmp/demo' });
        expect(listRepos().length).toBe(1);
        expect(updated.name).toBe('renamed');
    });

    test('removing repo drops its sessions', () => {
        const repo = addRepo({ name: 'demo', path: '/tmp/demo' });
        createSession({ title: 'task', repoId: repo.id, branch: 'main', environment: 'default' });
        expect(listSessions().length).toBe(1);
        removeRepo(repo.id);
        expect(listSessions().length).toBe(0);
    });
});

describe('store: sessions', () => {
    test('create session, link kernel id (web id stays stable)', () => {
        const repo = addRepo({ name: 'demo', path: '/tmp/demo' });
        const session = createSession({
            title: 'fix login timeout',
            repoId: repo.id,
            branch: 'main',
            environment: 'default',
        });
        const webId = session.id;
        expect(webId).not.toContain('pending:');

        setPermissions(webId, 'allowlist', ['Read', 'Bash']);
        const kernelId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        setSessionKernelId(webId, kernelId);

        // Web id unchanged; kernel id linked for --resume + history.
        const linked = getSession(webId);
        expect(linked?.id).toBe(webId);
        expect(linked?.kernelSessionId).toBe(kernelId);
        expect(getSessionByKernelId(kernelId)?.id).toBe(webId);
        // permissions keyed by web id
        expect(getPermissions(webId).allowedTools).toEqual(['Read', 'Bash']);
    });

    test('status transitions persist', () => {
        const repo = addRepo({ name: 'demo', path: '/tmp/demo' });
        const session = createSession({ title: 'task', repoId: repo.id, branch: 'main', environment: 'default' });
        session.status = 'running';
        upsertSession(session);
        expect(getSession(session.id)?.status).toBe('running');
    });
});

describe('store: permissions defaults', () => {
    test('default is read-only allowlist', () => {
        const repo = addRepo({ name: 'demo', path: '/tmp/demo' });
        const session = createSession({ title: 'task', repoId: repo.id, branch: 'main', environment: 'default' });
        const perms = getPermissions(session.id);
        expect(perms.mode).toBe('allowlist');
        expect(perms.allowedTools).toEqual(['Read', 'Glob', 'Grep']);
    });

    test('ask mode stored', () => {
        const repo = addRepo({ name: 'demo', path: '/tmp/demo' });
        const session = createSession({ title: 'task', repoId: repo.id, branch: 'main', environment: 'default' });
        setPermissions(session.id, 'ask', []);
        expect(getPermissions(session.id).mode).toBe('ask');
    });
});
