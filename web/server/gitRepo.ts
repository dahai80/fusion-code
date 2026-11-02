import type { FileChange } from '../shared/types';
import { log, logWarn } from './config';

// Thin git helpers. All commands run with cwd = repo path, no shell
// interpolation of user input (argv array only).

export async function git(repoPath: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    const proc = Bun.spawn(['git', '-C', repoPath, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    return { ok: exitCode === 0, stdout, stderr };
}

export async function isGitRepo(path: string): Promise<boolean> {
    const res = await git(path, ['rev-parse', '--is-inside-work-tree']);
    return res.ok && res.stdout.trim() === 'true';
}

export async function repoOriginUrl(path: string): Promise<string | undefined> {
    const res = await git(path, ['config', '--get', 'remote.origin.url']);
    return res.ok ? res.stdout.trim() : undefined;
}

export async function currentBranch(path: string): Promise<string> {
    const res = await git(path, ['rev-parse', '--abbrev-ref', 'HEAD']);
    return res.ok ? res.stdout.trim() : 'unknown';
}

export async function listBranches(path: string): Promise<{ name: string; current: boolean }[]> {
    const res = await git(path, ['branch', '--format=%(refname:short)%00%(HEAD)']);
    if (!res.ok) {
        logWarn(`listBranches failed for ${path}: ${res.stderr.trim()}`);
        return [];
    }
    return res.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const [name, head] = line.split('\0');
            return { name, current: head === '*' };
        });
}

export async function cloneRepo(url: string, targetDir: string): Promise<{ ok: boolean; stderr: string }> {
    log(`cloning ${url} -> ${targetDir}`);
    const proc = Bun.spawn(['git', 'clone', url, targetDir], {
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const [exitCode, , stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    return { ok: exitCode === 0, stderr };
}

export async function fileChanges(repoPath: string): Promise<FileChange[]> {
    const status = await git(repoPath, ['status', '--porcelain']);
    if (!status.ok) {
        logWarn(`fileChanges status failed: ${status.stderr.trim()}`);
        return [];
    }
    const paths: { path: string; code: string }[] = [];
    for (const line of status.stdout.split('\n')) {
        if (!line.trim()) continue;
        // Porcelain v1: XY <path> (rename shows "R  old -> new" — keep new).
        const code = line.slice(0, 2).trim();
        let path = line.slice(3).trim();
        if (path.includes(' -> ')) path = path.split(' -> ').pop() ?? path;
        paths.push({ path, code: code || '?' });
    }
    if (paths.length === 0) return [];
    const numstat = await git(repoPath, ['diff', 'HEAD', '--numstat']);
    const statMap = new Map<string, { additions: number; deletions: number }>();
    for (const line of numstat.stdout.split('\n')) {
        if (!line.trim()) continue;
        const [add, del, path] = line.split('\t');
        statMap.set(path, { additions: Number(add) || 0, deletions: Number(del) || 0 });
    }
    return paths.map(({ path, code }) => ({
        path,
        status: (['M', 'A', 'D', 'R', 'U'].includes(code) ? code : '?') as FileChange['status'],
        additions: statMap.get(path)?.additions ?? 0,
        deletions: statMap.get(path)?.deletions ?? 0,
    }));
}

// #229: unified diff for one changed file (tracked: vs HEAD; untracked:
// presented as a new-file diff).
export async function fileDiff(repoPath: string, filePath: string): Promise<string> {
    const tracked = await git(repoPath, ['status', '--porcelain', '--', filePath]);
    const code = tracked.stdout.slice(0, 2).trim();
    if (tracked.ok && code && code !== '??') {
        const res = await git(repoPath, ['diff', 'HEAD', '--', filePath]);
        if (res.ok) return res.stdout.slice(0, 200_000);
        return res.stderr.trim();
    }
    // Untracked: show content as a new-file diff.
    try {
        const content = await Bun.file(join(repoPath, filePath)).text();
        const body = content
            .split('\n')
            .map((l) => `+${l}`)
            .join('\n');
        return `--- /dev/null\n+++ b/${filePath}\n${body}`.slice(0, 200_000);
    } catch (err) {
        logWarn(`fileDiff read failed for ${filePath}: ${err}`);
        return '';
    }
}

// #229: run the repo's verify command at a checkpoint. Also reused for the
// v2 environment-template setup command (label distinguishes log lines).
export async function runVerifyCommand(
    repoPath: string,
    testCommand: string,
    timeoutMs = 120_000,
    label = 'verify'
): Promise<{ ok: boolean; output: string }> {
    log(`${label}: cd ${repoPath} && ${testCommand}`);
    const proc = Bun.spawn(['sh', '-c', testCommand], {
        stdout: 'pipe',
        stderr: 'pipe',
        cwd: repoPath,
    });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    clearTimeout(timer);
    const output = `${stdout}${stderr ? (stdout ? '\n' : '') + stderr : ''}`.slice(-8000);
    log(`${label} done: exit=${exitCode}`);
    return { ok: exitCode === 0, output };
}

// #229: PR flow — branch + commit + push + gh pr create. gh binary is
// overridable (FUSION_CODE_WEB_GH_BIN) so tests can shim it.
export async function createPullRequest(
    repoPath: string,
    input: { title: string; body: string; branch: string }
): Promise<{ ok: boolean; url?: string; error?: string; branch: string }> {
    const ghBin = process.env.FUSION_CODE_WEB_GH_BIN ?? 'gh';
    // Branch (reuse if this session already created one).
    const current = await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (!current.ok) return { ok: false, error: current.stderr.trim(), branch: input.branch };
    if (current.stdout.trim() !== input.branch) {
        const branch = await git(repoPath, ['checkout', '-b', input.branch]);
        if (!branch.ok) {
            const existing = await git(repoPath, ['checkout', input.branch]);
            if (!existing.ok) return { ok: false, error: branch.stderr.trim(), branch: input.branch };
        }
    }
    // Commit everything the session changed.
    const add = await git(repoPath, ['add', '-A']);
    if (!add.ok) return { ok: false, error: add.stderr.trim(), branch: input.branch };
    // Clean worktree check BEFORE commit — git's empty-commit message is
    // locale-dependent, --cached --quiet exit code is not.
    const staged = await git(repoPath, ['diff', '--cached', '--quiet']);
    if (staged.ok) {
        return { ok: false, error: 'no changes to create a PR from', branch: input.branch };
    }
    const commit = await git(repoPath, ['commit', '-m', input.title]);
    if (!commit.ok) {
        return { ok: false, error: commit.stderr.trim() || commit.stdout.trim(), branch: input.branch };
    }
    const push = await git(repoPath, ['push', '-u', 'origin', input.branch]);
    if (!push.ok) return { ok: false, error: push.stderr.trim(), branch: input.branch };
    const proc = Bun.spawn([ghBin, 'pr', 'create', '--title', input.title, '--body', input.body], {
        stdout: 'pipe',
        stderr: 'pipe',
        cwd: repoPath,
    });
    const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    const urlMatch = stdout.trim().split('\n').pop() ?? '';
    if (exitCode !== 0 || !urlMatch) {
        logWarn(`gh pr create failed: ${stderr.trim().slice(0, 300)}`);
        return {
            ok: false,
            error: stderr.trim().slice(0, 500) || `gh exited with code ${exitCode}`,
            branch: input.branch,
        };
    }
    log(`PR created: ${urlMatch}`);
    return { ok: true, url: urlMatch, branch: input.branch };
}

import { join } from 'node:path';
