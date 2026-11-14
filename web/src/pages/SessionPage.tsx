import {
    ArrowLeft,
    CheckCircle2,
    FileDiff,
    FileDown,
    Folder,
    GitBranch,
    GitPullRequest,
    History,
    Loader2,
    Palette,
    RotateCcw,
    ShieldCheck,
    Terminal,
    X,
    XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
    DiffComment,
    FileChange,
    RepoRecord,
    SessionEvent,
    SessionPermissions,
    WebSession,
    WorkflowCommand,
} from '../../shared/types';
import { navigate } from '../App';
import { API_BASE, api, connectSessionWs } from '../api';
import { CommandPalette } from '../components/CommandPalette';
import { Composer } from '../components/Composer';
import { useT } from '../i18n';

// /session/:id — frame C2: conversation with inline per-step commands, live
// right-rail file changes, permission panel, follow-up composer. #229 adds
// checkpoints (verify/rollback), per-file diff viewer and the PR flow.
export function SessionPage({ sessionId }: { sessionId: string }) {
    const t = useT();
    const [session, setSession] = useState<WebSession | null>(null);
    const [events, setEvents] = useState<SessionEvent[]>([]);
    const [changes, setChanges] = useState<FileChange[]>([]);
    const [permissions, setPermissions] = useState<SessionPermissions | null>(null);
    const [running, setRunning] = useState(false);
    const [input, setInput] = useState('');
    const [error, setError] = useState('');
    const [diffView, setDiffView] = useState<{ path: string; text: string; loading: boolean } | null>(null);
    // #237: inline diff comments — anchored to a clicked diff line.
    const [diffComments, setDiffComments] = useState<DiffComment[]>([]);
    const [commentLine, setCommentLine] = useState<number | null>(null);
    const [commentText, setCommentText] = useState('');
    const [commentBusy, setCommentBusy] = useState(false);
    const [cpBusy, setCpBusy] = useState<string | null>(null);
    const [prOpen, setPrOpen] = useState(false);
    const [prTitle, setPrTitle] = useState('');
    const [prBody, setPrBody] = useState('');
    const [prBusy, setPrBusy] = useState(false);
    // Issue #241: command palette + transcript export.
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [commands, setCommands] = useState<WorkflowCommand[]>([]);
    const [exporting, setExporting] = useState(false);
    // FCS-1 (issue #228): composer context chips + ⚙ params (model pick,
    // environment template display).
    const [repo, setRepo] = useState<RepoRecord | null>(null);
    const [modelPick, setModelPick] = useState('');
    const [modelDefault, setModelDefault] = useState<string | undefined>(undefined);
    const [setupBusy, setSetupBusy] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        api.listCommands()
            .then((res) => setCommands(res.commands))
            .catch(() => {});
    }, []);

    // FCS-1 §3: ⌘K opens the command palette globally, not just when the
    // composer textarea is focused.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setPaletteOpen(true);
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);

    const load = useCallback(async () => {
        try {
            const detail = await api.getSession(sessionId);
            setSession(detail.session);
            setEvents(detail.events);
            setChanges(detail.changes);
            setRunning(detail.running);
            const permRes = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/permissions`);
            if (permRes.ok) {
                setPermissions(((await permRes.json()) as { permissions: SessionPermissions }).permissions);
            }
            // FCS-1: composer context chips + ⚙ params need the repo record
            // (name/environment/setup) and the model capability surface.
            api.getRepo(detail.session.repoId).then((r) => setRepo(r.repo)).catch(() => {});
            api.modelInfo().then((m) => setModelDefault(m.defaultModel)).catch(() => {});
            setError('');
        } catch (err) {
            setError(String(err));
        }
    }, [sessionId]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        const disconnect = connectSessionWs(
            sessionId,
            (event) => {
                setEvents((prev) => {
                    if (prev.length > 0 && prev[prev.length - 1].seq >= event.seq) return prev;
                    return [...prev, event];
                });
                if (event.kind === 'file_changes') setChanges(event.files);
                if (event.kind === 'turn_started') setRunning(true);
                if (event.kind === 'turn_completed' || event.kind === 'turn_error') setRunning(false);
            },
            (isRunning) => setRunning(isRunning)
        );
        return disconnect;
    }, [sessionId]);

    // biome notes: runs each render on purpose — autoscroll as the stream grows
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    });

    // #229: checkpoints are recorded server-side at each prompt; refresh the
    // session record when a turn ends so the Checkpoints rail picks them up.
    const lastEvent = events.length > 0 ? events[events.length - 1] : null;
    const turnEnded = lastEvent?.kind === 'turn_completed' || lastEvent?.kind === 'turn_error';
    useEffect(() => {
        if (!turnEnded) return;
        void api
            .getSession(sessionId)
            .then((detail) => setSession(detail.session))
            .catch(() => {});
    }, [turnEnded, sessionId]);

    const send = async () => {
        const message = input.trim();
        if (!message || running) return;
        setInput('');
        setError('');
        try {
            await api.startRun(sessionId, message, modelPick.trim() || undefined);
        } catch (err) {
            setError(String(err));
        }
    };

    // FCS-1: running-state send button becomes the stop control.
    const stop = async () => {
        try {
            await api.cancelRun(sessionId);
        } catch (err) {
            setError(String(err));
        }
    };

    // Issue #241: download the kernel transcript as markdown.
    const exportTranscript = async () => {
        if (exporting) return;
        setExporting(true);
        setError('');
        try {
            await api.exportTranscript(sessionId);
        } catch (err) {
            setError(String(err));
        } finally {
            setExporting(false);
        }
    };

    const updatePermissions = async (mode: 'allowlist' | 'ask', tools: string[]) => {
        try {
            const { permissions: perms } = await api.setPermissions(sessionId, mode, tools);
            setPermissions(perms);
        } catch (err) {
            setError(String(err));
        }
    };

    const toggleTool = async (tool: string) => {
        if (!permissions) return;
        const has = permissions.allowedTools.includes(tool);
        const tools = has ? permissions.allowedTools.filter((x) => x !== tool) : [...permissions.allowedTools, tool];
        await updatePermissions(permissions.mode, tools);
    };

    const steps = useMemo(() => events.filter((e) => e.kind !== 'file_changes'), [events]);
    const shownChanges = useMemo(() => {
        const last = [...events].reverse().find((e) => e.kind === 'file_changes');
        return last && last.kind === 'file_changes' ? last.files : changes;
    }, [events, changes]);

    const TOOL_CHOICES = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash'];

    // #229: open the per-file diff panel. #237: load its inline comments.
    const openDiff = async (filePath: string) => {
        setDiffView({ path: filePath, text: '', loading: true });
        setCommentLine(null);
        setCommentText('');
        try {
            const [res, commentsRes] = await Promise.all([
                api.fileDiff(sessionId, filePath),
                api.listDiffComments(sessionId),
            ]);
            setDiffView({ path: filePath, text: res.diff, loading: false });
            setDiffComments(commentsRes.comments.filter((c) => c.path === filePath));
        } catch (err) {
            setError(String(err));
            setDiffView(null);
        }
    };

    // #237: attach a comment to a diff line.
    const submitComment = async () => {
        if (!diffView || commentLine === null || !commentText.trim()) return;
        setCommentBusy(true);
        setError('');
        try {
            const { comment } = await api.addDiffComment(sessionId, {
                path: diffView.path,
                line: commentLine,
                text: commentText.trim(),
            });
            setDiffComments((prev) => [...prev, comment]);
            setCommentLine(null);
            setCommentText('');
        } catch (err) {
            setError(String(err));
        } finally {
            setCommentBusy(false);
        }
    };

    // #229: checkpoint verify — runs the repo's testCommand.
    const verifyCheckpoint = async (messageUuid: string) => {
        setCpBusy(messageUuid);
        setError('');
        try {
            await api.verifyCheckpoint(sessionId, messageUuid);
            const detail = await api.getSession(sessionId);
            setSession(detail.session);
        } catch (err) {
            setError(String(err));
        } finally {
            setCpBusy(null);
        }
    };

    // #229: checkpoint rollback — kernel --rewind-files restore.
    const rollbackCheckpoint = async (messageUuid: string) => {
        if (
            !window.confirm(
                t(
                    '回滚到该检查点？当前工作区改动会被还原。',
                    'Roll back to this checkpoint? Current worktree changes will be restored.'
                )
            )
        )
            return;
        setCpBusy(messageUuid);
        setError('');
        try {
            await api.rollbackCheckpoint(sessionId, messageUuid);
            const detail = await api.getSession(sessionId);
            setSession(detail.session);
            setChanges(detail.changes);
        } catch (err) {
            setError(String(err));
        } finally {
            setCpBusy(null);
        }
    };

    // #229: PR flow.
    const openPrDialog = () => {
        setPrTitle(session?.title ?? '');
        setPrBody('');
        setPrOpen(true);
    };
    const submitPr = async () => {
        setPrBusy(true);
        setError('');
        try {
            await api.createPr(sessionId, { title: prTitle.trim(), body: prBody.trim() });
            const detail = await api.getSession(sessionId);
            setSession(detail.session);
            setPrOpen(false);
        } catch (err) {
            setError(String(err));
        } finally {
            setPrBusy(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={() => navigate('/sessions')}
                    className="rounded-xl p-1.5 text-text-secondary transition-colors hover:bg-bg-muted hover:text-text-primary"
                >
                    <ArrowLeft size={18} />
                </button>
                <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{session?.title ?? sessionId}</h1>
                {running ? (
                    <span className="flex items-center gap-1.5 rounded-xl bg-running/10 px-3 py-1 text-sm text-running">
                        <Loader2 size={14} className="animate-spin" />
                        {t('执行中', 'Running')}
                    </span>
                ) : (
                    <span className="rounded-xl bg-bg-muted px-3 py-1 text-sm text-text-muted">
                        {t('空闲', 'Idle')}
                    </span>
                )}
            </div>

            {error && (
                <div className="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
                    {error}
                </div>
            )}

            <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
                {/* Conversation column */}
                <div className="space-y-3">
                    {/* #231: design handoff context card */}
                    {session?.designContext && (
                        <div className="rounded-2xl border border-brand/30 bg-brand/5 p-4">
                            <div className="flex items-center gap-2">
                                <Palette size={15} className="text-brand" />
                                <span className="text-sm font-medium">
                                    {t('设计交付', 'Design handoff')}: {session.designContext.component}
                                </span>
                                <span
                                    className={`ml-auto rounded-lg px-2 py-0.5 text-xs ${
                                        session.designPending ? 'bg-brand/15 text-brand' : 'bg-bg-muted text-text-muted'
                                    }`}
                                >
                                    {session.designPending
                                        ? t('将随首条指令发送', 'Attached to first run')
                                        : t('已注入首轮上下文', 'Delivered in first run')}
                                </span>
                            </div>
                            <div className="mt-2 space-y-1">
                                {session.designContext.files.map((file) => (
                                    <details key={file.path} className="rounded-xl bg-bg-elevated px-3 py-2">
                                        <summary className="cursor-pointer truncate font-mono text-xs text-text-secondary">
                                            {file.name}
                                            <span className="ml-2 text-text-muted">{file.language}</span>
                                        </summary>
                                        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-text-secondary">
                                            {file.content}
                                        </pre>
                                    </details>
                                ))}
                            </div>
                        </div>
                    )}
                    {steps.length === 0 && (
                        <div className="rounded-2xl border border-dashed border-border bg-bg-elevated p-6 text-center text-sm text-text-muted">
                            {t('发送第一条指令开始任务。', 'Send the first instruction to start the task.')}
                        </div>
                    )}
                    {steps.map((event) => {
                        if (event.kind === 'turn_started') {
                            return (
                                <div
                                    key={event.seq}
                                    className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-brand/15 px-4 py-2.5 text-sm"
                                >
                                    {event.text}
                                </div>
                            );
                        }
                        if (event.kind === 'assistant_text') {
                            return (
                                <div
                                    key={event.seq}
                                    className="whitespace-pre-wrap rounded-2xl border border-border bg-bg-elevated px-4 py-3 text-sm leading-relaxed"
                                >
                                    {event.text}
                                </div>
                            );
                        }
                        if (event.kind === 'tool_use') {
                            return (
                                <div
                                    key={event.seq}
                                    className="flex items-center gap-2 rounded-xl bg-bg-muted px-3 py-2 text-xs text-text-secondary"
                                >
                                    <Terminal size={13} className="shrink-0 text-brand" />
                                    <span className="font-medium">{event.toolName}</span>
                                    {event.input && <span className="truncate opacity-80">{event.input}</span>}
                                </div>
                            );
                        }
                        if (event.kind === 'tool_result') {
                            return (
                                <div
                                    key={event.seq}
                                    className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${
                                        event.isError ? 'bg-error/10 text-error' : 'bg-success/5 text-text-secondary'
                                    }`}
                                >
                                    {event.isError ? (
                                        <XCircle size={13} className="mt-0.5 shrink-0" />
                                    ) : (
                                        <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" />
                                    )}
                                    <span className="max-h-24 overflow-y-auto whitespace-pre-wrap break-all">
                                        {event.content}
                                    </span>
                                </div>
                            );
                        }
                        if (event.kind === 'turn_completed') {
                            return (
                                <div key={event.seq} className="flex items-center gap-2 text-xs text-success">
                                    <CheckCircle2 size={13} />
                                    {t(
                                        `完成 · ${event.num_turns} 轮 · ${(event.duration_ms / 1000).toFixed(1)}s`,
                                        `Done · ${event.num_turns} turns · ${(event.duration_ms / 1000).toFixed(1)}s`
                                    )}
                                </div>
                            );
                        }
                        if (event.kind === 'turn_error') {
                            return (
                                <div key={event.seq} className="flex items-center gap-2 text-xs text-error">
                                    <XCircle size={13} />
                                    {event.text}
                                </div>
                            );
                        }
                        return null;
                    })}
                    <div ref={bottomRef} />

                    {/* Follow-up composer (mid-run instruction = next turn input).
                        FCS-1 five-zone anatomy: context chips / auto-grow input /
                        tool row (📎→＠ left, ⚙+⬆ right) / persistent hint row. */}
                    <Composer
                        value={input}
                        onChange={setInput}
                        onSend={() => void send()}
                        onStop={() => void stop()}
                        running={running}
                        onOpenPalette={() => setPaletteOpen(true)}
                        placeholder={t('输入消息，@ 引用，/ 命令', 'Type a message, @ to reference, / for commands')}
                        chips={
                            repo ? (
                                <div className="flex items-center gap-2 px-4 pt-3">
                                    <span className="flex items-center gap-1.5 rounded-lg bg-bg-muted px-2 py-0.5 text-xs text-text-secondary">
                                        <Folder size={12} />
                                        {repo.name}
                                    </span>
                                    <span className="flex items-center gap-1.5 rounded-lg bg-bg-muted px-2 py-0.5 text-xs text-text-secondary">
                                        <GitBranch size={12} />
                                        {session?.branch ?? ''}
                                    </span>
                                </div>
                            ) : undefined
                        }
                        params={
                            <div className="space-y-3">
                                <div>
                                    <div className="text-xs font-medium text-text-secondary">{t('模型', 'Model')}</div>
                                    <input
                                        value={modelPick}
                                        onChange={(e) => setModelPick(e.target.value)}
                                        placeholder={modelDefault ?? t('默认（策略链）', 'default (policy chain)')}
                                        className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-1.5 text-sm outline-none focus:border-brand"
                                    />
                                </div>
                                <div>
                                    <div className="text-xs font-medium text-text-secondary">
                                        {t('环境模板', 'Environment template')}
                                    </div>
                                    <div className="mt-1 rounded-xl bg-bg-muted px-3 py-2 text-xs text-text-secondary">
                                        <div>{repo?.environment || t('未配置', 'not configured')}</div>
                                        {repo?.setupCommand && (
                                            <div className="mt-1 font-mono text-[11px] text-text-muted">
                                                {repo.setupCommand}
                                            </div>
                                        )}
                                    </div>
                                    {repo?.setupCommand && (
                                        <button
                                            type="button"
                                            disabled={setupBusy}
                                            onClick={() => {
                                                setSetupBusy(true);
                                                api.runSetup(repo.id)
                                                    .catch(() => {})
                                                    .finally(() => setSetupBusy(false));
                                            }}
                                            className="mt-2 rounded-xl border border-border px-3 py-1 text-xs transition-colors hover:bg-bg-muted disabled:opacity-40"
                                        >
                                            {setupBusy ? t('运行中…', 'Running…') : t('运行 setup', 'Run setup')}
                                        </button>
                                    )}
                                </div>
                            </div>
                        }
                    />
                    {paletteOpen && (
                        <CommandPalette
                            commands={commands}
                            onClose={() => setPaletteOpen(false)}
                            onSelect={(cmd) => {
                                setInput(cmd.prompt);
                                setPaletteOpen(false);
                            }}
                        />
                    )}
                </div>

                {/* Right rail: live file changes + permissions (C2) */}
                <aside className="space-y-4">
                    <div className="rounded-2xl border border-border bg-bg-elevated p-4 shadow-sm shadow-zinc-900/5">
                        <h2 className="flex items-center gap-2 text-sm font-medium">
                            <FileDiff size={15} className="text-brand" />
                            {t('改动', 'Changes')}
                            <span className="rounded-lg bg-bg-muted px-2 py-0.5 text-xs text-text-muted">
                                {shownChanges.length}
                            </span>
                        </h2>
                        <div className="mt-3 space-y-1.5">
                            {shownChanges.length === 0 && (
                                <div className="text-xs text-text-muted">
                                    {t('暂无文件改动', 'No file changes yet')}
                                </div>
                            )}
                            {shownChanges.map((file) => (
                                <button
                                    key={file.path}
                                    type="button"
                                    onClick={() => void openDiff(file.path)}
                                    title={t('查看 diff', 'View diff')}
                                    className="flex w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left text-xs transition-colors hover:bg-bg-muted"
                                >
                                    <span
                                        className={`w-4 shrink-0 text-center font-mono ${
                                            file.status === 'A'
                                                ? 'text-success'
                                                : file.status === 'D'
                                                  ? 'text-error'
                                                  : 'text-warning'
                                        }`}
                                    >
                                        {file.status}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-text-secondary" title={file.path}>
                                        {file.path}
                                    </span>
                                    <span className="shrink-0 font-mono text-success">+{file.additions}</span>
                                    <span className="shrink-0 font-mono text-error">-{file.deletions}</span>
                                </button>
                            ))}
                        </div>
                        {/* #229: PR flow entry */}
                        {session?.prUrl ? (
                            <a
                                href={session.prUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-success/10 px-3 py-1.5 text-xs text-success transition-colors hover:bg-success/20"
                            >
                                <GitPullRequest size={13} />
                                {t('查看 PR', 'View PR')}
                            </a>
                        ) : (
                            <button
                                type="button"
                                onClick={openPrDialog}
                                disabled={running || shownChanges.length === 0}
                                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand/10 px-3 py-1.5 text-xs text-brand transition-colors hover:bg-brand/20 disabled:opacity-40"
                            >
                                <GitPullRequest size={13} />
                                {t('创建 PR', 'Create PR')}
                            </button>
                        )}
                    </div>

                    {/* #229: checkpoints (prompt snapshots) with verify/rollback */}
                    <div className="rounded-2xl border border-border bg-bg-elevated p-4 shadow-sm shadow-zinc-900/5">
                        <h2 className="flex items-center gap-2 text-sm font-medium">
                            <History size={15} className="text-brand" />
                            {t('检查点', 'Checkpoints')}
                            <span className="rounded-lg bg-bg-muted px-2 py-0.5 text-xs text-text-muted">
                                {session?.checkpoints?.length ?? 0}
                            </span>
                            <button
                                type="button"
                                onClick={() => void exportTranscript()}
                                disabled={exporting || !session?.kernelSessionId}
                                title={t('导出会话记录 (Markdown)', 'Export session transcript (Markdown)')}
                                className="ml-auto rounded-lg p-1 opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
                            >
                                <FileDown size={15} />
                            </button>
                        </h2>
                        <div className="mt-3 space-y-2">
                            {(session?.checkpoints ?? []).length === 0 && (
                                <div className="text-xs text-text-muted">
                                    {t('每次发送指令时自动创建检查点。', 'A checkpoint is created at every prompt.')}
                                </div>
                            )}
                            {[...(session?.checkpoints ?? [])].reverse().map((cp) => (
                                <div key={cp.messageUuid} className="rounded-xl bg-bg-muted px-2.5 py-2">
                                    <div className="flex items-center gap-1.5">
                                        {cp.verified && (
                                            <span
                                                className={`shrink-0 ${cp.verified.ok ? 'text-success' : 'text-error'}`}
                                                title={cp.verified.output}
                                            >
                                                {cp.verified.ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                                            </span>
                                        )}
                                        <span
                                            className="min-w-0 flex-1 truncate text-xs text-text-secondary"
                                            title={cp.label}
                                        >
                                            {cp.label}
                                        </span>
                                    </div>
                                    <div className="mt-1.5 flex gap-1.5">
                                        <button
                                            type="button"
                                            onClick={() => void verifyCheckpoint(cp.messageUuid)}
                                            disabled={cpBusy !== null || running}
                                            className="rounded-lg bg-bg px-2 py-1 text-[11px] text-text-secondary transition-colors hover:text-text-primary disabled:opacity-40"
                                        >
                                            {cpBusy === cp.messageUuid
                                                ? t('验证中…', 'Verifying…')
                                                : t('验证', 'Verify')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void rollbackCheckpoint(cp.messageUuid)}
                                            disabled={cpBusy !== null || running}
                                            className="flex items-center gap-1 rounded-lg bg-bg px-2 py-1 text-[11px] text-text-secondary transition-colors hover:text-error disabled:opacity-40"
                                        >
                                            <RotateCcw size={11} />
                                            {t('回滚', 'Rollback')}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-2xl border border-border bg-bg-elevated p-4 shadow-sm shadow-zinc-900/5">
                        <h2 className="flex items-center gap-2 text-sm font-medium">
                            <ShieldCheck size={15} className="text-brand" />
                            {t('权限', 'Permissions')}
                        </h2>
                        <div className="mt-3 flex gap-2">
                            <button
                                type="button"
                                onClick={() =>
                                    void updatePermissions(
                                        'allowlist',
                                        permissions?.allowedTools ?? ['Read', 'Glob', 'Grep']
                                    )
                                }
                                className={`flex-1 rounded-xl px-3 py-1.5 text-xs transition-colors ${
                                    permissions?.mode === 'allowlist'
                                        ? 'bg-brand/15 text-brand'
                                        : 'bg-bg-muted text-text-secondary'
                                }`}
                            >
                                {t('允许列表', 'Allowlist')}
                            </button>
                            <button
                                type="button"
                                onClick={() => void updatePermissions('ask', permissions?.allowedTools ?? [])}
                                className={`flex-1 rounded-xl px-3 py-1.5 text-xs transition-colors ${
                                    permissions?.mode === 'ask'
                                        ? 'bg-brand/15 text-brand'
                                        : 'bg-bg-muted text-text-secondary'
                                }`}
                            >
                                {t('每次确认', 'Ask every time')}
                            </button>
                        </div>
                        {/* #237: permission-tier hint — what the current tier lets the kernel do. */}
                        <p className="mt-2 text-xs leading-relaxed text-text-muted">
                            {permissions?.mode === 'ask'
                                ? t(
                                      '当前层级：每次确认 — 只读工具直接放行，写操作被拒绝并在会话中提示。',
                                      'Current tier: ask — read-only tools run, writes are denied and surfaced in-session.'
                                  )
                                : permissions?.allowedTools.every((x) => ['Read', 'Glob', 'Grep'].includes(x))
                                  ? t(
                                        '当前层级：只读 — 会话无法修改文件；勾选 Edit / Write / Bash 授予写入。',
                                        'Current tier: read-only — the session cannot modify files; check Edit / Write / Bash to grant writes.'
                                    )
                                  : t(
                                        '当前层级：允许列表 — 勾选的工具可执行，其余一律拒绝。',
                                        'Current tier: allowlist — checked tools run, everything else is denied.'
                                    )}
                        </p>
                        <div className="mt-3 space-y-1">
                            {TOOL_CHOICES.map((tool) => {
                                const active = permissions?.allowedTools.includes(tool) ?? false;
                                return (
                                    <button
                                        key={tool}
                                        type="button"
                                        onClick={() => void toggleTool(tool)}
                                        className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs transition-colors ${
                                            active ? 'bg-success/10 text-success' : 'text-text-muted hover:bg-bg-muted'
                                        }`}
                                    >
                                        <span
                                            className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-success' : 'bg-border'}`}
                                        />
                                        {tool}
                                    </button>
                                );
                            })}
                        </div>
                        <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
                            {t(
                                '“每次确认”模式下仅允许只读工具；写操作会被内核拒绝并在会话中提示。',
                                '"Ask every time" allows read-only tools only; writes are denied by the kernel and surfaced in the session.'
                            )}
                        </p>
                    </div>
                </aside>
            </div>

            {/* #229: diff viewer overlay */}
            {diffView && (
                <div
                    role="presentation"
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
                    onClick={() => setDiffView(null)}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') setDiffView(null);
                    }}
                >
                    <div
                        role="presentation"
                        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-border bg-bg-elevated shadow-md shadow-zinc-900/20"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={() => {}}
                    >
                        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                            <FileDiff size={15} className="text-brand" />
                            <span className="min-w-0 flex-1 truncate font-mono text-sm">{diffView.path}</span>
                            <button
                                type="button"
                                onClick={() => setDiffView(null)}
                                className="rounded-xl p-1 text-text-muted transition-colors hover:bg-bg-muted hover:text-text-primary"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-auto p-4">
                            {diffView.loading ? (
                                <div className="flex items-center gap-2 text-sm text-text-muted">
                                    <Loader2 size={14} className="animate-spin" />
                                    {t('加载 diff…', 'Loading diff…')}
                                </div>
                            ) : diffView.text ? (
                                <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed">
                                    {diffView.text.split('\n').map((line, i) => {
                                        const lineNo = i + 1;
                                        const lineComments = diffComments.filter((c) => c.line === lineNo);
                                        const clickable =
                                            !diffView.loading &&
                                            (line.startsWith('+') || line.startsWith('-')) &&
                                            !line.startsWith('+++') &&
                                            !line.startsWith('---');
                                        return (
                                            <span key={i} className="block">
                                                <span
                                                    role={clickable ? 'button' : undefined}
                                                    tabIndex={clickable ? 0 : undefined}
                                                    onClick={clickable ? () => setCommentLine(lineNo) : undefined}
                                                    onKeyDown={
                                                        clickable
                                                            ? (e) => {
                                                                  if (e.key === 'Enter') setCommentLine(lineNo);
                                                              }
                                                            : undefined
                                                    }
                                                    className={`block rounded ${
                                                        clickable
                                                            ? 'cursor-pointer hover:outline hover:outline-brand/40'
                                                            : ''
                                                    } ${
                                                        line.startsWith('+') && !line.startsWith('+++')
                                                            ? 'bg-success/10 text-success'
                                                            : line.startsWith('-') && !line.startsWith('---')
                                                              ? 'bg-error/10 text-error'
                                                              : line.startsWith('@@')
                                                                ? 'text-brand'
                                                                : 'text-text-secondary'
                                                    } ${commentLine === lineNo ? 'outline outline-brand' : ''}`}
                                                >
                                                    {line || ' '}
                                                </span>
                                                {lineComments.map((c) => (
                                                    <span
                                                        key={c.id}
                                                        className="my-0.5 block rounded-xl border border-brand/30 bg-brand/5 px-2 py-1 font-sans text-xs text-text-secondary"
                                                    >
                                                        {c.text}
                                                    </span>
                                                ))}
                                            </span>
                                        );
                                    })}
                                </pre>
                            ) : (
                                <div className="text-sm text-text-muted">{t('无 diff 内容', 'No diff content')}</div>
                            )}
                        </div>
                        {/* #237: inline comment composer — click a +/- diff line to anchor. */}
                        <div className="border-t border-border px-4 py-3">
                            {commentLine === null ? (
                                <div className="text-xs text-text-muted">
                                    {t(
                                        '点击 diff 中的 +/- 行可添加行内评论',
                                        'Click a +/- diff line to anchor an inline comment'
                                    )}
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <span className="shrink-0 rounded-lg bg-bg-muted px-2 py-1 font-mono text-xs text-text-muted">
                                        L{commentLine}
                                    </span>
                                    <input
                                        value={commentText}
                                        onChange={(e) => setCommentText(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') void submitComment();
                                        }}
                                        placeholder={t('评论内容…', 'Comment…')}
                                        className="min-w-0 flex-1 rounded-xl border border-border bg-bg px-3 py-1.5 text-sm outline-none focus:border-brand"
                                        autoFocus
                                    />
                                    <button
                                        type="button"
                                        onClick={() => void submitComment()}
                                        disabled={commentBusy || !commentText.trim()}
                                        className="flex shrink-0 items-center gap-1 rounded-xl bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                                    >
                                        {commentBusy ? <Loader2 size={13} className="animate-spin" /> : null}
                                        {t('添加', 'Add')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setCommentLine(null)}
                                        className="rounded-xl p-1 text-text-muted transition-colors hover:bg-bg-muted hover:text-text-primary"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* #229: PR dialog */}
            {prOpen && (
                <div
                    role="presentation"
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
                    onClick={() => !prBusy && setPrOpen(false)}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape' && !prBusy) setPrOpen(false);
                    }}
                >
                    <div
                        role="presentation"
                        className="w-full max-w-lg rounded-2xl border border-border bg-bg-elevated p-5 shadow-md shadow-zinc-900/20"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={() => {}}
                    >
                        <h2 className="flex items-center gap-2 text-base font-semibold">
                            <GitPullRequest size={17} className="text-brand" />
                            {t('创建 Pull Request', 'Create Pull Request')}
                        </h2>
                        <p className="mt-1 text-xs text-text-muted">
                            {t(
                                '将当前工作区改动提交到新分支并创建 PR。',
                                'Commit current worktree changes to a new branch and open a PR.'
                            )}
                        </p>
                        <input
                            value={prTitle}
                            onChange={(e) => setPrTitle(e.target.value)}
                            placeholder={t('PR 标题', 'PR title')}
                            className="mt-4 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-brand"
                        />
                        <textarea
                            value={prBody}
                            onChange={(e) => setPrBody(e.target.value)}
                            placeholder={t('PR 描述（可选）', 'PR description (optional)')}
                            rows={4}
                            className="mt-2 w-full resize-none rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-brand"
                        />
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setPrOpen(false)}
                                disabled={prBusy}
                                className="rounded-xl bg-bg-muted px-4 py-1.5 text-sm text-text-secondary transition-colors hover:text-text-primary disabled:opacity-40"
                            >
                                {t('取消', 'Cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={() => void submitPr()}
                                disabled={prBusy || !prTitle.trim()}
                                className="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                            >
                                {prBusy && <Loader2 size={13} className="animate-spin" />}
                                {t('创建', 'Create')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
