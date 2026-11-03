import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FileChange, UsageRepoRow, UsageSessionRow, UsageSummary } from '../shared/types';
import { bindHost, log, logWarn, webPort } from './config';
import { startDesignSync, stopDesignSync } from './designSync';
import { startGatewayRegistration, stopGatewayRegistration } from './gateway';
import {
    createPullRequest,
    currentBranch,
    fileChanges,
    fileDiff,
    isGitRepo,
    listBranches,
    repoOriginUrl,
    runVerifyCommand,
} from './gitRepo';
import {
    bufferedEvents,
    cleanupSessionWorktree,
    isRunning,
    readHistory,
    rollbackToCheckpoint,
    sessionCwd,
    startRun,
    subscribe,
} from './runner';
import { serveStatic } from './static';
import * as store from './store';

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
    try {
        return (await req.json()) as Record<string, unknown>;
    } catch {
        return {};
    }
}

type WsSessionData = {
    sessionId: string;
    unsubscribe: (() => void) | null;
};

async function handleApi(req: Request, url: URL): Promise<Response | null> {
    const { pathname } = url;
    const method = req.method;

    // ---- health ----
    // #234 P2: both shapes — direct probes use /health; gateway-based probes
    // hit /api/health (previously 404 there).
    if (pathname === '/health' || pathname === '/api/health') {
        return json({ ok: true, module: 'fusion-code-web', version: '0.1.0' });
    }

    // ---- repos ----
    if (pathname === '/api/repos' && method === 'GET') {
        return json({ repos: store.listRepos() });
    }
    if (pathname === '/api/repos' && method === 'POST') {
        const body = await readBody(req);
        const path = String(body.path ?? '').trim();
        const gitUrl = String(body.gitUrl ?? '').trim();
        let repoPath = path;
        if (!repoPath && gitUrl) {
            const name = String(
                body.name ??
                    gitUrl
                        .split('/')
                        .pop()
                        ?.replace(/\.git$/, '') ??
                    'repo'
            );
            repoPath = join(process.env.FUSION_CODE_WEB_CLONE_DIR ?? `${process.env.HOME}/fusion-code-repos`, name);
            if (!existsSync(repoPath)) {
                const { cloneRepo } = await import('./gitRepo');
                const result = await cloneRepo(gitUrl, repoPath);
                if (!result.ok) {
                    return json({ error: `clone failed: ${result.stderr.slice(0, 500)}` }, 400);
                }
            }
        }
        if (!repoPath) {
            return json({ error: 'path or gitUrl required' }, 400);
        }
        if (!existsSync(repoPath)) {
            return json({ error: `path does not exist: ${repoPath}` }, 400);
        }
        if (!(await isGitRepo(repoPath))) {
            return json({ error: `not a git repository: ${repoPath}` }, 400);
        }
        const name = String(body.name ?? repoPath.split('/').pop() ?? 'repo');
        const originUrl = await repoOriginUrl(repoPath);
        const repo = store.addRepo({
            name,
            path: repoPath,
            originUrl,
            environment: String(body.environment ?? 'default'),
        });
        return json({ repo });
    }
    const repoMatch = pathname.match(/^\/api\/repos\/([^/]+)(?:\/(.*))?$/);
    if (repoMatch) {
        const repo = store.getRepo(repoMatch[1]);
        if (!repo) return json({ error: 'repo not found' }, 404);
        const sub = repoMatch[2] ?? '';
        if (sub === 'branches' && method === 'GET') {
            return json({ branches: await listBranches(repo.path), current: await currentBranch(repo.path) });
        }
        if (sub === 'changes' && method === 'GET') {
            return json({ files: await fileChanges(repo.path) });
        }
        // v2 environment templates: run the repo's setup command on demand.
        if (sub === 'setup' && method === 'POST') {
            if (!repo.setupCommand || !repo.setupCommand.trim()) {
                return json({ error: 'no setup command configured for this repo' }, 400);
            }
            const result = await runVerifyCommand(repo.path, repo.setupCommand.trim(), 600_000, 'setup');
            const updated = store.markRepoSetup(repo.id, result.ok, result.output);
            log(`repo setup: id=${repo.id} ok=${result.ok}`);
            return json({ ok: result.ok, output: result.output, repo: updated });
        }
        if (sub === '' && method === 'DELETE') {
            // Best-effort cleanup of isolated worktrees owned by this repo's sessions.
            for (const sess of store.listSessions()) {
                if (sess.repoId !== repo.id) continue;
                cleanupSessionWorktree(sess, repo);
            }
            return store.removeRepo(repo.id) ? json({ ok: true }) : json({ error: 'repo not found' }, 404);
        }
        if (sub === '' && method === 'GET') {
            return json({ repo, branches: await listBranches(repo.path), current: await currentBranch(repo.path) });
        }
        if (sub === '' && method === 'PATCH') {
            const body = await readBody(req);
            const updated = store.updateRepo(repo.id, {
                name: body.name !== undefined ? String(body.name) : undefined,
                testCommand: body.testCommand !== undefined ? String(body.testCommand) : undefined,
                environment: body.environment !== undefined ? String(body.environment) : undefined,
                setupCommand: body.setupCommand !== undefined ? String(body.setupCommand) : undefined,
            });
            return json({ repo: updated });
        }
    }

    // ---- global default permissions (new sessions) ----
    if (pathname === '/api/permissions/default' && method === 'GET') {
        return json({ permissions: store.getDefaultPermissions() });
    }
    if (pathname === '/api/permissions/default' && method === 'POST') {
        const body = await readBody(req);
        const mode = body.mode === 'ask' ? 'ask' : 'allowlist';
        const tools = Array.isArray(body.allowedTools) ? body.allowedTools.map(String) : [];
        return json({ permissions: store.setDefaultPermissions(mode, tools) });
    }

    // ---- sessions ----
    if (pathname === '/api/sessions' && method === 'GET') {
        return json({ sessions: store.listSessions() });
    }
    if (pathname === '/api/sessions' && method === 'POST') {
        const body = await readBody(req);
        const repoId = String(body.repoId ?? '');
        const title = String(body.title ?? '').trim();
        // #234 P2: absent/invalid input is a 400 with a field-located
        // message, not a bare 404 'repo not found'.
        if (!repoId) return json({ error: 'repoId required', field: 'repoId' }, 400);
        if (!store.getRepo(repoId)) {
            const valid =
                store
                    .listRepos()
                    .map((r) => `${r.name} (${r.id})`)
                    .join(', ') || 'none — connect a repo first';
            return json({ error: `repoId does not exist: ${repoId} — valid repos: ${valid}`, field: 'repoId' }, 400);
        }
        if (!title) return json({ error: 'title required' }, 400);
        const session = store.createSession({
            title,
            repoId,
            branch: String(body.branch ?? 'main'),
            environment: String(body.environment ?? 'default'),
            isolateWorktree: body.isolateWorktree === true,
        });
        return json({ session });
    }
    const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(.*))?$/);
    if (sessionMatch) {
        const session = store.getSession(sessionMatch[1]) ?? store.getSessionByKernelId(sessionMatch[1]);
        if (!session) return json({ error: 'session not found' }, 404);
        const sub = sessionMatch[2] ?? '';
        // #237: isolated-worktree sessions surface all repo operations against
        // the dedicated worktree, not the repo checkout.
        const repo = store.getRepo(session.repoId);
        const cwd = repo ? sessionCwd(session, repo) : '';
        if (sub === '' && method === 'GET') {
            const history = session.kernelSessionId && repo ? readHistory(session.kernelSessionId, cwd) : [];
            return json({
                session,
                running: isRunning(session.id),
                events: bufferedEvents(session.id),
                history,
                changes: repo ? await fileChanges(cwd) : [],
            });
        }
        if (sub === 'permissions' && method === 'GET') {
            return json({ permissions: store.getPermissions(session.id) });
        }
        if (sub === 'permissions' && method === 'POST') {
            const body = await readBody(req);
            const mode = body.mode === 'ask' ? 'ask' : 'allowlist';
            const tools = Array.isArray(body.allowedTools) ? body.allowedTools.map(String) : [];
            return json({ permissions: store.setPermissions(session.id, mode, tools) });
        }
        if (sub === 'run' && method === 'POST') {
            const body = await readBody(req);
            const message = String(body.message ?? '').trim();
            if (!message) return json({ error: 'message required' }, 400);
            const result = await startRun({
                sessionId: session.id,
                message,
                model: body.model ? String(body.model) : undefined,
            });
            return result.ok ? json({ ok: true }) : json({ error: result.error }, result.alreadyRunning ? 409 : 400);
        }
        // #229: unified diff for one changed file in the session's repo.
        if (sub === 'diff' && method === 'GET') {
            if (!repo) return json({ error: 'repo not found' }, 404);
            const filePath = url.searchParams.get('path') ?? '';
            if (!filePath) return json({ error: 'path query param required' }, 400);
            return json({ path: filePath, diff: await fileDiff(cwd, filePath) });
        }
        // #237: inline diff comments.
        if (sub === 'comments' && method === 'GET') {
            return json({ comments: store.listDiffComments(session.id) });
        }
        if (sub === 'comments' && method === 'POST') {
            const body = await readBody(req);
            const path = String(body.path ?? '').trim();
            const text = String(body.text ?? '').trim();
            const line = Number(body.line ?? 0);
            if (!path) return json({ error: 'path required', field: 'path' }, 400);
            if (!text) return json({ error: 'text required', field: 'text' }, 400);
            if (!Number.isInteger(line) || line < 1) {
                return json({ error: 'line must be a positive integer (1-based diff line)', field: 'line' }, 400);
            }
            return json({ comment: store.addDiffComment(session.id, { path, line, text }) });
        }
        // #236: checkpoint list — enumerate captured checkpoints for the session.
        if (sub === 'checkpoints' && method === 'GET') {
            return json({ checkpoints: session.checkpoints ?? [] });
        }
        // #229: checkpoint verify — run the repo's testCommand.
        const cpVerify = sub.match(/^checkpoints\/([^/]+)\/verify$/);
        if (cpVerify && method === 'POST') {
            const repo = store.getRepo(session.repoId);
            if (!repo) return json({ error: 'repo not found' }, 404);
            const cp = session.checkpoints?.find((c) => c.messageUuid === cpVerify[1]);
            if (!cp) return json({ error: 'checkpoint not found' }, 404);
            if (!repo.testCommand) return json({ error: 'no test command configured for this repo' }, 400);
            const result = await runVerifyCommand(cwd, repo.testCommand);
            store.markCheckpointVerified(session.id, cpVerify[1], result.ok, result.output);
            log(`checkpoint verify: session=${session.id} cp=${cpVerify[1]} ok=${result.ok}`);
            return json({
                ok: result.ok,
                output: result.output,
                checkpoint: store.getSession(session.id)?.checkpoints?.find((c) => c.messageUuid === cpVerify[1]),
            });
        }
        // #229: checkpoint rollback — kernel --rewind-files restore.
        const cpRollback = sub.match(/^checkpoints\/([^/]+)\/rollback$/);
        if (cpRollback && method === 'POST') {
            const cp = session.checkpoints?.find((c) => c.messageUuid === cpRollback[1]);
            if (!cp) return json({ error: 'checkpoint not found' }, 404);
            const result = await rollbackToCheckpoint(session.id, cpRollback[1]);
            return result.ok ? json({ ok: true }) : json({ error: result.error }, 400);
        }
        // #229: PR flow — branch + commit + push + gh pr create.
        if (sub === 'pr' && method === 'POST') {
            const repo = store.getRepo(session.repoId);
            if (!repo) return json({ error: 'repo not found' }, 404);
            if (isRunning(session.id)) return json({ error: 'a run is active; wait for it to finish' }, 409);
            const body = await readBody(req);
            const title = String(body.title ?? session.title).trim();
            if (!title) return json({ error: 'title required' }, 400);
            const branch = session.prBranch ?? `fusion-code/web-${session.id.slice(0, 8)}`;
            const result = await createPullRequest(cwd, {
                title,
                body: String(body.body ?? `Changes from web session ${session.title}`),
                branch,
            });
            if (!result.ok) return json({ error: result.error }, 400);
            store.setSessionPr(session.id, result.url ?? '', result.branch);
            return json({ ok: true, url: result.url, branch: result.branch });
        }
    }

    // ---- usage (#230) ----
    if (pathname === '/api/usage' && method === 'GET') {
        const repos = new Map(store.listRepos().map((r) => [r.id, r.name]));
        const byRepoMap = new Map<string, UsageRepoRow>();
        const bySession: UsageSessionRow[] = [];
        let totalCostUsd = 0;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalTurns = 0;
        for (const sess of store.listSessions()) {
            const turns = sess.usage?.length ?? 0;
            if (turns === 0) continue;
            const costUsd = sess.usage?.reduce((sum, u) => sum + u.costUsd, 0) ?? 0;
            const inputTokens = sess.usage?.reduce((sum, u) => sum + u.inputTokens, 0) ?? 0;
            const outputTokens = sess.usage?.reduce((sum, u) => sum + u.outputTokens, 0) ?? 0;
            const repoName = repos.get(sess.repoId) ?? 'unknown';
            totalCostUsd += costUsd;
            totalInputTokens += inputTokens;
            totalOutputTokens += outputTokens;
            totalTurns += turns;
            const repoRow = byRepoMap.get(sess.repoId);
            if (repoRow) {
                repoRow.sessions += 1;
                repoRow.costUsd += costUsd;
                repoRow.inputTokens += inputTokens;
                repoRow.outputTokens += outputTokens;
            } else {
                byRepoMap.set(sess.repoId, {
                    repoId: sess.repoId,
                    repoName,
                    sessions: 1,
                    costUsd,
                    inputTokens,
                    outputTokens,
                });
            }
            bySession.push({
                sessionId: sess.id,
                title: sess.title,
                repoName,
                turns,
                costUsd,
                inputTokens,
                outputTokens,
                updatedAt: sess.updatedAt,
            });
        }
        const summary: UsageSummary = {
            totalCostUsd,
            totalInputTokens,
            totalOutputTokens,
            totalTurns,
            byRepo: [...byRepoMap.values()].sort((a, b) => b.costUsd - a.costUsd),
            bySession: bySession.sort((a, b) => b.costUsd - a.costUsd),
        };
        return json(summary);
    }

    return null;
}

const server = Bun.serve<WsSessionData>({
    port: webPort(),
    hostname: bindHost(),
    async fetch(req, serverRef) {
        const url = new URL(req.url);
        if (url.pathname.startsWith('/api/') || url.pathname === '/health' || url.pathname === '/manifest.json') {
            if (url.pathname === '/manifest.json') {
                const { manifestJson } = await import('./gateway');
                return new Response(manifestJson(), { headers: { 'content-type': 'application/json' } });
            }
            return handleApi(req, url)
                .then((res) => res ?? json({ error: 'not found' }, 404))
                .catch((err) => {
                    logWarn(`api error ${url.pathname}: ${err}`);
                    return json({ error: String(err) }, 500);
                });
        }
        if (url.pathname.startsWith('/ws/')) {
            const sessionId = url.pathname.slice('/ws/'.length);
            if (serverRef.upgrade(req, { data: { sessionId, unsubscribe: null } })) {
                return undefined as unknown as Response;
            }
            return json({ error: 'upgrade failed' }, 400);
        }
        // Static SPA (hash router — everything falls back to index.html).
        const staticRes = serveStatic(url.pathname.replace(/^\/+/, ''));
        if (staticRes) return staticRes;
        return new Response('not found', { status: 404 });
    },
    websocket: {
        open(ws) {
            const { sessionId } = ws.data;
            log(`ws open: session=${sessionId}`);
            const unsubscribe = subscribe(sessionId, (event) => {
                ws.send(JSON.stringify({ type: 'event', event }));
            });
            ws.data.unsubscribe = unsubscribe;
            // Backlog replay so a reconnecting browser catches up.
            for (const event of bufferedEvents(sessionId)) {
                ws.send(JSON.stringify({ type: 'event', event }));
            }
            ws.send(
                JSON.stringify({
                    type: 'hello',
                    running: isRunning(sessionId),
                    files: [] as FileChange[],
                })
            );
        },
        message(ws, messageRaw) {
            const { sessionId } = ws.data;
            try {
                const data = JSON.parse(String(messageRaw)) as Record<string, unknown>;
                if (data.type === 'send') {
                    void startRun({ sessionId, message: String(data.message ?? '') }).then((result) => {
                        if (!result.ok) {
                            ws.send(JSON.stringify({ type: 'error', error: result.error }));
                        }
                    });
                } else if (data.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong', running: isRunning(sessionId) }));
                }
            } catch (err) {
                logWarn(`ws message error: ${err}`);
            }
        },
        close(ws) {
            // Server-owned runs keep going; only detach this browser.
            ws.data.unsubscribe?.();
            log(`ws close: session=${ws.data.sessionId}`);
        },
    },
});

log(`listening on http://${bindHost()}:${server.port}`);
startGatewayRegistration();
startDesignSync();

process.on('SIGINT', () => {
    log('shutting down');
    stopGatewayRegistration();
    stopDesignSync();
    server.stop(true);
    process.exit(0);
});
process.on('SIGTERM', () => {
    stopGatewayRegistration();
    stopDesignSync();
    server.stop(true);
    process.exit(0);
});
