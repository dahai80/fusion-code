import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportReviewToPr, getFindingDiff, listReviewRuns, setFindingState } from '../server/reviews';

// P2.3: reviewer workbench backend — findings listing, resolve/dismiss
// state, jump-to-diff hunk, export-to-PR comment (stub gh).

const tempDirs: string[] = [];
let configDir = '';
let repoDir = '';

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
    const proc = spawnSync('git', args, { cwd, encoding: 'utf8' });
    return { ok: proc.status === 0, out: `${proc.stdout ?? ''}${proc.stderr ?? ''}` };
}

beforeAll(() => {
    configDir = mkdtempSync(join(tmpdir(), 'fc-web-reviews-cfg-'));
    tempDirs.push(configDir);
    repoDir = mkdtempSync(join(tmpdir(), 'fc-web-reviews-repo-'));
    tempDirs.push(repoDir);
    git(repoDir, ['init', '-q']);
    git(repoDir, ['config', 'user.email', 't@e.com']);
    git(repoDir, ['config', 'user.name', 'T']);
    writeFileSync(join(repoDir, 'a.ts'), 'const x = 1;\n');
    git(repoDir, ['add', '-A']);
    git(repoDir, ['commit', '-q', '-m', 'seed']);
    writeFileSync(join(repoDir, 'a.ts'), 'const x = 2;\n');

    // Findings file as reviewer.ts writes it (no states map yet).
    mkdirSync(join(configDir, 'reviews'), { recursive: true });
    writeFileSync(
        join(configDir, 'reviews', 'test01.json'),
        JSON.stringify(
            {
                id: 'test01',
                preset: 'review',
                cwd: repoDir,
                at: '2026-11-12T00:00:00.000Z',
                findings: [
                    { file: 'a.ts', line: 1, severity: 'high', title: 't1', fix: 'f1' },
                    { file: 'a.ts', line: null, severity: 'low', title: 't2', fix: 'f2' },
                ],
            },
            null,
            4
        )
    );
    process.env.FUSION_CODE_CONFIG_DIR = configDir;

    // Stub gh: pr view → 42; pr comment → URL.
    const stubGh = join(configDir, 'gh.sh');
    writeFileSync(
        stubGh,
        '#!/bin/sh\nif [ "$2" = "view" ]; then echo 42; elif [ "$2" = "comment" ]; then echo https://git.example.com/pr/42#comment;\nelse exit 1; fi\n'
    );
    chmodSync(stubGh, 0o755);
    process.env.FUSION_CODE_WEB_GH_BIN = stubGh;
});

afterAll(() => {
    delete process.env.FUSION_CODE_CONFIG_DIR;
    delete process.env.FUSION_CODE_WEB_GH_BIN;
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('review workbench backend (P2.3)', () => {
    test('lists runs with default open state', () => {
        const runs = listReviewRuns();
        expect(runs).toHaveLength(1);
        expect(runs[0]!.id).toBe('test01');
        expect(runs[0]!.findings[0]!.state).toBe('open');
    });

    test('resolve/dismiss state persists in a sibling map', () => {
        expect(setFindingState('test01', 0, 'resolved').ok).toBe(true);
        expect(setFindingState('test01', 1, 'dismissed').ok).toBe(true);
        const runs = listReviewRuns();
        expect(runs[0]!.findings[0]!.state).toBe('resolved');
        expect(runs[0]!.findings[1]!.state).toBe('dismissed');
        expect(setFindingState('test01', 9, 'open').ok).toBe(false);
        expect(setFindingState('missing', 0, 'open').ok).toBe(false);
    });

    test('jump-to-diff returns the file diff from the review repo', () => {
        const res = getFindingDiff('test01', 0);
        expect(res.ok).toBe(true);
        expect(res.diff).toContain('a.ts');
        expect(res.diff).toContain('+const x = 2;');
        expect(getFindingDiff('test01', 9).ok).toBe(false);
    });

    test('export posts the findings comment to the PR', () => {
        const res = exportReviewToPr('test01');
        expect(res.ok).toBe(true);
        expect(res.url).toBe('https://git.example.com/pr/42#comment');
        const missing = exportReviewToPr('missing');
        expect(missing.ok).toBe(false);
    });
});
