import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    createPullRequest,
    fileDiff,
    runVerifyCommand,
} from '../server/gitRepo';
import { rollbackToCheckpoint, startRun } from '../server/runner';
import {
    __resetStoreForTest,
    addCheckpoint,
    addRepo,
    addTurnUsage,
    createSession,
    getSession,
    markCheckpointVerified,
    setSessionPr,
    updateRepo,
} from '../server/store';

// #229/#230 backend: checkpoint capture from stream-json, diff rendering,
// verify command, kernel rollback args, PR flow (bare origin + gh shim),
// usage aggregation inputs.

const tempDirs: string[] = [];
const mockKernel = join(import.meta.dir, 'fixtures/mockKernel.ts');

function gitSync(dir: string, args: string[]): void {
    const result = Bun.spawnSync(['git', '-C', dir, ...args]);
    if (result.exitCode !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
}

function makeRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'fcweb-cp-repo-'));
    tempDirs.push(dir);
    gitSync(dir, ['init', '-b', 'main']);
    gitSync(dir, ['config', 'user.email', 'test@test.local']);
    gitSync(dir, ['config', 'user.name', 'Test']);
    writeFileSync(join(dir, 'README.md'), '# demo\n');
    gitSync(dir, ['add', '.']);
    gitSync(dir, ['commit', '-m', 'init']);
    return dir;
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error(`waitFor timed out after ${timeoutMs}ms`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

beforeAll(() => {
    const dataDir = mkdtempSync(join(tmpdir(), 'fcweb-cp-data-'));
    tempDirs.push(dataDir);
    process.env.FUSION_CODE_WEB_DATA_DIR = dataDir;
    process.env.FUSION_CODE_WEB_KERNEL_BIN = `bun ${mockKernel}`;
    __resetStoreForTest();
});

afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    delete process.env.FUSION_CODE_WEB_DATA_DIR;
    delete process.env.FUSION_CODE_WEB_KERNEL_BIN;
    delete process.env.FUSION_CODE_WEB_GH_BIN;
});

describe('fileDiff (#229)', () => {
    test('tracked modified file returns unified diff vs HEAD', async () => {
        const dir = makeRepo();
        writeFileSync(join(dir, 'README.md'), '# demo v2\n');
        const diff = await fileDiff(dir, 'README.md');
        expect(diff).toContain('--- a/README.md');
        expect(diff).toContain('+++ b/README.md');
        expect(diff).toContain('-# demo');
        expect(diff).toContain('+# demo v2');
    });

    test('untracked file rendered as new-file diff', async () => {
        const dir = makeRepo();
        writeFileSync(join(dir, 'new.ts'), 'export const x = 1;\n');
        const diff = await fileDiff(dir, 'new.ts');
        expect(diff).toContain('--- /dev/null');
        expect(diff).toContain('+++ b/new.ts');
        expect(diff).toContain('+export const x = 1;');
    });
});

describe('runVerifyCommand (#229)', () => {
    test('exit 0 = ok', async () => {
        const dir = makeRepo();
        const res = await runVerifyCommand(dir, 'echo ok-verify');
        expect(res.ok).toBe(true);
        expect(res.output).toContain('ok-verify');
    });

    test('non-zero exit = failure with output', async () => {
        const dir = makeRepo();
        const res = await runVerifyCommand(dir, 'echo bad-verify >&2; exit 1');
        expect(res.ok).toBe(false);
        expect(res.output).toContain('bad-verify');
    });
});

describe('checkpoint + usage capture from kernel stream (#229/#230)', () => {
    test('run records checkpoint (prompt uuid) and per-turn usage', async () => {
        const repoDir = makeRepo();
        const repo = addRepo({ name: 'cp-demo', path: repoDir });
        const session = createSession({ title: 'cp task', repoId: repo.id, branch: 'main', environment: 'default' });

        await startRun({ sessionId: session.id, message: 'Fix the bug.' });
        await waitFor(() => getSession(session.id)?.status === 'idle', 10_000);

        const after = getSession(session.id);
        expect(after?.kernelSessionId).toBe('11111111-2222-3333-4444-555555555555');
        // Checkpoint captured from the user text message uuid.
        expect(after?.checkpoints?.length).toBe(1);
        expect(after?.checkpoints?.[0].messageUuid).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        expect(after?.checkpoints?.[0].label).toContain('Fix the bug');
        // Usage captured from the result message.
        expect(after?.usage?.length).toBe(1);
        expect(after?.usage?.[0].inputTokens).toBe(1200);
        expect(after?.usage?.[0].outputTokens).toBe(300);
        expect(after?.usage?.[0].costUsd).toBe(0.01);
        expect(after?.usage?.[0].model).toBe('mock-model');
    }, 20_000);

    test('rollback spawns kernel with --resume <kernelId> --rewind-files <uuid>', async () => {
        const argsFile = mkdtempSync(join(tmpdir(), 'fcweb-args-'));
        tempDirs.push(argsFile);
        process.env.MOCK_ARGS_FILE = join(argsFile, 'argv.log');
        try {
            const repoDir = makeRepo();
            const repo = addRepo({ name: 'rb-demo', path: repoDir });
            const session = createSession({ title: 'rb task', repoId: repo.id, branch: 'main', environment: 'default' });
            await startRun({ sessionId: session.id, message: 'make changes' });
            await waitFor(() => getSession(session.id)?.status === 'idle', 10_000);

            const result = await rollbackToCheckpoint(session.id, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
            expect(result.ok).toBe(true);

            const argvLines = readFileSync(process.env.MOCK_ARGS_FILE, 'utf-8').trim().split('\n');
            const last = JSON.parse(argvLines[argvLines.length - 1]) as string[];
            expect(last).toContain('--resume');
            expect(last).toContain('11111111-2222-3333-4444-555555555555');
            expect(last).toContain('--rewind-files');
            expect(last).toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        } finally {
            delete process.env.MOCK_ARGS_FILE;
        }
    }, 20_000);

    test('rollback rejected before any kernel run', async () => {
        const repoDir = makeRepo();
        const repo = addRepo({ name: 'rb-nok', path: repoDir });
        const session = createSession({ title: 'no kernel', repoId: repo.id, branch: 'main', environment: 'default' });
        const result = await rollbackToCheckpoint(session.id, 'some-uuid');
        expect(result.ok).toBe(false);
        expect(result.error).toContain('no kernel run');
    });
});

describe('store v2 functions (#229/#230)', () => {
    test('addCheckpoint dedups by messageUuid', () => {
        const repoDir = makeRepo();
        const repo = addRepo({ name: 'st-demo', path: repoDir });
        const session = createSession({ title: 'st', repoId: repo.id, branch: 'main', environment: 'default' });
        addCheckpoint(session.id, { messageUuid: 'u1', label: 'first', createdAt: 1 });
        addCheckpoint(session.id, { messageUuid: 'u1', label: 'dup', createdAt: 2 });
        addCheckpoint(session.id, { messageUuid: 'u2', label: 'second', createdAt: 3 });
        const cps = getSession(session.id)?.checkpoints ?? [];
        expect(cps.length).toBe(2);
        expect(cps[0].label).toBe('first');
    });

    test('markCheckpointVerified stamps verified', () => {
        const repoDir = makeRepo();
        const repo = addRepo({ name: 'st-v', path: repoDir });
        const session = createSession({ title: 'stv', repoId: repo.id, branch: 'main', environment: 'default' });
        addCheckpoint(session.id, { messageUuid: 'v1', label: 'verify me', createdAt: 1 });
        markCheckpointVerified(session.id, 'v1', true, 'all good');
        const cp = getSession(session.id)?.checkpoints?.find((c) => c.messageUuid === 'v1');
        expect(cp?.verified?.ok).toBe(true);
        expect(cp?.verified?.output).toBe('all good');
    });

    test('updateRepo patches testCommand; setSessionPr stores url+branch', () => {
        const repoDir = makeRepo();
        const repo = addRepo({ name: 'st-p', path: repoDir });
        const updated = updateRepo(repo.id, { testCommand: 'bun test' });
        expect(updated?.testCommand).toBe('bun test');

        const session = createSession({ title: 'pr', repoId: repo.id, branch: 'main', environment: 'default' });
        setSessionPr(session.id, 'https://example.com/pr/7', 'fusion-code/web-abc');
        const after = getSession(session.id);
        expect(after?.prUrl).toBe('https://example.com/pr/7');
        expect(after?.prBranch).toBe('fusion-code/web-abc');
    });

    test('addTurnUsage appends', () => {
        const repoDir = makeRepo();
        const repo = addRepo({ name: 'st-u', path: repoDir });
        const session = createSession({ title: 'u', repoId: repo.id, branch: 'main', environment: 'default' });
        addTurnUsage(session.id, { at: 1, inputTokens: 10, outputTokens: 5, costUsd: 0.001, durationMs: 100 });
        addTurnUsage(session.id, { at: 2, inputTokens: 20, outputTokens: 6, costUsd: 0.002, durationMs: 200 });
        expect(getSession(session.id)?.usage?.length).toBe(2);
    });
});

describe('createPullRequest (#229)', () => {
    test('branch + commit + push + gh shim URL', async () => {
        // Bare origin so push works without any network.
        const bareDir = mkdtempSync(join(tmpdir(), 'fcweb-cp-origin-'));
        tempDirs.push(bareDir);
        Bun.spawnSync(['git', 'init', '--bare', '-b', 'main', bareDir]);

        const dir = makeRepo();
        gitSync(dir, ['remote', 'add', 'origin', bareDir]);
        gitSync(dir, ['push', '-u', 'origin', 'main']);
        writeFileSync(join(dir, 'feature.txt'), 'new work\n');

        // gh shim: prints a PR URL on stdout.
        const shimDir = mkdtempSync(join(tmpdir(), 'fcweb-gh-shim-'));
        tempDirs.push(shimDir);
        const shimPath = join(shimDir, 'gh-shim.sh');
        writeFileSync(shimPath, '#!/bin/sh\necho "https://example.com/pr/42"\n');
        Bun.spawnSync(['chmod', '+x', shimPath]);
        process.env.FUSION_CODE_WEB_GH_BIN = shimPath;

        try {
            const result = await createPullRequest(dir, {
                title: 'feat: from web session',
                body: 'test body',
                branch: 'fusion-code/web-test1',
            });
            expect(result.ok).toBe(true);
            expect(result.url).toBe('https://example.com/pr/42');

            // Branch exists, commit landed, and pushed to origin.
            const branch = Bun.spawnSync(['git', '-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD']);
            expect(String(branch.stdout).trim()).toBe('fusion-code/web-test1');
            const log = Bun.spawnSync(['git', '-C', dir, 'log', '-1', '--pretty=%s']);
            expect(String(log.stdout).trim()).toBe('feat: from web session');
            const remoteBranch = Bun.spawnSync(['git', '-C', dir, 'ls-remote', '--heads', 'origin', 'fusion-code/web-test1']);
            expect(String(remoteBranch.stdout)).toContain('refs/heads/fusion-code/web-test1');
        } finally {
            delete process.env.FUSION_CODE_WEB_GH_BIN;
        }
    });

    test('no changes = error', async () => {
        const dir = makeRepo();
        const result = await createPullRequest(dir, { title: 'empty', body: '', branch: 'nope' });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('no changes');
    });
});
