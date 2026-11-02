import { AlertCircle, FolderGit2, GitBranch, PlayCircle, Settings2, Trash2, Wrench } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { RepoRecord } from '../../shared/types';
import { navigate } from '../App';
import { type Branch, api } from '../api';
import { useT } from '../i18n';

// /repos — connect a repo (local path or git URL) + per-repo branch view.
export function ReposPage() {
    const t = useT();
    const [repos, setRepos] = useState<RepoRecord[]>([]);
    const [branches, setBranches] = useState<Record<string, Branch[]>>({});
    const [path, setPath] = useState('');
    const [gitUrl, setGitUrl] = useState('');
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        try {
            const { repos: list } = await api.listRepos();
            setRepos(list);
            setError('');
        } catch (err) {
            setError(String(err));
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    useEffect(() => {
        for (const repo of repos) {
            if (branches[repo.id]) continue;
            void api
                .repoBranches(repo.id)
                .then((res) => setBranches((prev) => ({ ...prev, [repo.id]: res.branches })))
                .catch(() => setBranches((prev) => ({ ...prev, [repo.id]: [] })));
        }
    }, [repos, branches]);

    const connect = async () => {
        if (!path.trim() && !gitUrl.trim()) return;
        setBusy(true);
        setError('');
        try {
            await api.connectRepo({
                path: path.trim() || undefined,
                gitUrl: gitUrl.trim() || undefined,
                name: name.trim() || undefined,
            });
            setPath('');
            setGitUrl('');
            setName('');
            await refresh();
        } catch (err) {
            setError(String(err));
        } finally {
            setBusy(false);
        }
    };

    const remove = async (id: string) => {
        if (!window.confirm(t('删除该仓库连接？会话记录保留。', 'Remove this repo connection? Sessions are kept.')))
            return;
        try {
            await api.removeRepo(id);
            await refresh();
        } catch (err) {
            setError(String(err));
        }
    };

    // #229: save the repo's verify command (checkpoint [Verify] runs it).
    const [editingTest, setEditingTest] = useState<Record<string, string>>({});
    // v2: per-repo setup command (environment template) + last run result.
    const [editingSetup, setEditingSetup] = useState<Record<string, string>>({});
    const [setupBusy, setSetupBusy] = useState<Record<string, boolean>>({});
    const [setupOutput, setSetupOutput] = useState<Record<string, { ok: boolean; output: string }>>({});

    const saveSetupCommand = async (id: string) => {
        const setupCommand = (editingSetup[id] ?? '').trim();
        try {
            await api.updateRepo(id, { setupCommand });
            setEditingSetup((prev) => {
                const next = { ...prev };
                delete next[id];
                return next;
            });
            await refresh();
        } catch (err) {
            setError(String(err));
        }
    };

    const runSetup = async (id: string) => {
        setSetupBusy((prev) => ({ ...prev, [id]: true }));
        try {
            const result = await api.runSetup(id);
            setSetupOutput((prev) => ({ ...prev, [id]: { ok: result.ok, output: result.output } }));
            await refresh();
        } catch (err) {
            setError(String(err));
        } finally {
            setSetupBusy((prev) => ({ ...prev, [id]: false }));
        }
    };
    const saveTestCommand = async (id: string) => {
        const testCommand = (editingTest[id] ?? '').trim();
        try {
            await api.updateRepo(id, { testCommand });
            setEditingTest((prev) => {
                const next = { ...prev };
                delete next[id];
                return next;
            });
            await refresh();
        } catch (err) {
            setError(String(err));
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-xl font-semibold">{t('仓库连接', 'Repositories')}</h1>
                <p className="mt-1 text-sm text-text-secondary">
                    {t(
                        '添加本地 git 仓库路径或克隆远程仓库，供会话使用。',
                        'Add a local git repo path or clone a remote URL for sessions to work in.'
                    )}
                </p>
            </div>

            {error && (
                <div className="flex items-start gap-2 rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <span className="break-all">{error}</span>
                </div>
            )}

            <div className="rounded-2xl border border-border bg-bg-elevated p-4 shadow-sm shadow-zinc-900/5">
                <div className="grid gap-3 sm:grid-cols-2">
                    <input
                        value={path}
                        onChange={(e) => setPath(e.target.value)}
                        placeholder={t('本地路径，如 /Users/me/proj', 'Local path, e.g. /Users/me/proj')}
                        className="rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-brand"
                    />
                    <input
                        value={gitUrl}
                        onChange={(e) => setGitUrl(e.target.value)}
                        placeholder={t('或 git URL 克隆', 'or git URL to clone')}
                        className="rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-brand"
                    />
                </div>
                <div className="mt-3 flex items-center gap-3">
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t('显示名（可选）', 'Display name (optional)')}
                        className="w-48 rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-brand"
                    />
                    <button
                        type="button"
                        onClick={() => void connect()}
                        disabled={busy || (!path.trim() && !gitUrl.trim())}
                        className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                        {busy ? t('连接中…', 'Connecting…') : t('连接仓库', 'Connect repo')}
                    </button>
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                {repos.map((repo) => (
                    <div
                        key={repo.id}
                        className="rounded-2xl border border-border bg-bg-elevated p-4 shadow-sm shadow-zinc-900/5"
                    >
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 text-sm font-medium">
                                    <FolderGit2 size={16} className="shrink-0 text-brand" />
                                    <span className="truncate">{repo.name}</span>
                                </div>
                                <div className="mt-1 truncate text-xs text-text-muted" title={repo.path}>
                                    {repo.path}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => void remove(repo.id)}
                                className="rounded-xl p-1.5 text-text-muted transition-colors hover:bg-error/10 hover:text-error"
                                title={t('删除', 'Remove')}
                            >
                                <Trash2 size={15} />
                            </button>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            <GitBranch size={13} className="text-text-muted" />
                            {(branches[repo.id] ?? []).slice(0, 5).map((b) => (
                                <span
                                    key={b.name}
                                    className={`rounded-lg px-2 py-0.5 text-xs ${
                                        b.current ? 'bg-brand/15 text-brand' : 'bg-bg-muted text-text-secondary'
                                    }`}
                                >
                                    {b.name}
                                </span>
                            ))}
                        </div>
                        {repo.originUrl && (
                            <div className="mt-2 truncate text-xs text-text-muted" title={repo.originUrl}>
                                {repo.originUrl}
                            </div>
                        )}
                        {/* #229: verify command for checkpoint [Verify] */}
                        <div className="mt-3 flex items-center gap-2">
                            <PlayCircle size={13} className="shrink-0 text-text-muted" />
                            <input
                                value={editingTest[repo.id] ?? repo.testCommand ?? ''}
                                onChange={(e) => setEditingTest((prev) => ({ ...prev, [repo.id]: e.target.value }))}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') void saveTestCommand(repo.id);
                                }}
                                placeholder={t('验证命令，如 bun test', 'Verify command, e.g. bun test')}
                                className="min-w-0 flex-1 rounded-xl border border-border bg-bg px-2.5 py-1.5 text-xs outline-none focus:border-brand"
                            />
                            {editingTest[repo.id] !== undefined && (
                                <button
                                    type="button"
                                    onClick={() => void saveTestCommand(repo.id)}
                                    className="shrink-0 rounded-xl bg-brand/10 px-2.5 py-1.5 text-xs text-brand transition-colors hover:bg-brand/20"
                                >
                                    {t('保存', 'Save')}
                                </button>
                            )}
                        </div>
                        {/* v2: environment template setup command + on-demand run */}
                        <div className="mt-3 flex items-center gap-2">
                            <Wrench size={13} className="shrink-0 text-text-muted" />
                            <input
                                value={editingSetup[repo.id] ?? repo.setupCommand ?? ''}
                                onChange={(e) => setEditingSetup((prev) => ({ ...prev, [repo.id]: e.target.value }))}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') void saveSetupCommand(repo.id);
                                }}
                                placeholder={t(
                                    '环境 setup 命令，如 bun install',
                                    'Environment setup command, e.g. bun install'
                                )}
                                className="min-w-0 flex-1 rounded-xl border border-border bg-bg px-2.5 py-1.5 text-xs outline-none focus:border-brand"
                            />
                            {editingSetup[repo.id] !== undefined && (
                                <button
                                    type="button"
                                    onClick={() => void saveSetupCommand(repo.id)}
                                    className="shrink-0 rounded-xl bg-brand/10 px-2.5 py-1.5 text-xs text-brand transition-colors hover:bg-brand/20"
                                >
                                    {t('保存', 'Save')}
                                </button>
                            )}
                            <button
                                type="button"
                                disabled={!repo.setupCommand || setupBusy[repo.id] === true}
                                onClick={() => void runSetup(repo.id)}
                                className="flex shrink-0 items-center gap-1 rounded-xl bg-bg-muted px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Settings2 size={12} />
                                {setupBusy[repo.id] === true ? t('运行中…', 'Running…') : t('运行 setup', 'Run setup')}
                            </button>
                        </div>
                        {(setupOutput[repo.id] ?? repo.lastSetup) && (
                            <pre
                                className={`mt-2 max-h-32 overflow-auto rounded-xl px-3 py-2 text-xs ${
                                    (setupOutput[repo.id] ?? repo.lastSetup)?.ok
                                        ? 'bg-success/10 text-text-secondary'
                                        : 'bg-error/10 text-text-secondary'
                                }`}
                            >
                                {(setupOutput[repo.id] ?? repo.lastSetup)?.output}
                            </pre>
                        )}
                        <button
                            type="button"
                            onClick={() => navigate('/sessions')}
                            className="mt-3 rounded-xl bg-bg-muted px-3 py-1.5 text-xs text-text-secondary transition-colors hover:text-text-primary"
                        >
                            {t('去开会话 →', 'Open a session →')}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
