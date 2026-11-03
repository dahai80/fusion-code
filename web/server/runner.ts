import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { FileChange, HistoryMessage, SessionEvent, SessionEventBody, WebSession } from '../shared/types';
import { log, logWarn } from './config';
import { fileChanges } from './gitRepo';
import {
    addCheckpoint,
    addTurnUsage,
    getPermissions,
    getRepo,
    getSession,
    getSessionByKernelId,
    setSessionKernelId,
    upsertSession,
} from './store';

// Kernel orchestration. One run per session at a time; runs are owned by the
// SERVER (keyed by session id), so a browser disconnect does NOT kill a run —
// events buffer in a per-session ring and replay on WS reconnect.

const MAX_BUFFERED_EVENTS = 1000;

type RunState = {
    proc: ReturnType<typeof Bun.spawn> | null;
    buffer: SessionEvent[];
    subscribers: Set<(event: SessionEvent) => void>;
    seq: number;
    startedAt: number;
};

const runs = new Map<string, RunState>();

// Session ids are unstable across the first run: a session starts as
// "pending:<uuid>" and is renamed to the kernel session id when the kernel
// reports it. Normalize every lookup through the store so buffers, runs and
// subscribers keyed before the rename stay reachable after it.
function resolveSessionId(sessionId: string): string {
    return getSession(sessionId)?.id ?? getSessionByKernelId(sessionId)?.id ?? sessionId;
}

export function runState(sessionId: string): RunState {
    const key = resolveSessionId(sessionId);
    let state = runs.get(key);
    if (!state) {
        state = { proc: null, buffer: [], subscribers: new Set(), seq: 0, startedAt: 0 };
        runs.set(key, state);
    }
    return state;
}

export function isRunning(sessionId: string): boolean {
    return (runs.get(sessionId)?.proc ?? null) !== null;
}

function emit(sessionId: string, event: SessionEventBody): void {
    const state = runState(sessionId);
    const full = { ...event, seq: ++state.seq } as SessionEvent;
    state.buffer.push(full);
    if (state.buffer.length > MAX_BUFFERED_EVENTS) {
        state.buffer.splice(0, state.buffer.length - MAX_BUFFERED_EVENTS);
    }
    for (const sub of state.subscribers) {
        try {
            sub(full);
        } catch (err) {
            logWarn(`subscriber push failed: ${err}`);
        }
    }
}

export function subscribe(sessionId: string, fn: (event: SessionEvent) => void): () => void {
    const state = runState(sessionId);
    state.subscribers.add(fn);
    return () => state.subscribers.delete(fn);
}

export function bufferedEvents(sessionId: string): SessionEvent[] {
    return [...runState(sessionId).buffer];
}

// Command prefix for the kernel. FUSION_CODE_WEB_KERNEL_BIN may be a full
// command ("bun path/to/mock.ts") — split on spaces for argv-safe spawn.
function kernelCommand(): string[] {
    const envBin = process.env.FUSION_CODE_WEB_KERNEL_BIN;
    if (envBin) return envBin.split(/\s+/).filter(Boolean);
    const webDir = import.meta.dir;
    const candidates = [
        resolve(webDir, '../../fusion-code'),
        resolve(webDir, '../../fusion-code-dev'),
        resolve(process.cwd(), 'fusion-code'),
        resolve(process.cwd(), 'fusion-code-dev'),
    ];
    for (const c of candidates) {
        if (existsSync(c)) {
            return [c];
        }
    }
    return ['fusion-code'];
}

// Turn the kernel's stream-json tool_use/tool_result payloads into compact
// display strings.
function toolDisplay(input: Record<string, unknown> | undefined): string {
    if (!input) return '';
    const cmd = input.command ?? input.file_path ?? input.pattern ?? input.url ?? input.path;
    return typeof cmd === 'string' ? cmd : JSON.stringify(input).slice(0, 200);
}

function resultText(content: unknown): string {
    if (typeof content === 'string') return content.slice(0, 2000);
    if (Array.isArray(content)) {
        return content
            .map((block) => {
                if (typeof block === 'string') return block;
                if (block && typeof block === 'object' && 'text' in block) {
                    return String((block as { text: unknown }).text);
                }
                return '';
            })
            .filter(Boolean)
            .join('\n')
            .slice(0, 2000);
    }
    return '';
}

export type StartRunInput = {
    sessionId: string;
    message: string;
    model?: string;
};

export type StartRunResult = { ok: boolean; error?: string; alreadyRunning?: boolean };

// #234 P1: spawn-time environment hygiene. The web server process may be
// started bare (`bun run server/index.ts`) without the supervisor env file —
// then spawned kernel processes have no FUSION_BASE_URL / auth token and the
// LLM call fails mid-turn with an opaque 403. Resolve auth from an optional
// env file (the same one start.sh sources) plus process.env, and fail fast
// BEFORE spawn with a structured error when auth is still missing.

function webEnvFile(): string {
    return process.env.FUSION_CODE_WEB_ENV_FILE ?? join(homedir(), '.fusion-code', 'web.env');
}

// Parse KEY=VALUE lines (ignores comments/blank lines, strips one pair of
// surrounding quotes). Malformed lines are skipped, not fatal.
function parseEnvFile(path: string): Record<string, string> {
    const out: Record<string, string> = {};
    let raw = '';
    try {
        raw = readFileSync(path, 'utf-8');
    } catch {
        return out; // no env file — process.env only
    }
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (key) out[key] = value;
    }
    return out;
}

// Merged env for spawned kernel processes: server process env first, then the
// env file ON TOP (deliberate web env config wins — #236: supervisor-style
// ambient FUSION_AUTH_TOKEN/FUSION_BASE_URL in the server process env used to
// clobber the env file values and the spawned CLI died at LLM auth with 403),
// then the checkpointing opt-in.
export function kernelSpawnEnv(): Record<string, string> {
    return {
        ...process.env,
        ...parseEnvFile(webEnvFile()),
        FUSION_CODE_ENABLE_SDK_FILE_CHECKPOINTING: '1',
    } as Record<string, string>;
}

// Names the auth pieces missing from the resolved env — empty = spawn-safe.
export function missingAuthEnv(env: Record<string, string>): string[] {
    const missing: string[] = [];
    if (!env.FUSION_BASE_URL && !env.ANTHROPIC_BASE_URL) missing.push('FUSION_BASE_URL');
    if (!env.FUSION_AUTH_TOKEN && !env.FUSION_CLIENT_KEY && !env.ANTHROPIC_API_KEY) {
        missing.push('FUSION_AUTH_TOKEN (or FUSION_CLIENT_KEY)');
    }
    return missing;
}

// #234 P1: pre-spawn sanity checks — deleted workdir or missing binary used
// to surface as a raw ENOENT with no structured event.
export function precheckSpawn(repoPath: string, kernelCmd: string[]): string | null {
    try {
        if (!existsSync(repoPath) || !statSync(repoPath).isDirectory()) {
            return `repo worktree missing or not a directory: ${repoPath}`;
        }
    } catch {
        return `repo worktree missing: ${repoPath}`;
    }
    const bin = kernelCmd[0] ?? '';
    if (bin.includes('/') && !existsSync(bin)) {
        return `kernel binary not found: ${bin}`;
    }
    const missing = missingAuthEnv(kernelSpawnEnv());
    if (missing.length > 0) {
        return `kernel auth env missing: ${missing.join(', ')} — set them for the web server process or in ${webEnvFile()}`;
    }
    return null;
}

function failSpawn(sessionId: string, session: WebSession, reason: string): StartRunResult {
    session.status = 'error';
    session.errorText = reason;
    session.updatedAt = Date.now();
    upsertSession(session);
    emit(sessionId, { kind: 'turn_error', text: reason });
    logWarn(`spawn precheck failed: session=${sessionId} reason=${reason}`);
    return { ok: false, error: reason };
}

// #231: first-run prompt for design-handoff sessions — the design files are
// the source of truth, delivered once as inline context before the user's
// instruction. Exported for tests.
export function buildDesignPrompt(context: NonNullable<WebSession['designContext']>, message: string): string {
    const parts: string[] = [
        `[Design handoff from fusion-design] Component: ${context.component}`,
        '',
        'The following design files are the source of truth for this task. Implement them in this repo:',
        '',
    ];
    for (const file of context.files) {
        parts.push(`--- FILE: ${file.name} (${file.language}${file.truncated ? ', truncated' : ''}) ---`);
        parts.push(file.content);
        parts.push('--- END FILE ---');
        parts.push('');
    }
    parts.push('User instruction:');
    parts.push(message);
    return parts.join('\n');
}

export async function startRun(input: StartRunInput): Promise<StartRunResult> {
    const { sessionId, message } = input;
    const session = getSession(sessionId);
    if (!session) return { ok: false, error: 'session not found' };
    const repo = getRepo(session.repoId);
    if (!repo) return { ok: false, error: 'repo not found' };
    if (isRunning(sessionId))
        return { ok: false, error: 'a run is already active for this session', alreadyRunning: true };

    // #234 P1: fail fast with a structured turn_error instead of a raw
    // ENOENT mid-turn.
    const kernelCmd = kernelCommand();
    const precheckError = precheckSpawn(repo.path, kernelCmd);
    if (precheckError) return failSpawn(sessionId, session, precheckError);

    const perms = getPermissions(sessionId);
    const kernelSessionId = session.kernelSessionId;

    // #231: design handoff — the first run of a design session gets the
    // design files inlined as context (delivered once, then designPending
    // clears so follow-up turns stay lean).
    let prompt = message;
    if (session.designPending && session.designContext && !kernelSessionId) {
        prompt = buildDesignPrompt(session.designContext, message);
        session.designPending = false;
        upsertSession(session);
        log(`design context delivered: session=${sessionId} component=${session.designContext.component}`);
    }

    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
    if (kernelSessionId) {
        args.push('--resume', kernelSessionId);
    }
    if (input.model) {
        args.push('--model', input.model);
    }
    if (perms.mode === 'allowlist' && perms.allowedTools.length > 0) {
        args.push('--allowedTools', perms.allowedTools.join(','));
    } else {
        // ask mode: read-only tools only; anything else gets denied by the
        // kernel and surfaces as a tool_result error the user can act on.
        args.push('--allowedTools', 'Read,Glob,Grep');
    }

    session.status = 'running';
    session.updatedAt = Date.now();
    upsertSession(session);

    log(`run start: session=${sessionId} kernel=${kernelCmd.join(' ')} args=${JSON.stringify(args)}`);
    emit(sessionId, { kind: 'turn_started', text: message });

    const state = runState(sessionId);
    state.startedAt = Date.now();

    const spawnAttempt = (() => {
        try {
            return {
                proc: Bun.spawn([...kernelCmd, ...args], {
                    stdout: 'pipe',
                    stderr: 'pipe',
                    cwd: repo.path,
                    env: kernelSpawnEnv(),
                }),
            } as const;
        } catch (err) {
            // Prechecks cover the known cases; this catches anything that
            // still slips through (permissions, exec format, ...).
            return { err } as const;
        }
    })();
    if ('err' in spawnAttempt) {
        return failSpawn(sessionId, session, `kernel spawn failed: ${spawnAttempt.err}`);
    }
    const proc = spawnAttempt.proc;
    state.proc = proc;

    // Drain stderr continuously — verbose kernel writes enough diagnostics to
    // fill the OS pipe buffer (~64KB) and deadlock stdout otherwise.
    const stderrReader = proc.stderr.getReader();
    const stderrDecoder = new TextDecoder();
    void (async () => {
        try {
            while (true) {
                const { done, value } = await stderrReader.read();
                if (done) break;
                for (const line of stderrDecoder.decode(value, { stream: true }).split('\n')) {
                    if (line.trim()) logWarn(`kernel stderr: ${line.slice(0, 300)}`);
                }
            }
        } catch {
            /* proc exited */
        }
    })();

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const startedAt = state.startedAt;
    const numTurns = 0;

    void (async () => {
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.trim()) continue;
                    handleKernelLine(sessionId, line);
                }
            }
            if (buffer.trim()) handleKernelLine(sessionId, buffer);
        } catch (err) {
            logWarn(`kernel stdout read failed: ${err}`);
        }

        const exitCode = await proc.exited;
        state.proc = null;
        const durationMs = Date.now() - startedAt;
        log(`run end: session=${sessionId} exit=${exitCode} duration=${durationMs}ms turns=${numTurns}`);

        const sawResult = state.buffer.some((e) => e.kind === 'turn_completed' || e.kind === 'turn_error');
        if (!sawResult) {
            emit(sessionId, {
                kind: 'turn_error',
                text: exitCode === 0 ? 'kernel exited without a result' : `kernel exited with code ${exitCode}`,
            });
        }

        // Post-turn file changes — the C2 right rail feed.
        try {
            const changes: FileChange[] = await fileChanges(repo.path);
            emit(sessionId, { kind: 'file_changes', files: changes });
        } catch (err) {
            logWarn(`fileChanges after run failed: ${err}`);
        }

        // #229: sync checkpoints from the kernel transcript after each turn.
        try {
            syncCheckpointsFromTranscript(sessionId, repo.path);
        } catch (err) {
            logWarn(`checkpoint sync after run failed: ${err}`);
        }

        // Idle LAST — after all post-turn events are buffered, so a client that
        // observes status=idle always already sees the complete event set.
        const fresh = getSession(sessionId);
        if (fresh) {
            fresh.status = exitCode === 0 ? 'idle' : 'error';
            fresh.updatedAt = Date.now();
            upsertSession(fresh);
        }
    })();

    return { ok: true };
}

function handleKernelLine(sessionId: string, line: string): void {
    let msg: Record<string, unknown>;
    try {
        msg = JSON.parse(line);
    } catch {
        logWarn(`unparseable kernel line: ${line.slice(0, 200)}`);
        return;
    }
    const type = msg.type as string;
    if (type === 'system' && msg.subtype === 'init') {
        const kernelId = msg.session_id as string | undefined;
        if (kernelId) setSessionKernelId(sessionId, kernelId);
        return;
    }
    if (type === 'assistant') {
        const message = msg.message as { content?: unknown[] } | undefined;
        const content = Array.isArray(message?.content) ? (message?.content as Record<string, unknown>[]) : [];
        for (const block of content) {
            if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
                emit(sessionId, { kind: 'assistant_text', text: block.text.slice(0, 4000) });
            }
            if (block.type === 'tool_use') {
                emit(sessionId, {
                    kind: 'tool_use',
                    toolName: String(block.name ?? 'tool'),
                    input: toolDisplay(block.input as Record<string, unknown> | undefined),
                });
            }
        }
        return;
    }
    if (type === 'user') {
        // tool_result blocks come back as user messages in stream-json.
        const message = msg.message as { content?: unknown } | undefined;
        const content = message?.content;
        const blocks = Array.isArray(content) ? (content as Record<string, unknown>[]) : [];
        let promptText = '';
        for (const block of blocks) {
            if (block.type === 'tool_result') {
                emit(sessionId, {
                    kind: 'tool_result',
                    toolName: String(block.toolUseResult ?? '') || 'tool',
                    content: resultText(block.content),
                    isError: block.is_error === true,
                });
            }
            if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
                promptText = block.text;
            }
        }
        // #229: a user text message = a prompt turn; the kernel snapshots
        // the worktree at prompt submit, so its uuid addresses a checkpoint.
        if (promptText && typeof msg.uuid === 'string') {
            addCheckpoint(sessionId, {
                messageUuid: msg.uuid,
                label: promptText.slice(0, 80),
                createdAt: Date.now(),
            });
        }
        return;
    }
    if (type === 'result') {
        const isError = msg.is_error === true;
        emit(sessionId, {
            kind: isError ? 'turn_error' : 'turn_completed',
            ...(isError
                ? { text: resultText(msg.result) || 'turn failed' }
                : {
                      is_error: false,
                      duration_ms: Number(msg.duration_ms) || 0,
                      num_turns: Number(msg.num_turns) || 0,
                  }),
        } as SessionEventBody);
        // #230: record per-turn usage for the /usage view.
        const usage = msg.usage as { input_tokens?: number; output_tokens?: number } | undefined;
        addTurnUsage(sessionId, {
            at: Date.now(),
            inputTokens: Number(usage?.input_tokens) || 0,
            outputTokens: Number(usage?.output_tokens) || 0,
            costUsd: Number(msg.total_cost_usd) || 0,
            durationMs: Number(msg.duration_ms) || 0,
            model: typeof msg.model === 'string' ? msg.model : undefined,
        });
    }
}

import { readFileSync, readdirSync, statSync } from 'node:fs';
// Light transcript reader for session history display (no kernel spawn).
// Walks the session JSONL and extracts user text / assistant text + tool
// names. Uses the CLI's own projects dir layout (~/.fusion-code/projects).
import { homedir } from 'node:os';

function projectsDir(): string {
    return process.env.FUSION_CODE_CONFIG_DIR
        ? join(process.env.FUSION_CODE_CONFIG_DIR, 'projects')
        : join(homedir(), '.fusion-code', 'projects');
}

export function findSessionFile(sessionId: string, repoPath: string): string | undefined {
    // Project dir slug mirrors the CLI's cwd-slug scheme: path with / and
    // other separators replaced by '-'.
    const slug = repoPath.replace(/[^a-zA-Z0-9]/g, '-');
    const projectDir = join(projectsDir(), slug);
    const direct = join(projectDir, `${sessionId}.jsonl`);
    if (existsSync(direct)) return direct;
    // Fallback: search all project dirs for the session file.
    try {
        for (const entry of readdirSync(projectsDir())) {
            const candidate = join(projectsDir(), entry, `${sessionId}.jsonl`);
            try {
                if (statSync(candidate).size > 0) return candidate;
            } catch {
                /* keep looking */
            }
        }
    } catch {
        /* projects dir missing */
    }
    return undefined;
}

export function readHistory(sessionId: string, repoPath: string, limit = 200): HistoryMessage[] {
    const file = findSessionFile(sessionId, repoPath);
    if (!file) return [];
    const out: HistoryMessage[] = [];
    try {
        const lines = readFileSync(file, 'utf-8').split('\n');
        for (const line of lines) {
            if (!line.trim()) continue;
            let entry: Record<string, unknown>;
            try {
                entry = JSON.parse(line);
            } catch {
                continue;
            }
            if (entry.type !== 'user' && entry.type !== 'assistant') continue;
            if (entry.isSidechain === true) continue;
            const message = entry.message as { content?: unknown } | undefined;
            const blocks = Array.isArray(message?.content) ? (message?.content as Record<string, unknown>[]) : [];
            if (entry.type === 'user') {
                // Real transcripts carry prompt text as a plain string
                // content; skip tool_result-only block entries.
                const text =
                    typeof message?.content === 'string'
                        ? message.content.trim()
                        : blocks
                              .filter((b) => b.type === 'text' && typeof b.text === 'string')
                              .map((b) => b.text as string)
                              .join('\n')
                              .trim();
                if (text) out.push({ role: 'user', text: text.slice(0, 2000) });
            } else {
                const text = blocks
                    .filter((b) => b.type === 'text' && typeof b.text === 'string')
                    .map((b) => b.text as string)
                    .join('\n')
                    .trim();
                const toolNames = blocks.filter((b) => b.type === 'tool_use').map((b) => String(b.name ?? ''));
                if (text || toolNames.length > 0) {
                    out.push({ role: 'assistant', text: text.slice(0, 2000), toolNames });
                }
            }
            if (out.length >= limit) break;
        }
    } catch (err) {
        logWarn(`readHistory failed for ${sessionId}: ${err}`);
    }
    return out;
}

// #229: real kernels do not echo the prompt text as a user message in
// stream-json — the authoritative prompt uuids live in the session JSONL.
// Sync checkpoints from the transcript at run end (stream-json capture stays
// as the fast path; addCheckpoint dedups by uuid).
export function syncCheckpointsFromTranscript(sessionId: string, repoPath: string): void {
    const session = getSession(sessionId);
    if (!session?.kernelSessionId) return;
    const file = findSessionFile(session.kernelSessionId, repoPath);
    if (!file) return;
    let added = 0;
    try {
        for (const line of readFileSync(file, 'utf-8').split('\n')) {
            if (!line.trim()) continue;
            let entry: Record<string, unknown>;
            try {
                entry = JSON.parse(line);
            } catch {
                continue;
            }
            if (entry.type !== 'user' || entry.isSidechain === true) continue;
            const message = entry.message as { content?: unknown } | undefined;
            // Real transcripts carry prompt text as a plain string content;
            // mock/stream-json transcripts use block arrays. Handle both.
            let text = '';
            if (typeof message?.content === 'string') {
                text = message.content.trim();
            } else if (Array.isArray(message?.content)) {
                text = (message?.content as Record<string, unknown>[])
                    .filter((b) => b.type === 'text' && typeof b.text === 'string')
                    .map((b) => b.text as string)
                    .join('\n')
                    .trim();
            }
            if (text && typeof entry.uuid === 'string') {
                addCheckpoint(sessionId, {
                    messageUuid: entry.uuid,
                    label: text.slice(0, 80),
                    createdAt: Date.now(),
                });
                added += 1;
            }
        }
        if (added > 0) log(`checkpoints synced from transcript: session=${sessionId} count=${added}`);
    } catch (err) {
        logWarn(`syncCheckpoints failed for ${sessionId}: ${err}`);
    }
}

// #229: checkpoint rollback — kernel --rewind-files restores the worktree to
// the state snapshot at the given user message (standalone op, no prompt).
export async function rollbackToCheckpoint(
    sessionId: string,
    messageUuid: string
): Promise<{ ok: boolean; error?: string }> {
    const session = getSession(sessionId);
    if (!session) return { ok: false, error: 'session not found' };
    if (!session.kernelSessionId) return { ok: false, error: 'session has no kernel run yet' };
    if (isRunning(sessionId)) return { ok: false, error: 'a run is active; wait for it to finish' };
    const repo = getRepo(session.repoId);
    if (!repo) return { ok: false, error: 'repo not found' };
    const kernelCmd = kernelCommand();
    const args = ['--resume', session.kernelSessionId, '--rewind-files', messageUuid];
    log(`rollback: session=${sessionId} checkpoint=${messageUuid}`);
    const proc = Bun.spawn([...kernelCmd, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
        cwd: repo.path,
        env: kernelSpawnEnv(),
    });
    const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    if (exitCode !== 0) {
        logWarn(`rollback failed: exit=${exitCode} stderr=${stderr.slice(0, 300)}`);
        return { ok: false, error: stderr.trim().slice(0, 500) || `kernel exited with code ${exitCode}` };
    }
    log(`rollback done: ${stdout.trim().slice(0, 200)}`);
    // Fresh worktree state after rollback — the Changes rail must re-render.
    try {
        const changes: FileChange[] = await fileChanges(repo.path);
        emit(sessionId, { kind: 'file_changes', files: changes });
    } catch (err) {
        logWarn(`fileChanges after rollback failed: ${err}`);
    }
    return { ok: true };
}
