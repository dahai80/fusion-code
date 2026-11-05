import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Issue #241: GET /api/commands (workflow command palette registry) and
// GET /api/sessions/:id/export (kernel transcript as markdown download).

const PORT = 11591;
const tempDirs: string[] = [];
let serverProc: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | null = null;
let serverStderr = '';
let repoId = '';
let sessionId = '';

function waitReady(): Promise<void> {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const poll = async () => {
            try {
                const res = await fetch(`http://127.0.0.1:${PORT}/health`);
                if (res.ok) {
                    resolve();
                    return;
                }
            } catch {
                /* not up yet */
            }
            if (Date.now() - started > 15_000) {
                reject(new Error(`server not ready, stderr:\n${serverStderr}`));
                return;
            }
            setTimeout(() => void poll(), 200);
        };
        void poll();
    });
}

function gitSync(dir: string, args: string[]): void {
    const result = Bun.spawnSync(['git', '-C', dir, ...args]);
    if (result.exitCode !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
}

beforeAll(async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'fcweb-cmd-repo-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'fcweb-cmd-data-'));
    const configDir = mkdtempSync(join(tmpdir(), 'fcweb-cmd-cfg-'));
    tempDirs.push(repoDir, dataDir, configDir);
    gitSync(repoDir, ['init', '-b', 'main']);
    gitSync(repoDir, ['config', 'user.email', 't@t.local']);
    gitSync(repoDir, ['config', 'user.name', 'T']);
    writeFileSync(join(repoDir, 'a.txt'), 'hello\n');
    gitSync(repoDir, ['add', '.']);
    gitSync(repoDir, ['commit', '-m', 'init']);

    serverProc = Bun.spawn(['bun', join(import.meta.dir, '../server/index.ts')], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
            ...process.env,
            FUSION_CODE_WEB_PORT: String(PORT),
            FUSION_CODE_WEB_DATA_DIR: dataDir,
            FUSION_CODE_WEB_KERNEL_BIN: `bun ${join(import.meta.dir, 'fixtures/mockKernel.ts')}`,
            FUSION_CODE_CONFIG_DIR: configDir,
            FUSION_BASE_URL: 'http://127.0.0.1:11432',
            FUSION_AUTH_TOKEN: 'test-token',
        },
    });
    void new Response(serverProc.stderr).text().then((t) => {
        serverStderr = t;
    });
    await waitReady();
});

afterAll(() => {
    serverProc?.kill();
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('workflow command registry (#241)', () => {
    test('GET /api/commands returns categorized prompt templates', async () => {
        const res = await fetch(`http://127.0.0.1:${PORT}/api/commands`);
        expect(res.status).toBe(200);
        const { commands } = (await res.json()) as {
            commands: { name: string; category: string; prompt: string; descriptionEn: string; descriptionZh: string }[];
        };
        expect(commands.length).toBeGreaterThanOrEqual(10);
        const names = new Set(commands.map((c) => c.name));
        expect(names.has('plan')).toBe(true);
        expect(names.has('security-review')).toBe(true);
        for (const cmd of commands) {
            expect(cmd.prompt.length).toBeGreaterThan(20);
            expect(cmd.descriptionEn.length).toBeGreaterThan(5);
            expect(cmd.descriptionZh.length).toBeGreaterThan(2);
        }
    });
});

describe('session transcript export (#241)', () => {
    test('export before any run returns 404', async () => {
        const repoRes = await fetch(`http://127.0.0.1:${PORT}/api/repos`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: tempDirs[0], name: 'cmd-demo' }),
        });
        expect(repoRes.status).toBe(200);
        const { repo } = (await repoRes.json()) as { repo: { id: string } };
        repoId = repo.id;

        const sessionRes = await fetch(`http://127.0.0.1:${PORT}/api/sessions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'cmd task', repoId, branch: 'main' }),
        });
        expect(sessionRes.status).toBe(200);
        const { session } = (await sessionRes.json()) as { session: { id: string } };
        sessionId = session.id;

        const res = await fetch(`http://127.0.0.1:${PORT}/api/sessions/${sessionId}/export`);
        expect(res.status).toBe(404);
    });

    test('export after transcript exists returns markdown attachment', async () => {
        // Run the mock kernel so the session links a kernelSessionId.
        const runRes = await fetch(`http://127.0.0.1:${PORT}/api/sessions/${sessionId}/run`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ message: 'Fix the bug.' }),
        });
        expect(runRes.status).toBe(200);

        // Wait for the kernel run to finish so kernelSessionId is linked.
        const deadline = Date.now() + 10_000;
        for (;;) {
            const detailRes = await fetch(`http://127.0.0.1:${PORT}/api/sessions/${sessionId}`);
            const detail = (await detailRes.json()) as { session: { status: string; kernelSessionId?: string } };
            if (detail.session.status === 'idle' && detail.session.kernelSessionId) break;
            if (Date.now() > deadline) throw new Error('run never went idle');
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Mock kernel does not write a transcript file — plant one where
        // projectsDir()/findSessionFile looks (config dir from server env).
        const configDir = tempDirs[2];
        const slug = tempDirs[0].replace(/[^a-zA-Z0-9]/g, '-');
        const projectDir = join(configDir, 'projects', slug);
        mkdirSync(projectDir, { recursive: true });
        const kernelSessionId = '11111111-2222-3333-4444-555555555555';
        const transcript = [
            JSON.stringify({ type: 'user', message: { role: 'user', content: 'Fix the bug and add tests.' } }),
            JSON.stringify({
                type: 'assistant',
                message: { role: 'assistant', content: [{ type: 'text', text: 'Plan: fix then test.' }] },
            }),
        ];
        writeFileSync(join(projectDir, `${kernelSessionId}.jsonl`), transcript.join('\n') + '\n');

        const res = await fetch(`http://127.0.0.1:${PORT}/api/sessions/${sessionId}/export`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/markdown');
        expect(res.headers.get('content-disposition')).toContain('attachment');
        const md = await res.text();
        expect(md).toContain('# Session transcript');
        expect(md).toContain('Fix the bug and add tests.');
        expect(md).toContain('Plan: fix then test.');
    });
});
