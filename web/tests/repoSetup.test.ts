import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runVerifyCommand } from '../server/gitRepo';
import { __resetStoreForTest, addRepo, getRepo, markRepoSetup, updateRepo } from '../server/store';

// v2 environment templates: per-repo setup command — stored, editable, run
// on demand, result recorded on the repo record.

const tempDirs: string[] = [];

beforeEach(() => {
    const dataDir = mkdtempSync(join(tmpdir(), 'fcweb-setup-'));
    tempDirs.push(dataDir);
    process.env.FUSION_CODE_WEB_DATA_DIR = dataDir;
    __resetStoreForTest();
});

afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    delete process.env.FUSION_CODE_WEB_DATA_DIR;
});

describe('repo setup command (env templates v2)', () => {
    test('setupCommand round-trips through updateRepo', () => {
        const repo = addRepo({ name: 'demo', path: '/tmp/demo' });
        const updated = updateRepo(repo.id, { setupCommand: 'bun install' });
        expect(updated?.setupCommand).toBe('bun install');
        expect(getRepo(repo.id)?.setupCommand).toBe('bun install');
    });

    test('markRepoSetup records ok/fail results with output', () => {
        const repo = addRepo({ name: 'demo', path: '/tmp/demo' });
        markRepoSetup(repo.id, true, 'installed 42 packages');
        const after = getRepo(repo.id);
        expect(after?.lastSetup?.ok).toBe(true);
        expect(after?.lastSetup?.output).toContain('42 packages');
        expect(after?.lastSetup?.at).toBeGreaterThan(0);

        markRepoSetup(repo.id, false, 'EACCES');
        expect(getRepo(repo.id)?.lastSetup?.ok).toBe(false);
    });

    test('runVerifyCommand executes in repo worktree and captures failure', async () => {
        const worktree = mkdtempSync(join(tmpdir(), 'fcweb-worktree-'));
        tempDirs.push(worktree);
        writeFileSync(join(worktree, 'marker.txt'), 'hello');
        mkdirSync(join(worktree, 'sub'));

        const okRun = await runVerifyCommand(worktree, 'cat marker.txt && pwd', 10_000, 'setup');
        expect(okRun.ok).toBe(true);
        expect(okRun.output).toContain('hello');
        expect(okRun.output).toContain(worktree);

        const failRun = await runVerifyCommand(worktree, 'exit 3', 10_000, 'setup');
        expect(failRun.ok).toBe(false);
    });
});
