import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __resetStoreForTest, addRepo, createSession, getSession } from '../server/store';
import { currentBranch, fileChanges, isGitRepo, listBranches } from '../server/gitRepo';
import { bufferedEvents, startRun, subscribe } from '../server/runner';

// E2E-ish: real git repo + mock kernel binary + runner orchestration.
// The runner is the core of #228: server-owned runs, kernel-id promotion,
// event buffering for reconnect, post-turn file changes.

const tempDirs: string[] = [];
const mockKernel = join(import.meta.dir, 'fixtures/mockKernel.ts');

function gitSync(dir: string, args: string[]): void {
    const result = Bun.spawnSync(['git', '-C', dir, ...args]);
    if (result.exitCode !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
}

function makeRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'fcweb-repo-'));
    tempDirs.push(dir);
    gitSync(dir, ['init', '-b', 'main']);
    gitSync(dir, ['config', 'user.email', 'test@test.local']);
    gitSync(dir, ['config', 'user.name', 'Test']);
    writeFileSync(join(dir, 'README.md'), '# demo\n');
    gitSync(dir, ['add', '.']);
    gitSync(dir, ['commit', '-m', 'init']);
    return dir;
}

beforeAll(() => {
    const dataDir = mkdtempSync(join(tmpdir(), 'fcweb-data-'));
    tempDirs.push(dataDir);
    process.env.FUSION_CODE_WEB_DATA_DIR = dataDir;
    process.env.FUSION_CODE_WEB_KERNEL_BIN = `bun ${mockKernel}`;
    __resetStoreForTest();
});

afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    delete process.env.FUSION_CODE_WEB_DATA_DIR;
    delete process.env.FUSION_CODE_WEB_KERNEL_BIN;
});

describe('gitRepo helpers', () => {
    test('isGitRepo + branches + currentBranch', async () => {
        const dir = makeRepo();
        expect(await isGitRepo(dir)).toBe(true);
        expect(await isGitRepo(tmpdir())).toBe(false);
        const branches = await listBranches(dir);
        expect(branches.length).toBe(1);
        expect(branches[0].name).toBe('main');
        expect(branches[0].current).toBe(true);
        expect(await currentBranch(dir)).toBe('main');
    });

    test('fileChanges detects modified file with +/- counts', async () => {
        const dir = makeRepo();
        writeFileSync(join(dir, 'README.md'), '# demo\nnew line\n');
        const changes = await fileChanges(dir);
        expect(changes.length).toBe(1);
        expect(changes[0].path).toBe('README.md');
        expect(changes[0].status).toBe('M');
        expect(changes[0].additions).toBe(1);
        expect(changes[0].deletions).toBe(0);
    });

    test('fileChanges detects untracked file', async () => {
        const dir = makeRepo();
        writeFileSync(join(dir, 'new-file.ts'), 'export {};\n');
        const changes = await fileChanges(dir);
        expect(changes.length).toBe(1);
        expect(changes[0].status).toBe('?');
        expect(changes[0].path).toBe('new-file.ts');
    });
});

describe('runner: kernel orchestration', () => {
    test('full turn: events buffered, session promoted, runs survive no subscribers', async () => {
        const repoDir = makeRepo();
        const repo = addRepo({ name: 'demo', path: repoDir });
        const session = createSession({ title: 'fix bug', repoId: repo.id, branch: 'main', environment: 'default' });

        // No subscriber connected — the run must still complete server-side.
        const result = await startRun({ sessionId: session.id, message: 'Fix the bug and add tests.' });
        expect(result.ok).toBe(true);

        // Wait for the run to finish (mock kernel exits quickly).
        await waitFor(() => getSession(session.id)?.status === 'idle', 10_000);

        const linked = getSession(session.id);
        expect(linked?.kernelSessionId).toBe('11111111-2222-3333-4444-555555555555');

        const events = bufferedEvents(session.id);
        const kinds = events.map((e) => e.kind);
        expect(kinds).toContain('turn_started');
        expect(kinds).toContain('assistant_text');
        expect(kinds).toContain('tool_use');
        expect(kinds).toContain('tool_result');
        expect(kinds).toContain('turn_completed');
        expect(kinds).toContain('file_changes');
        // seqs are monotonic
        const seqs = events.map((e) => e.seq);
        expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    }, 20_000);

    test('second run on same session resumes kernel session id', async () => {
        const repoDir = makeRepo();
        const repo = addRepo({ name: 'demo2', path: repoDir });
        const session = createSession({ title: 'task', repoId: repo.id, branch: 'main', environment: 'default' });
        await startRun({ sessionId: session.id, message: 'first' });
        await waitFor(() => getSession(session.id)?.status === 'idle', 10_000);
        expect(getSession(session.id)?.kernelSessionId).toBeDefined();

        // Follow-up instruction (UC-C1 step 5): same session, kernel resume.
        const seen: string[] = [];
        const unsub = subscribe(session.id, (e) => seen.push(e.kind));
        const result = await startRun({ sessionId: getSession(session.id)!.id, message: 'follow-up' });
        expect(result.ok).toBe(true);
        await waitFor(() => seen.includes('turn_completed'), 10_000);
        unsub();
        expect(seen).toContain('assistant_text');
    }, 20_000);

    test('concurrent run on same session rejected', async () => {
        const repoDir = makeRepo();
        const repo = addRepo({ name: 'demo3', path: repoDir });
        const session = createSession({ title: 'task', repoId: repo.id, branch: 'main', environment: 'default' });
        const first = await startRun({ sessionId: session.id, message: 'slow' });
        expect(first.ok).toBe(true);
        const second = await startRun({ sessionId: session.id, message: 'second' });
        expect(second.ok).toBe(false);
        expect(second.alreadyRunning).toBe(true);
        await waitFor(() => getSession(session.id)?.status === 'idle', 10_000);
    }, 20_000);
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error(`waitFor timed out after ${timeoutMs}ms`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}
