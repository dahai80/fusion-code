import { Info, Save, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PermissionMode, SessionPermissions } from '../../shared/types';
import { API_BASE, api } from '../api';
import { useT } from '../i18n';

// /settings — global default permissions for new sessions (editable) +
// permission rule reference + environment template info. Per-session rules
// still live in the session view right rail.
const TOOL_DOCS: { name: string; zh: string; en: string; write: boolean }[] = [
    { name: 'Read', zh: '读取文件', en: 'Read files', write: false },
    { name: 'Glob', zh: '文件名匹配', en: 'Filename globbing', write: false },
    { name: 'Grep', zh: '内容搜索', en: 'Content search', write: false },
    { name: 'Edit', zh: '编辑文件', en: 'Edit files', write: true },
    { name: 'Write', zh: '写入文件', en: 'Write files', write: true },
    { name: 'Bash', zh: '执行命令', en: 'Run commands', write: true },
];

export function SettingsPage() {
    const t = useT();
    const [version, setVersion] = useState('');
    // Global default permissions applied to NEW sessions; existing sessions
    // keep their own rules.
    const [defaults, setDefaults] = useState<SessionPermissions | null>(null);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        void fetch(`${API_BASE}/health`)
            .then((res) => res.json())
            .then((body: { version?: string }) => setVersion(body.version ?? ''))
            .catch(() => setVersion(''));
        void api
            .getDefaultPermissions()
            .then(({ permissions }) => setDefaults(permissions))
            .catch(() => setDefaults(null));
    }, []);

    const toggleDefaultTool = (tool: string) => {
        if (!defaults) return;
        const has = defaults.allowedTools.includes(tool);
        const tools = has ? defaults.allowedTools.filter((x) => x !== tool) : [...defaults.allowedTools, tool];
        setDefaults({ ...defaults, allowedTools: tools });
        setSaved(false);
    };

    const saveDefaults = async () => {
        if (!defaults) return;
        try {
            const { permissions } = await api.setDefaultPermissions(defaults.mode, defaults.allowedTools);
            setDefaults(permissions);
            setSaved(true);
        } catch {
            setSaved(false);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-xl font-semibold">{t('权限与环境', 'Permissions & Environment')}</h1>
                <p className="mt-1 text-sm text-text-secondary">
                    {t(
                        '会话级权限规则在会话视图右栏设置；此页说明规则语义与环境模板。',
                        'Per-session rules live in the session view right rail; this page documents rule semantics and environment templates.'
                    )}
                </p>
            </div>

            <div className="rounded-2xl border border-border bg-bg-elevated p-4 shadow-sm shadow-zinc-900/5">
                <h2 className="flex items-center gap-2 text-sm font-medium">
                    <ShieldCheck size={15} className="text-brand" />
                    {t('权限模式', 'Permission modes')}
                </h2>
                <div className="mt-3 space-y-3 text-sm text-text-secondary">
                    <div>
                        <div className="font-medium text-text-primary">{t('允许列表 (Allowlist)', 'Allowlist')}</div>
                        <p className="mt-1 text-xs leading-relaxed">
                            {t(
                                '仅勾选的工具可被会话调用，其余一律拒绝。默认：Read、Glob、Grep（只读）。',
                                'Only checked tools may be invoked; everything else is denied. Default: Read, Glob, Grep (read-only).'
                            )}
                        </p>
                    </div>
                    <div>
                        <div className="font-medium text-text-primary">
                            {t('每次确认 (Ask every time)', 'Ask every time')}
                        </div>
                        <p className="mt-1 text-xs leading-relaxed">
                            {t(
                                '写操作默认拒绝，内核以错误形式在会话中提示，由你决定是否加入允许列表后重试。',
                                'Writes are denied by default; the kernel surfaces the denial in-session and you decide whether to grant and retry.'
                            )}
                        </p>
                    </div>
                </div>
                {/* Global default for new sessions — editable. */}
                {defaults && (
                    <div className="mt-4 rounded-xl border border-border bg-bg p-3">
                        <div className="flex flex-wrap items-center gap-2">
                            {(['allowlist', 'ask'] as PermissionMode[]).map((mode) => (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => {
                                        setDefaults({ ...defaults, mode });
                                        setSaved(false);
                                    }}
                                    className={`rounded-xl px-3 py-1.5 text-xs transition-colors ${
                                        defaults.mode === mode
                                            ? 'bg-brand/15 text-brand'
                                            : 'bg-bg-muted text-text-secondary hover:text-text-primary'
                                    }`}
                                >
                                    {mode === 'allowlist'
                                        ? t('新会话默认：允许列表', 'New sessions: allowlist')
                                        : t('新会话默认：每次确认', 'New sessions: ask every time')}
                                </button>
                            ))}
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                            {TOOL_DOCS.map((tool) => {
                                const on = defaults.allowedTools.includes(tool.name);
                                return (
                                    <button
                                        key={tool.name}
                                        type="button"
                                        onClick={() => toggleDefaultTool(tool.name)}
                                        className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs transition-colors ${
                                            on
                                                ? 'border-brand/40 bg-brand/10 text-text-primary'
                                                : 'border-border bg-bg text-text-muted hover:text-text-secondary'
                                        }`}
                                    >
                                        <span className="font-mono">{tool.name}</span>
                                        <span>{on ? '✓' : '—'}</span>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => void saveDefaults()}
                                className="flex items-center gap-1.5 rounded-xl bg-brand/10 px-3 py-1.5 text-xs text-brand transition-colors hover:bg-brand/20"
                            >
                                <Save size={12} />
                                {t('保存默认权限', 'Save defaults')}
                            </button>
                            {saved && <span className="text-xs text-success">{t('已保存', 'Saved')}</span>}
                        </div>
                    </div>
                )}
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {TOOL_DOCS.map((tool) => (
                        <div
                            key={tool.name}
                            className="flex items-center justify-between rounded-xl border border-border bg-bg px-3 py-2 text-xs"
                        >
                            <span className="font-mono text-text-primary">{tool.name}</span>
                            <span className="flex items-center gap-2 text-text-muted">
                                <span>{t(tool.zh, tool.en)}</span>
                                <span
                                    className={`rounded-lg px-1.5 py-0.5 ${
                                        tool.write ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'
                                    }`}
                                >
                                    {tool.write ? t('写', 'write') : t('读', 'read')}
                                </span>
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="rounded-2xl border border-border bg-bg-elevated p-4 shadow-sm shadow-zinc-900/5">
                <h2 className="flex items-center gap-2 text-sm font-medium">
                    <Info size={15} className="text-brand" />
                    {t('环境模板', 'Environment templates')}
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-text-secondary">
                    {t(
                        '会话在仓库工作树内运行。环境模板 v2：在仓库页为每个仓库配置 setup 命令（如 bun install / pip install -e .），点击"运行 setup"即在仓库工作树内执行并记录结果。',
                        'Sessions run in the repo worktree. Environment templates v2: configure a per-repo setup command (e.g. bun install / pip install -e .) on the Repos page and run it on demand in the repo worktree — the result is recorded.'
                    )}
                </p>
                {version && <p className="mt-3 text-xs text-text-muted">fusion-code-web v{version}</p>}
            </div>
        </div>
    );
}
