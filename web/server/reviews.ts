import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { log, logWarn } from './config';

// P2.3: reviewer workbench backend — consumes the P2.2 findings files under
// <configDir>/reviews/ (written by src/services/review/reviewer.ts). No new
// kernel surface: this only reads/writes findings files and shells out to
// git/gh for the jump-to-diff hunk and the export-to-PR comment.

export type FindingState = 'open' | 'resolved' | 'dismissed';

export type WorkbenchFinding = {
    file: string;
    line: number | null;
    severity: string;
    title: string;
    fix: string;
    state: FindingState;
};

export type ReviewRun = {
    id: string;
    preset: string;
    cwd: string;
    at: string;
    findings: WorkbenchFinding[];
};

function configDir(): string {
    return process.env.FUSION_CODE_CONFIG_DIR ?? join(homedir(), '.fusion-code');
}

function reviewsDir(): string {
    return join(configDir(), 'reviews');
}

type StoredRun = {
    id: string;
    preset: string;
    cwd: string;
    at: string;
    findings: Array<Omit<WorkbenchFinding, 'state'>>;
};

function runPath(id: string): string {
    return join(reviewsDir(), `${id}.json`);
}

function readRun(id: string): StoredRun | null {
    try {
        return JSON.parse(readFileSync(runPath(id), 'utf8')) as StoredRun;
    } catch {
        return null;
    }
}

export function listReviewRuns(): ReviewRun[] {
    if (!existsSync(reviewsDir())) return [];
    const runs: ReviewRun[] = [];
    for (const f of readdirSync(reviewsDir()).filter((n) => n.endsWith('.json'))) {
        const run = readRun(f.slice(0, -5));
        if (!run) continue;
        const states = (run as { states?: Record<string, FindingState> }).states ?? {};
        runs.push({
            id: run.id,
            preset: run.preset,
            cwd: run.cwd,
            at: run.at,
            findings: (run.findings ?? []).map((finding, i) => ({
                ...finding,
                state: states[String(i)] ?? ('open' as FindingState),
            })),
        });
    }
    runs.sort((a, b) => b.at.localeCompare(a.at));
    return runs;
}

export function setFindingState(
    id: string,
    index: number,
    state: FindingState,
): { ok: boolean; error?: string } {
    const path = runPath(id);
    if (!existsSync(path)) return { ok: false, error: `review run ${id} not found` };
    let run: (StoredRun & { states?: Record<string, FindingState> }) | null = null;
    try {
        run = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return { ok: false, error: 'findings file is not valid JSON' };
    }
    if (!run || index < 0 || index >= (run.findings ?? []).length) {
        return { ok: false, error: 'finding index out of range' };
    }
    // State lives in a sibling map so the findings array stays a pure P2.2 artifact.
    run.states = { ...(run.states ?? {}), [String(index)]: state };
    writeFileSync(path, JSON.stringify(run, null, 4));
    return { ok: true };
}

export function getFindingDiff(id: string, index: number): { ok: boolean; diff?: string; error?: string } {
    const run = readRun(id);
    if (!run) return { ok: false, error: `review run ${id} not found` };
    const finding = (run.findings ?? [])[index];
    if (!finding) return { ok: false, error: 'finding index out of range' };
    if (!finding.file) return { ok: false, error: 'finding has no file path' };
    const proc = spawnSync('git', ['diff', 'HEAD', '--', finding.file], {
        cwd: run.cwd,
        encoding: 'utf8',
    });
    if (proc.status !== 0) {
        return { ok: false, error: `git diff failed: ${(proc.stderr ?? '').trim().slice(0, 200)}` };
    }
    return { ok: true, diff: proc.stdout ?? '' };
}

// Export the findings back into the PR as a markdown comment. PR resolution:
// explicit prNumber, else `gh pr view` in the review repo (best-effort).
export function exportReviewToPr(
    id: string,
    prNumber?: number,
): { ok: boolean; url?: string; error?: string } {
    const run = readRun(id);
    if (!run) return { ok: false, error: `review run ${id} not found` };
    const ghBin = process.env.FUSION_CODE_WEB_GH_BIN ?? 'gh';
    let pr = prNumber;
    if (!pr) {
        const view = spawnSync(ghBin, ['pr', 'view', '--json', 'number', '-q', '.number'], {
            cwd: run.cwd,
            encoding: 'utf8',
        });
        const parsed = Number.parseInt(String(view.stdout ?? '').trim(), 10);
        if (view.status !== 0 || Number.isNaN(parsed)) {
            return { ok: false, error: `no open PR found for ${run.cwd}` };
        }
        pr = parsed;
    }
    const states = (run as { states?: Record<string, FindingState> }).states ?? {};
    const lines = (run.findings ?? [])
        .map((finding, i) => {
            const state = states[String(i)] ?? 'open';
            if (state === 'dismissed') return null;
            const marker = state === 'resolved' ? '✅' : '🔍';
            return `- ${marker} **${finding.severity}** ${finding.file}:${finding.line ?? '?'} — ${finding.title}\n  fix: ${finding.fix}`;
        })
        .filter((l): l is string => l !== null);
    const body = [
        `## Review findings (${run.preset})`,
        '',
        `_Exported from fusion-code web review workbench — run ${run.id} at ${run.at}._`,
        '',
        ...(lines.length > 0 ? lines : ['No open findings — all resolved. 🎉']),
    ].join('\n');
    const proc = spawnSync(ghBin, ['pr', 'comment', String(pr), '--body', body], {
        cwd: run.cwd,
        encoding: 'utf8',
    });
    const url = String(proc.stdout ?? '').trim().split('\n').pop() ?? '';
    if (proc.status !== 0 || !url.startsWith('http')) {
        logWarn(`export review: gh pr comment failed: ${String(proc.stderr ?? '').trim().slice(0, 300)}`);
        return { ok: false, error: `gh pr comment failed: ${String(proc.stderr ?? '').trim().slice(0, 300)}` };
    }
    log(`export review: ${url}`);
    return { ok: true, url };
}
