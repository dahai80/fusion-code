import { AlertCircle, CheckCircle2, ExternalLink, FileDiff, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { type ReviewRun, api } from '../api';
import { useT } from '../i18n';

// P2.3: reviewer workbench — findings list from P2.2 reviewer runs, per
// finding resolve/dismiss state, jump-to-diff-line (inline diff hunk), and
// export back into the PR as a comment.

const SEVERITY_STYLES: Record<string, string> = {
    critical: 'bg-error/15 text-error',
    high: 'bg-error/10 text-error',
    medium: 'bg-warning/15 text-warning',
    low: 'bg-bg-muted text-text-secondary',
    info: 'bg-bg-muted text-text-muted',
};

function severityStyle(severity: string): string {
    return SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.info!;
}

// Render the diff hunk containing the finding's line with a highlight.
function hunkForLine(diff: string, line: number | null): string {
    if (line === null) return diff.slice(0, 2000);
    const hunks = diff.split(/\n(?=@@)/);
    for (const hunk of hunks) {
        const match = hunk.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (!match) continue;
        const start = Number(match[1]);
        let current = start;
        for (const l of hunk.split('\n').slice(1)) {
            if (l.startsWith('+') && current === line) return hunk;
            if (l.startsWith('+') || l.startsWith(' ') || l.startsWith('-')) {
                if (!l.startsWith('-')) current += 1;
            }
        }
    }
    return hunks[0] ?? '';
}

export function ReviewsPage() {
    const t = useT();
    const [runs, setRuns] = useState<ReviewRun[]>([]);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState('');
    const [openDiff, setOpenDiff] = useState<{ key: string; text: string } | null>(null);
    const [exported, setExported] = useState<string>('');

    const refresh = useCallback(async () => {
        try {
            const { runs: list } = await api.listReviews();
            setRuns(list);
            setError('');
        } catch (err) {
            setError(String(err));
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const updateState = async (runId: string, index: number, state: 'resolved' | 'dismissed' | 'open') => {
        setBusy(`${runId}:${index}`);
        try {
            await api.setFindingState(runId, index, state);
            setRuns((prev) =>
                prev.map((run) =>
                    run.id !== runId
                        ? run
                        : {
                              ...run,
                              findings: run.findings.map((f, i) => (i === index ? { ...f, state } : f)),
                          }
                )
            );
        } catch (err) {
            setError(String(err));
        } finally {
            setBusy('');
        }
    };

    const jumpToDiff = async (runId: string, index: number) => {
        const key = `${runId}:${index}`;
        if (openDiff?.key === key) {
            setOpenDiff(null);
            return;
        }
        setBusy(key);
        try {
            const { diff } = await api.getFindingDiff(runId, index);
            setOpenDiff({ key, text: diff });
        } catch (err) {
            setError(String(err));
        } finally {
            setBusy('');
        }
    };

    const exportToPr = async (runId: string) => {
        setBusy(`export:${runId}`);
        setExported('');
        try {
            const { url } = await api.exportReview(runId);
            setExported(url ?? t('已导出', 'Exported'));
        } catch (err) {
            setError(String(err));
        } finally {
            setBusy('');
        }
    };

    return (
        <div className="mx-auto w-full max-w-4xl space-y-4 p-6">
            <div>
                <h1 className="text-lg font-semibold">{t('评审工作台', 'Review Workbench')}</h1>
                <p className="mt-1 text-sm text-text-muted">
                    {t(
                        '来自 reviewer 例程的发现 — 逐条处理并回写 PR。',
                        'Findings from reviewer routines — triage and export back into the PR.'
                    )}
                </p>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
                    <AlertCircle size={15} /> {error}
                </div>
            )}

            {runs.length === 0 && !error && (
                <div className="rounded-2xl border border-border bg-bg-elevated p-6 text-sm text-text-muted">
                    {t(
                        '暂无评审记录 — 用 fusion-code routine 或 reviewer 预设生成。',
                        'No review runs yet — generate with fusion-code routine or a reviewer preset.'
                    )}
                </div>
            )}

            {runs.map((run) => {
                const open = run.findings.filter((f) => f.state === 'open').length;
                return (
                    <div
                        key={run.id}
                        className="rounded-2xl border border-border bg-bg-elevated p-4 shadow-sm shadow-zinc-900/5"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 text-sm font-medium">
                                    {run.preset} · {run.id}
                                    <span className="rounded-lg bg-bg-muted px-2 py-0.5 text-xs text-text-secondary">
                                        {t('待处理', 'open')}: {open}/{run.findings.length}
                                    </span>
                                </div>
                                <div className="mt-1 truncate text-xs text-text-muted" title={run.cwd}>
                                    {run.cwd} · {run.at}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => void exportToPr(run.id)}
                                disabled={busy === `export:${run.id}`}
                                className="flex shrink-0 items-center gap-1.5 rounded-xl bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:bg-brand/20 disabled:opacity-40"
                            >
                                <ExternalLink size={13} /> {t('导出到 PR', 'Export to PR')}
                            </button>
                        </div>
                        {exported && <div className="mt-2 text-xs text-brand">{exported}</div>}

                        <div className="mt-3 space-y-2">
                            {run.findings.map((finding, index) => {
                                const key = `${run.id}:${index}`;
                                const stateStyle =
                                    finding.state === 'resolved'
                                        ? 'opacity-50'
                                        : finding.state === 'dismissed'
                                          ? 'opacity-30'
                                          : '';
                                return (
                                    <div
                                        key={key}
                                        className={`rounded-xl border border-border bg-bg p-3 ${stateStyle}`}
                                    >
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span
                                                className={`rounded-lg px-2 py-0.5 text-xs font-medium ${severityStyle(finding.severity)}`}
                                            >
                                                {finding.severity}
                                            </span>
                                            <span className="font-mono text-xs text-text-secondary">
                                                {finding.file}:{finding.line ?? '?'}
                                            </span>
                                            <span className="text-sm">{finding.title}</span>
                                        </div>
                                        <div className="mt-1.5 text-xs text-text-muted">{finding.fix}</div>
                                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => void jumpToDiff(run.id, index)}
                                                className="flex items-center gap-1 rounded-lg bg-bg-muted px-2 py-1 text-xs text-text-secondary transition-colors hover:text-text-primary"
                                            >
                                                <FileDiff size={12} /> {t('定位 diff', 'Jump to diff')}
                                            </button>
                                            {finding.state !== 'resolved' && (
                                                <button
                                                    type="button"
                                                    onClick={() => void updateState(run.id, index, 'resolved')}
                                                    className="flex items-center gap-1 rounded-lg bg-brand/10 px-2 py-1 text-xs text-brand transition-colors hover:bg-brand/20"
                                                >
                                                    <CheckCircle2 size={12} /> {t('解决', 'Resolve')}
                                                </button>
                                            )}
                                            {finding.state !== 'dismissed' && (
                                                <button
                                                    type="button"
                                                    onClick={() => void updateState(run.id, index, 'dismissed')}
                                                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-text-muted transition-colors hover:text-error"
                                                >
                                                    <XCircle size={12} /> {t('忽略', 'Dismiss')}
                                                </button>
                                            )}
                                            {finding.state !== 'open' && (
                                                <button
                                                    type="button"
                                                    onClick={() => void updateState(run.id, index, 'open')}
                                                    className="rounded-lg px-2 py-1 text-xs text-text-muted underline-offset-2 hover:underline"
                                                >
                                                    {t('重开', 'Reopen')}
                                                </button>
                                            )}
                                            {busy === key && <span className="text-xs text-text-muted">…</span>}
                                        </div>
                                        {openDiff?.key === key && (
                                            <pre className="mt-2 max-h-64 overflow-auto rounded-xl border border-border bg-bg-muted p-2 text-[11px] leading-relaxed">
                                                {hunkForLine(openDiff.text, finding.line)}
                                            </pre>
                                        )}
                                    </div>
                                );
                            })}
                            {run.findings.length === 0 && (
                                <div className="text-xs text-text-muted">{t('无发现', 'No findings')}</div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
