import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bufferedEvents, startRun } from '../server/runner';
import { __resetStoreForTest, addRepo, createSession, getSession } from '../server/store';

// #234 P1: pre-spawn hygiene — deleted workdir / missing kernel binary /
// missing auth env produce a structured turn_error, not a raw ENOENT.

const tempDirs: string[] = [];

beforeEach(() => {
    const dataDir = mkdtempSync(join(tmpdir(), 'fcweb-spawn-'));
    tempDirs.push(dataDir);
    process.env.FUSION_CODE_WEB_DATA_DIR = dataDir;
    process.env.FUSION_CODE_WEB_KERNEL_BIN = `bun ${join(import.meta.dir, 'fixtures/mockKernel.ts')}`;
    process.env.FUSION_BASE_URL = 'http://127.0.0.1:11432';
    process.env.FUSION_AUTH_TOKEN = 'test-token';
    // Pin the env file to the temp dir — never read the real ~/.fusion-code/web.env.
    process.env.FUSION_CODE_WEB_ENV_FILE = join(dataDir, 'no-such-env-file');
    __resetStoreForTest();
});

afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    delete process.env.FUSION_CODE_WEB_DATA_DIR;
    delete process.env.FUSION_CODE_WEB_KERNEL_BIN;
    delete process.env.FUSION_BASE_URL;
    delete process.env.FUSION_AUTH_TOKEN;
    delete process.env.FUSION_CODE_WEB_ENV_FILE;
});

function makeSession(repoPath: string): string {
    const repo = addRepo({ name: 'demo', path: repoPath });
    return createSession({ title: 's', repoId: repo.id, branch: 'main', environment: 'default' }).id;
}

describe('spawn precheck (#234 P1)', () => {
    test('deleted workdir → structured turn_error, session error, ok:false', async () => {
        const worktree = mkdtempSync(join(tmpdir(), 'fcweb-gone-'));
        rmSync(worktree, { recursive: true, force: true });
        const sessionId = makeSession(worktree);

        const result = await startRun({ sessionId, message: 'do things' });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('worktree missing');

        const session = getSession(sessionId);
        expect(session?.status).toBe('error');
        expect(session?.errorText).toContain('worktree missing');
        expect(bufferedEvents(sessionId).some((e) => e.kind === 'turn_error')).toBe(true);
    });

    test('missing kernel binary → structured turn_error', async () => {
        const worktree = mkdtempSync(join(tmpdir(), 'fcweb-bin-'));
        tempDirs.push(worktree);
        const sessionId = makeSession(worktree);
        process.env.FUSION_CODE_WEB_KERNEL_BIN = '/nonexistent/fusion-code-bin';

        const result = await startRun({ sessionId, message: 'x' });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('kernel binary not found');
        expect(getSession(sessionId)?.status).toBe('error');
    });

    test('missing auth env → fail fast before spawn', async () => {
        const worktree = mkdtempSync(join(tmpdir(), 'fcweb-auth-'));
        tempDirs.push(worktree);
        mkdirSync(worktree, { recursive: true });
        const sessionId = makeSession(worktree);
        delete process.env.FUSION_BASE_URL;
        delete process.env.FUSION_AUTH_TOKEN;
        delete process.env.FUSION_CLIENT_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.ANTHROPIC_BASE_URL;

        const result = await startRun({ sessionId, message: 'x' });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('auth env missing');
        expect(result.error).toContain('FUSION_BASE_URL');
        expect(getSession(sessionId)?.status).toBe('error');
        // No kernel process started — no turn_started event either.
        expect(bufferedEvents(sessionId).some((e) => e.kind === 'turn_started')).toBe(false);
    });
});
