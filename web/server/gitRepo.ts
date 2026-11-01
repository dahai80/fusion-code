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
