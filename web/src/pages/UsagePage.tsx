import { Coins, Cpu, MessageSquare, Timer } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { UsageSummary } from '../../shared/types';
import { api } from '../api';
import { useT } from '../i18n';

// /usage (#230) — token/cost totals aggregated from per-turn usage records.
export function UsagePage() {
    const t = useT();
    const [summary, setSummary] = useState<UsageSummary | null>(null);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try {
            setSummary(await api.usage());
            setError('');
        } catch (err) {
            setError(String(err));
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const fmtTokens = (n: number): string =>
        n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

    const cards = [
        {
            icon: Coins,
            label: t('总成本', 'Total cost'),
            value: `$${(summary?.totalCostUsd ?? 0).toFixed(4)}`,
        },
        {
            icon: Cpu,
            label: t('输入 / 输出 tokens', 'Input / output tokens'),
            value: `${fmtTokens(summary?.totalInputTokens ?? 0)} / ${fmtTokens(summary?.totalOutputTokens ?? 0)}`,
        },
        {
            icon: MessageSquare,
            label: t('对话轮次', 'Turns'),
            value: String(summary?.totalTurns ?? 0),
        },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-xl font-semibold">{t('用量', 'Usage')}</h1>
                <p className="mt-1 text-sm text-text-secondary">
                    {t(
                        '按仓库和会话统计的 token 与成本（来自每次对话的结果消息）。',
                        "Token and cost totals per repo and session, from each turn's result message."
                    )}
                </p>
            </div>

            {error && (
                <div className="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
                    {error}
                </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
                {cards.map((card) => (
                    <div
                        key={card.label}
                        className="rounded-2xl border border-border bg-bg-elevated p-4 shadow-sm shadow-zinc-900/5"
                    >
                        <div className="flex items-center gap-2 text-xs text-text-muted">
                            <card.icon size={14} className="text-brand" />
                            {card.label}
                        </div>
                        <div className="mt-2 text-lg font-semibold tabular-nums">{card.value}</div>
                    </div>
                ))}
            </div>

            {(summary?.totalTurns ?? 0) === 0 && (
                <div className="rounded-2xl border border-dashed border-border bg-bg-elevated p-8 text-center text-sm text-text-muted">
                    {t(
                        '暂无用量数据。运行一次会话后即可看到统计。',
                        'No usage yet. Run a session and totals will appear here.'
                    )}
                </div>
            )}

            {(summary?.byRepo.length ?? 0) > 0 && (
                <div className="rounded-2xl border border-border bg-bg-elevated p-4 shadow-sm shadow-zinc-900/5">
                    <h2 className="text-sm font-medium">{t('按仓库', 'By repository')}</h2>
                    <table className="mt-3 w-full text-xs">
                        <thead>
                            <tr className="text-left text-text-muted">
                                <th className="pb-2 font-normal">{t('仓库', 'Repository')}</th>
                                <th className="pb-2 text-right font-normal">{t('会话', 'Sessions')}</th>
                                <th className="pb-2 text-right font-normal">{t('输入', 'Input')}</th>
                                <th className="pb-2 text-right font-normal">{t('输出', 'Output')}</th>
                                <th className="pb-2 text-right font-normal">{t('成本', 'Cost')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {summary?.byRepo.map((row) => (
                                <tr key={row.repoId} className="border-t border-border/60 text-text-secondary">
                                    <td className="py-2">{row.repoName}</td>
                                    <td className="py-2 text-right tabular-nums">{row.sessions}</td>
                                    <td className="py-2 text-right tabular-nums">{fmtTokens(row.inputTokens)}</td>
                                    <td className="py-2 text-right tabular-nums">{fmtTokens(row.outputTokens)}</td>
                                    <td className="py-2 text-right tabular-nums">${row.costUsd.toFixed(4)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {(summary?.bySession.length ?? 0) > 0 && (
                <div className="rounded-2xl border border-border bg-bg-elevated p-4 shadow-sm shadow-zinc-900/5">
                    <h2 className="text-sm font-medium">{t('按会话', 'By session')}</h2>
                    <table className="mt-3 w-full text-xs">
                        <thead>
                            <tr className="text-left text-text-muted">
                                <th className="pb-2 font-normal">{t('会话', 'Session')}</th>
                                <th className="pb-2 font-normal">{t('仓库', 'Repository')}</th>
                                <th className="pb-2 text-right font-normal">{t('轮次', 'Turns')}</th>
                                <th className="pb-2 text-right font-normal">{t('成本', 'Cost')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {summary?.bySession.map((row) => (
                                <tr key={row.sessionId} className="border-t border-border/60 text-text-secondary">
                                    <td className="max-w-48 truncate py-2">{row.title}</td>
                                    <td className="py-2">{row.repoName}</td>
                                    <td className="py-2 text-right tabular-nums">{row.turns}</td>
                                    <td className="py-2 text-right tabular-nums">${row.costUsd.toFixed(4)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <div className="flex items-center gap-1.5 text-xs text-text-muted">
                <Timer size={12} />
                {t(
                    '成本来自内核结果消息的 total_cost_usd，本地模型为 0。',
                    'Cost comes from the kernel result message total_cost_usd; local models report 0.'
                )}
            </div>
        </div>
    );
}
