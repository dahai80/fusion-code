import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bufferedEvents, cancelRun, isRunning, startRun } from '../server/runner';
import { __resetStoreForTest, addRepo, createSession } from '../server/store';

// Issue #228 FCS-1: the composer's running state turns the send button into a
// stop control — POST /api/sessions/:id/cancel (cancelRun) kills the kernel
// proc mid-run and surfaces one turn_error ("run cancelled by user") without
// a duplicate "exited without a result" event from the drain loop.

const tempDirs: string[] = [];
const mockKernel = join(import.meta.dir, 'fixtures/mockKernel.ts');

function gitSync(dir: string, args: string[]): void {
    const result = Bun.spawnSync(['git', '-C', dir, ...args]);
    if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) throw new Error(`waitFor timed out after ${timeoutMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

beforeAll(() => {
    const dataDir = mkdtempSync(join(tmpdir(), 'fcweb-cancel-data-'));
    const repoDir = mkdtempSync(join(tmpdir(), 'fcweb-cancel-repo-'));
    tempDirs.push(dataDir, repoDir);
    process.env.FUSION_CODE_WEB_DATA_DIR = dataDir;
    process.env.FUSION_CODE_WEB_KERNEL_BIN = `bun ${mockKernel}`;
    process.env.FUSION_CODE_WEB_ENV_FILE = join(dataDir, 'missing.env');
    process.env.FUSION_AUTH_TOKEN = 'test-token';
    process.env.FUSION_BASE_URL = 'http://127.0.0.1:1';
    __resetStoreForTest();
    gitSync(repoDir, ['init', '-b', 'main']);
    gitSync(repoDir, ['config', 'user.email', 'test@test.local']);
    gitSync(repoDir, ['config', 'user.name', 'Test']);
    writeFileSync(join(repoDir, 'README.md'), '# demo\n');
    gitSync(repoDir, ['add', '.']);
    gitSync(repoDir, ['commit', '-m', 'init']);
});

afterAll(() => {
    delete process.env.FUSION_CODE_WEB_DATA_DIR;
    delete process.env.FUSION_CODE_WEB_KERNEL_BIN;
    delete process.env.FUSION_CODE_WEB_ENV_FILE;
    delete process.env.FUSION_AUTH_TOKEN;
    delete process.env.FUSION_BASE_URL;
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('cancelRun (FCS-1 stop control, #228)', () => {
    test('kills the active run, emits one cancelled turn_error', async () => {
        const repo = addRepo({ name: 'demo', path: tempDirs[1]! });
        const session = createSession({
            repoId: repo.id,
            branch: 'main',
            title: 'cancel test',
            environment: 'test',
        });
        process.env.MOCK_DELAY_MS = '8000';
        try {
            const started = await startRun({ sessionId: session.id, message: 'long running task' });
            expect(started.ok).toBe(true);
            await waitFor(() => isRunning(session.id), 5000);

            const cancelled = cancelRun(session.id);
            expect(cancelled.ok).toBe(true);
            await waitFor(() => !isRunning(session.id), 5000);

            const events = bufferedEvents(session.id);
            const errors = events.filter((e) => e.kind === 'turn_error');
            expect(errors.length).toBe(1);
            expect(errors[0]!.text).toBe('run cancelled by user');
        } finally {
            delete process.env.MOCK_DELAY_MS;
        }
    }, 20000);

    test('cancel without an active run reports 409-shaped error', () => {
        const result = cancelRun('sess_nonexistent');
        expect(result.ok).toBe(false);
        expect(result.error).toContain('no active run');
    });
});
