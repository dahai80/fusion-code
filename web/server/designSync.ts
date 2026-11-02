import { mkdirSync, readFileSync, readdirSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import type { DesignContext, DesignFile } from '../shared/types';
import { log, logWarn } from './config';
import { currentBranch } from './gitRepo';
import { createSession, listRepos, upsertSession } from './store';

// #231: fusion-design sync-to-code ingestion (frozen producer contract,
// fd-ecosystem `sync_to_code`). fusion-design's [Send to Code] button writes
// design export files + a JSON notification into
//   <FUSION_DESIGN_DATA_DIR>/fusion-code/
// (default ~/.fusion-design/fusion-code). This watcher polls the directory,
// turns each valid notification into a new web session with the design files
// attached as context, then archives the notification so restarts don't
// re-ingest. Polling (not fs.watch): the contract dir is low-traffic and a
// 3s poll survives editors writing files non-atomically.

const POLL_INTERVAL_MS = Number(process.env.FUSION_CODE_WEB_DESIGN_SYNC_INTERVAL_MS ?? 3000);
const MAX_FILE_BYTES = 64 * 1024;
const MAX_FILES = 10;
const EXT_LANGUAGE: Record<string, string> = {
    '.html': 'html',
    '.htm': 'html',
    '.tsx': 'tsx',
    '.ts': 'typescript',
    '.jsx': 'jsx',
    '.js': 'javascript',
    '.css': 'css',
    '.json': 'json',
    '.md': 'markdown',
    '.svg': 'svg',
};

type DesignNotification = {
    target?: unknown;
    action?: unknown;
    payload?: {
        component?: unknown;
        files?: unknown;
    };
};

export function designSyncDir(): string {
    const base = process.env.FUSION_DESIGN_DATA_DIR ?? join(homedir(), '.fusion-design');
    return join(base, 'fusion-code');
}

// Pick the session's target repo: explicit env override, else the most
// recently added repo. With no repos registered we skip processing (the
// notification stays in place and a later poll retries).
function pickRepoId(): string | null {
    const override = process.env.FUSION_CODE_WEB_DESIGN_REPO_ID;
    if (override) return override;
    const repos = listRepos();
    return repos.length > 0 ? repos[0].id : null;
}

function readDesignFile(path: string): DesignFile | null {
    try {
        const st = statSync(path);
        if (!st.isFile()) {
            logWarn(`design file is not a regular file: ${path}`);
            return null;
        }
        const raw = readFileSync(path, 'utf-8');
        const truncated = st.size > MAX_FILE_BYTES;
        return {
            path,
            name: basename(path),
            language: EXT_LANGUAGE[extname(path).toLowerCase()] ?? 'text',
            content: truncated ? raw.slice(0, MAX_FILE_BYTES) : raw,
            truncated,
        };
    } catch (err) {
        logWarn(`design file read failed: ${path}: ${err}`);
        return null;
    }
}

// Returns null for both unparsable JSON and foreign contracts — the caller
// leaves those files alone (they belong to another consumer or are still
// being written).
function parseNotification(raw: string): { component: string; files: string[] } | null {
    let msg: DesignNotification;
    try {
        msg = JSON.parse(raw) as DesignNotification;
    } catch {
        return null;
    }
    if (msg.target !== 'FusionCode' || msg.action !== 'sync-to-code') return null;
    const payload = msg.payload;
    if (!payload || typeof payload !== 'object') return null;
    const component = typeof payload.component === 'string' ? payload.component.trim() : '';
    const files = Array.isArray(payload.files) ? payload.files.filter((f): f is string => typeof f === 'string') : [];
    if (!component || files.length === 0) return null;
    return { component, files: files.slice(0, MAX_FILES) };
}

function archiveNotification(notifyPath: string): void {
    const processedDir = join(designSyncDir(), 'processed');
    try {
        mkdirSync(processedDir, { recursive: true });
        const dest = join(processedDir, `${Date.now()}-${basename(notifyPath)}`);
        renameSync(notifyPath, dest);
        log(`design notification archived: ${basename(notifyPath)} -> processed/`);
    } catch (err) {
        logWarn(`design notification archive failed: ${notifyPath}: ${err}`);
    }
}

// Warn-once per notification name — deferrals re-poll every interval and
// would otherwise spam the log.
const warned = new Set<string>();
function warnOnce(name: string, line: string): void {
    if (warned.has(name)) return;
    warned.add(name);
    logWarn(line);
}

// Process one notification: snapshot design files, create the session,
// archive the notification. Returns the session id, null when deferred
// (left in place for a later poll), or 'skip' for non-matching files.
export async function ingestDesignNotification(notifyPath: string, raw: string): Promise<string | 'skip' | null> {
    const name = basename(notifyPath);
    const parsed = parseNotification(raw);
    if (!parsed) return 'skip';
    const repoId = pickRepoId();
    if (!repoId) {
        warnOnce(name, `design handoff deferred (${name}): no repos registered in web store`);
        return null;
    }
    const files: DesignFile[] = [];
    for (const f of parsed.files) {
        const design = readDesignFile(f);
        if (design) files.push(design);
    }
    if (files.length === 0) {
        warnOnce(name, `design handoff deferred (${name}): no readable design files for ${parsed.component}`);
        return null;
    }
    const repos = listRepos();
    const repo = repos.find((r) => r.id === repoId);
    let branch = 'main';
    if (repo) {
        try {
            branch = (await currentBranch(repo.path)) || 'main';
        } catch {
            /* keep default */
        }
    }
    const context: DesignContext = {
        component: parsed.component,
        source: designSyncDir(),
        ingestedAt: Date.now(),
        files,
    };
    const session = createSession({
        title: `Design: ${parsed.component}`,
        repoId,
        branch,
        environment: repo?.environment ?? 'default',
    });
    session.designContext = context;
    session.designPending = true;
    upsertSession(session);
    log(`design handoff ingested: component=${parsed.component} files=${files.length} session=${session.id}`);
    archiveNotification(notifyPath);
    return session.id;
}

// One poll pass over the contract directory. Exported for tests.
export async function pollDesignSyncOnce(): Promise<number> {
    const dir = designSyncDir();
    let entries: string[];
    try {
        entries = readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isFile() && e.name.endsWith('.json'))
            .map((e) => e.name);
    } catch {
        return 0; // contract dir not created yet — producer hasn't run
    }
    let ingested = 0;
    for (const name of entries) {
        const path = join(dir, name);
        let raw = '';
        try {
            raw = readFileSync(path, 'utf-8');
        } catch (err) {
            logWarn(`design notification read failed: ${name}: ${err}`);
            continue;
        }
        const result = await ingestDesignNotification(path, raw);
        if (typeof result === 'string' && result !== 'skip') ingested += 1;
    }
    return ingested;
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startDesignSync(): void {
    if (timer || POLL_INTERVAL_MS <= 0) return;
    timer = setInterval(() => {
        void pollDesignSyncOnce().catch((err) => logWarn(`design sync poll failed: ${err}`));
    }, POLL_INTERVAL_MS);
    log(`design sync watcher started: dir=${designSyncDir()} interval=${POLL_INTERVAL_MS}ms`);
}

export function stopDesignSync(): void {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}
