import { AlertCircle, ChevronDown, CircleDot, FolderGit2, MessageSquarePlus, Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RepoRecord, WebSession } from '../../shared/types';
import { navigate } from '../App';
import { type Branch, api } from '../api';
import { useT } from '../i18n';

// /sessions — frame C1: composer with repo/branch selector row + session
// list grouped by repo.
export function SessionsPage() {
    const t = useT();
    const [repos, setRepos] = useState<RepoRecord[]>([]);
    const [sessions, setSessions] = useState<WebSession[]>([]);
    const [repoId, setRepoId] = useState('');
    const [branch, setBranch] = useState('');
    const [branches, setBranches] = useState<Branch[]>([]);
    const [title, setTitle] = useState('');
    const [isolate, setIsolate] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const [repoRes, sessionRes] = await Promise.all([api.listRepos(), api.listSessions()]);
            setRepos(repoRes.repos);
            setSessions(sessionRes.sessions);
            setError('');
        } catch (err) {
            setError(String(err));
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    useEffect(() => {
        if (repos.length > 0 && !repoId) {
            setRepoId(repos[0].id);
        }
    }, [repos, repoId]);

    useEffect(() => {
        if (!repoId) {
            setBranches([]);
            return;
        }
        void api
            .repoBranches(repoId)
            .then((res) => {
                setBranches(res.branches);
                setBranch(res.current || res.branches[0]?.name || 'main');
            })
            .catch(() => setBranches([]));
    }, [repoId]);

    const grouped = useMemo(() => {
        const map = new Map<string, WebSession[]>();
        for (const session of sessions) {
            const list = map.get(session.repoId) ?? [];
            list.push(session);
            map.set(session.repoId, list);
        }
        return map;
    }, [sessions]);

    const repoName = (id: string): string => repos.find((r) => r.id === id)?.name ?? id.slice(0, 8);

    const createSession = async () => {
        if (!repoId || !branch || !title.trim()) return;
        setBusy(true);
        setError('');
        try {
            const { session } = await api.createSession({
                title: title.trim(),
                repoId,
                branch,
                isolateWorktree: isolate,
            });
            navigate(`/session/${encodeURIComponent(session.id)}`);
        } catch (err) {
            setError(String(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-6">
            {error && (
                <div className="flex items-start gap-2 rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <span className="break-all">{error}</span>
                </div>
            )}

            {/* Composer: task description + repo/branch selector row (C1) */}
            <div className="rounded-2xl border border-border bg-bg-elevated p-4 shadow-sm shadow-zinc-900/5">
                <textarea
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t(
                        '描述任务，如“修复登录超时并补测试”',
                        'Describe the task, e.g. "Fix login timeout and add tests"'
                    )}
                    rows={2}
                    className="w-full resize-none rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-brand"
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <div className="relative">
                        <select
                            value={repoId}
                            onChange={(e) => setRepoId(e.target.value)}
                            className="appearance-none rounded-xl border border-border bg-bg py-1.5 pl-3 pr-8 text-sm outline-none focus:border-brand"
                        >
                            {repos.length === 0 && <option value="">{t('先连接仓库', 'Connect a repo first')}</option>}
                            {repos.map((r) => (
                                <option key={r.id} value={r.id}>
                                    📁 {r.name}
                                </option>
                            ))}
                        </select>
                        <ChevronDown
                            size={14}
                            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted"
                        />
                    </div>
                    <div className="relative">
                        <select
                            value={branch}
                            onChange={(e) => setBranch(e.target.value)}
                            className="appearance-none rounded-xl border border-border bg-bg py-1.5 pl-3 pr-8 text-sm outline-none focus:border-brand"
                        >
                            {branches.map((b) => (
                                <option key={b.name} value={b.name}>
                                    ⎇ {b.name}
                                </option>
                            ))}
                        </select>
                        <ChevronDown
                            size={14}
                            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted"
                        />
                    </div>
                    <label
                        className="flex cursor-pointer items-center gap-1.5 text-sm text-text-secondary"
                        title={t(
                            '在独立 git worktree 中运行，编辑不直接落到仓库工作树',
                            'Run in an isolated git worktree — edits never touch the repo checkout directly'
                        )}
                    >
                        <FolderGit2 size={14} className="text-text-muted" />
                        <input
                            type="checkbox"
                            checked={isolate}
                            onChange={(e) => setIsolate(e.target.checked)}
                            className="h-3.5 w-3.5 accent-[var(--color-brand)]"
                        />
                        {t('隔离 worktree', 'Isolated worktree')}
                    </label>
                    <button
                        type="button"
                        onClick={() => void createSession()}
                        disabled={busy || !repoId || !title.trim()}
                        className="ml-auto flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                        <Send size={14} />
                        {busy ? t('创建中…', 'Creating…') : t('新会话', 'New session')}
                    </button>
                </div>
                {repos.length === 0 && (
                    <button
                        type="button"
                        onClick={() => navigate('/repos')}
                        className="mt-3 flex items-center gap-1.5 text-sm text-brand hover:underline"
                    >
                        <MessageSquarePlus size={14} />
                        {t('前往 /repos 连接第一个仓库', 'Go to /repos to connect your first repo')}
                    </button>
                )}
            </div>

            {/* Session list grouped by repo (C1) */}
            {[...grouped.entries()].map(([rid, list]) => (
                <section key={rid} className="space-y-3">
                    <h2 className="flex items-center gap-2 text-sm font-medium text-text-secondary">
                        {repoName(rid)}
                        <span className="rounded-lg bg-bg-muted px-2 py-0.5 text-xs text-text-muted">
                            {list.length}
                        </span>
                    </h2>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {list.map((session) => (
                            <button
                                key={session.id}
                                type="button"
                                onClick={() => navigate(`/session/${encodeURIComponent(session.id)}`)}
                                className="rounded-2xl border border-border bg-bg-elevated p-4 text-left shadow-sm shadow-zinc-900/5 transition-colors hover:border-brand/50"
                            >
                                <div className="truncate text-sm font-medium">{session.title}</div>
                                <div className="mt-2 flex items-center gap-2 text-xs">
                                    {session.status === 'running' && (
                                        <span className="flex items-center gap-1 text-running">
                                            <CircleDot size={12} className="animate-pulse" />
                                            {t('执行中', 'Running')}
                                        </span>
                                    )}
                                    {session.status === 'error' && (
                                        <span className="flex items-center gap-1 text-error">
                                            <CircleDot size={12} />
                                            {t('出错', 'Error')}
                                        </span>
                                    )}
                                    {session.status === 'idle' && (
                                        <span className="text-text-muted">{t('空闲', 'Idle')}</span>
                                    )}
                                    <span className="text-text-muted">⎇ {session.branch}</span>
                                    <span className="ml-auto text-text-muted">
                                        {new Date(session.updatedAt).toLocaleDateString()}
                                    </span>
                                </div>
                            </button>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}
