import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRun } from '../server/runner';
import { __resetStoreForTest, addRepo, createSession, getSession } from '../server/store';

// #237 GUI parity: isolated-worktree sessions lazily create a dedicated git
// worktree (dataDir/worktrees/<sessionId>) and run the kernel there, so the
// repo checkout never sees the session's edits directly.

const tempDirs: string[] = [];

function gitSync(dir: string, args: string[]): void {
    const result = Bun.spawnSync(['git', '-C', dir, ...args]);
    if (result.exitCode !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
}

function makeRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'fcweb-wt-repo-'));
    tempDirs.push(dir);
    gitSync(dir, ['init', '-b', 'main']);
    gitSync(dir, ['config', 'user.email', 't@t.local']);
    gitSync(dir, ['config', 'user.name', 'T']);
    writeFileSync(join(dir, 'a.txt'), 'hello\n');
    gitSync(dir, ['add', '.']);
    gitSync(dir, ['commit', '-m', 'init']);
    return dir;
}

function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const poll = () => {
            if (cond()) {
                resolve();
                return;
            }
            if (Date.now() - started > timeoutMs) {
                reject(new Error('waitFor timeout'));
                return;
            }
            setTimeout(poll, 100);
        };
        poll();
    });
}

beforeEach(() => {
    const dataDir = mkdtempSync(join(tmpdir(), 'fcweb-wt-data-'));
    tempDirs.push(dataDir);
    process.env.FUSION_CODE_WEB_DATA_DIR = dataDir;
    process.env.FUSION_CODE_WEB_KERNEL_BIN = `bun ${join(import.meta.dir, 'fixtures/mockKernel.ts')}`;
    process.env.FUSION_BASE_URL = 'http://127.0.0.1:11432';
    process.env.FUSION_AUTH_TOKEN = 'test-token';
    process.env.FUSION_CODE_WEB_ENV_FILE = join(dataDir, 'no-such-env-file');
    // Pin the kernel config dir too — isolated worktrees are created under
    // <configDir>/worktrees and must never touch the real ~/.fusion-code.
    process.env.FUSION_CODE_CONFIG_DIR = join(dataDir, 'config');
    __resetStoreForTest();
});

afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    delete process.env.FUSION_CODE_WEB_DATA_DIR;
    delete process.env.FUSION_CODE_WEB_KERNEL_BIN;
    delete process.env.FUSION_BASE_URL;
    delete process.env.FUSION_AUTH_TOKEN;
    delete process.env.FUSION_CODE_WEB_ENV_FILE;
    delete process.env.FUSION_CODE_CONFIG_DIR;
});

describe('worktree isolation (#237)', () => {
    test('non-isolated session keeps cwd = repo path', () => {
        const repoDir = makeRepo();
        const repo = addRepo({ name: 'r', path: repoDir });
        const session = createSession({ title: 's', repoId: repo.id, branch: 'main', environment: 'default' });
        expect(session.isolateWorktree).toBe(false);
        expect(session.worktreePath).toBeUndefined();
    });

    test('isolated session creates a worktree and runs the kernel there', async () => {
        const repoDir = makeRepo();
        const repo = addRepo({ name: 'r', path: repoDir });
        const session = createSession({
            title: 'iso',
            repoId: repo.id,
            branch: 'main',
            environment: 'default',
            isolateWorktree: true,
        });
        const result = await startRun({ sessionId: session.id, message: 'do things' });
        expect(result.ok).toBe(true);
        await waitFor(() => getSession(session.id)?.status === 'idle', 10_000);

        const linked = getSession(session.id);
        expect(linked?.worktreePath).toBeTruthy();
        const wt = linked!.worktreePath!;
        expect(existsSync(join(wt, '.git'))).toBe(true);
        expect(existsSync(join(wt, 'a.txt'))).toBe(true);
        // Worktree is a real linked worktree of the repo (own branch).
        const probe = Bun.spawnSync(['git', '-C', wt, 'rev-parse', '--abbrev-ref', 'HEAD']);
        expect(probe.exitCode).toBe(0);
        expect(probe.stdout.toString().trim()).toMatch(/^fusion-code\/web-/);
        // Repo checkout is untouched by the mock kernel run.
        const repoStatus = Bun.spawnSync(['git', '-C', repoDir, 'status', '--porcelain']);
        expect(repoStatus.stdout.toString().trim()).toBe('');
    }, 20_000);

    test('isolated session on a non-git repo fails with a structured worktree error', async () => {
        const plain = mkdtempSync(join(tmpdir(), 'fcweb-wt-plain-'));
        tempDirs.push(plain);
        const repo = addRepo({ name: 'plain', path: plain });
        const session = createSession({
            title: 'bad',
            repoId: repo.id,
            branch: 'main',
            environment: 'default',
            isolateWorktree: true,
        });
        const result = await startRun({ sessionId: session.id, message: 'x' });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('worktree check failed');
        expect(getSession(session.id)?.status).toBe('error');
    });
});
