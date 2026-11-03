import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Full-stack smoke test: spawn server/index.ts as a subprocess (own port +
// data dir + mock kernel), then exercise the HTTP API and the session WS —
// health, repo connect, session create, run start, live events + backlog
// replay through the same wire the browser uses.

const PORT = 11590;
const tempDirs: string[] = [];
let serverProc: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | null = null;
let serverStderr = '';

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
    const repoDir = mkdtempSync(join(tmpdir(), 'fcweb-http-repo-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'fcweb-http-data-'));
    tempDirs.push(repoDir, dataDir);
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

describe('http + ws stack', () => {
    test('health endpoint', async () => {
        const res = await fetch(`http://127.0.0.1:${PORT}/health`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { ok: boolean; module: string };
        expect(body.ok).toBe(true);
        expect(body.module).toBe('fusion-code-web');
    });

    test('manifest endpoint serves manifest.json', async () => {
        const res = await fetch(`http://127.0.0.1:${PORT}/manifest.json`);
        expect(res.status).toBe(200);
        const manifest = (await res.json()) as { id: string; upstream: string };
        expect(manifest.id).toBe('fusion-code');
        expect(manifest.upstream).toBe('http://127.0.0.1:11482');
    });

    test('UC-C1 steps 2-5 over the wire: connect repo, new session, run, see steps + changes', async () => {
        // Step 2: connect repo
        const repoRes = await fetch(`http://127.0.0.1:${PORT}/api/repos`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: tempDirs[0], name: 'http-demo' }),
        });
        expect(repoRes.status).toBe(200);
        const { repo } = (await repoRes.json()) as { repo: { id: string } };

        // Step 3: branches
        const branchRes = await fetch(`http://127.0.0.1:${PORT}/api/repos/${repo.id}/branches`);
        const { branches, current } = (await branchRes.json()) as { branches: { name: string }[]; current: string };
        expect(current).toBe('main');
        expect(branches.length).toBe(1);

        // Step 3: new session with repo/branch selector
        const sessionRes = await fetch(`http://127.0.0.1:${PORT}/api/sessions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'fix login timeout', repoId: repo.id, branch: 'main' }),
        });
        expect(sessionRes.status).toBe(200);
        const { session } = (await sessionRes.json()) as { session: { id: string } };

        // Permissions: allowlist mode with Bash
        const permRes = await fetch(`http://127.0.0.1:${PORT}/api/sessions/${session.id}/permissions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'allowlist', allowedTools: ['Read', 'Bash'] }),
        });
        const { permissions } = (await permRes.json()) as { permissions: { allowedTools: string[] } };
        expect(permissions.allowedTools).toEqual(['Read', 'Bash']);

        // Step 4/5: start run, watch events over WS
        const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/${session.id}`);
        const events: string[] = [];
        const wsOpen = new Promise<void>((resolve) => {
            ws.onopen = () => resolve();
        });
        ws.onmessage = (raw) => {
            const msg = JSON.parse(String(raw.data)) as { type: string; event?: { kind: string } };
            if (msg.type === 'event' && msg.event) events.push(msg.event.kind);
        };
        await wsOpen;

        const runRes = await fetch(`http://127.0.0.1:${PORT}/api/sessions/${session.id}/run`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ message: 'Fix the login timeout and add tests.' }),
        });
        expect(runRes.status).toBe(200);

        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
            if (events.includes('turn_completed') && events.includes('file_changes')) break;
            await new Promise((r) => setTimeout(r, 100));
        }
        ws.close();
        expect(events).toContain('assistant_text');
        expect(events).toContain('tool_use');
        expect(events).toContain('tool_result');
        expect(events).toContain('turn_completed');
        expect(events).toContain('file_changes');

        // Session detail now carries history + kernel link
        const detailRes = await fetch(`http://127.0.0.1:${PORT}/api/sessions/${session.id}`);
        const detail = (await detailRes.json()) as {
            session: { kernelSessionId?: string; status: string };
            events: { kind: string }[];
            history: { role: string }[];
        };
        expect(detail.session.kernelSessionId).toBe('11111111-2222-3333-4444-555555555555');
        expect(detail.session.status).toBe('idle');
        expect(detail.events.length).toBeGreaterThan(0);
    }, 20_000);

    test('#229/#230: diff + verify + usage endpoints over the wire', async () => {
        // Repo + session exist from the previous test (same server, same data
        // dir) — look them up.
        const reposRes = await fetch(`http://127.0.0.1:${PORT}/api/repos`);
        const { repos } = (await reposRes.json()) as { repos: { id: string; path: string }[] };
        const repo = repos[0];
        const sessionsRes = await fetch(`http://127.0.0.1:${PORT}/api/sessions`);
        const { sessions } = (await sessionsRes.json()) as { sessions: { id: string }[] };
        const sessionId = sessions[0].id;

        // PATCH repo testCommand.
        const patchRes = await fetch(`http://127.0.0.1:${PORT}/api/repos/${repo.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ testCommand: 'echo wire-verify-ok' }),
        });
        expect(patchRes.status).toBe(200);
        const { repo: updated } = (await patchRes.json()) as { repo: { testCommand?: string } };
        expect(updated.testCommand).toBe('echo wire-verify-ok');

        // Modify a tracked file, then GET the diff.
        writeFileSync(join(tempDirs[0], 'a.txt'), 'hello\nworld\n');
        const diffRes = await fetch(
            `http://127.0.0.1:${PORT}/api/sessions/${sessionId}/diff?path=${encodeURIComponent('a.txt')}`
        );
        expect(diffRes.status).toBe(200);
        const { diff } = (await diffRes.json()) as { diff: string };
        expect(diff).toContain('+world');

        // Verify runs the repo testCommand and stamps the checkpoint.
        const detailRes = await fetch(`http://127.0.0.1:${PORT}/api/sessions/${sessionId}`);
        const detail = (await detailRes.json()) as {
            session: { checkpoints?: { messageUuid: string }[] };
        };
        expect(detail.session.checkpoints?.length).toBe(1);
        const cpUuid = detail.session.checkpoints![0].messageUuid;
        const verifyRes = await fetch(
            `http://127.0.0.1:${PORT}/api/sessions/${sessionId}/checkpoints/${cpUuid}/verify`,
            { method: 'POST' }
        );
        expect(verifyRes.status).toBe(200);
        const verifyBody = (await verifyRes.json()) as {
            ok: boolean;
            checkpoint: { verified?: { ok: boolean; output?: string } };
        };
        expect(verifyBody.ok).toBe(true);
        expect(verifyBody.checkpoint.verified?.output).toContain('wire-verify-ok');

        // Usage aggregated from the mock kernel result message.
        const usageRes = await fetch(`http://127.0.0.1:${PORT}/api/usage`);
        expect(usageRes.status).toBe(200);
        const usage = (await usageRes.json()) as {
            totalTurns: number;
            totalInputTokens: number;
            totalCostUsd: number;
            bySession: { turns: number; costUsd: number }[];
        };
        expect(usage.totalTurns).toBeGreaterThanOrEqual(1);
        expect(usage.totalInputTokens).toBeGreaterThanOrEqual(1200);
        expect(usage.totalCostUsd).toBeGreaterThanOrEqual(0.01);
        expect(usage.bySession.length).toBeGreaterThanOrEqual(1);

        // Rollback before a kernel session exists is rejected cleanly.
        const rbRes = await fetch(`http://127.0.0.1:${PORT}/api/sessions/${sessionId}/checkpoints/${cpUuid}/rollback`, {
            method: 'POST',
        });
        // Session HAS a kernel id here, so the mock kernel runs and exits 0.
        expect(rbRes.status).toBe(200);

        // #236: checkpoint list endpoint enumerates captured checkpoints.
        const listRes = await fetch(`http://127.0.0.1:${PORT}/api/sessions/${sessionId}/checkpoints`);
        expect(listRes.status).toBe(200);
        const list = (await listRes.json()) as { checkpoints: { messageUuid: string }[] };
        expect(list.checkpoints.length).toBe(1);
        expect(list.checkpoints[0].messageUuid).toBe(cpUuid);
    }, 20_000);

    test('#239/#237: repoId error contract + inline diff comments over the wire', async () => {
        // #239: nonexistent repoId → 400 with the valid ids listed.
        const badRepo = await fetch(`http://127.0.0.1:${PORT}/api/sessions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'x', repoId: 'no-such-repo', branch: 'main' }),
        });
        expect(badRepo.status).toBe(400);
        const badRepoBody = (await badRepo.json()) as { error: string; field?: string };
        expect(badRepoBody.field).toBe('repoId');
        expect(badRepoBody.error).toContain('valid repos');

        // Session for the comment routes.
        const reposRes = await fetch(`http://127.0.0.1:${PORT}/api/repos`);
        const { repos } = (await reposRes.json()) as { repos: { id: string }[] };
        const sessRes = await fetch(`http://127.0.0.1:${PORT}/api/sessions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'comments-e2e', repoId: repos[0].id, branch: 'main' }),
        });
        const { session } = (await sessRes.json()) as { session: { id: string } };
        const base = `http://127.0.0.1:${PORT}/api/sessions/${session.id}`;

        // #237: validation — bad line / missing text are field-located 400s.
        const badLine = await fetch(`${base}/comments`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: 'a.txt', line: 0, text: 'x' }),
        });
        expect(badLine.status).toBe(400);
        expect(((await badLine.json()) as { field?: string }).field).toBe('line');
        const noText = await fetch(`${base}/comments`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: 'a.txt', line: 2 }),
        });
        expect(noText.status).toBe(400);
        expect(((await noText.json()) as { field?: string }).field).toBe('text');

        // Valid comment lands and lists back.
        const okRes = await fetch(`${base}/comments`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: 'a.txt', line: 2, text: 'rename this var' }),
        });
        expect(okRes.status).toBe(200);
        const { comment } = (await okRes.json()) as {
            comment: { id: string; path: string; line: number; text: string };
        };
        expect(comment.line).toBe(2);
        expect(comment.text).toBe('rename this var');
        const listRes = await fetch(`${base}/comments`);
        const { comments } = (await listRes.json()) as { comments: { id: string }[] };
        expect(comments.some((c) => c.id === comment.id)).toBe(true);
    }, 20_000);
});
