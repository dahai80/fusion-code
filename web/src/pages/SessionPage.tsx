import { ArrowLeft, CheckCircle2, FileDiff, Loader2, ShieldCheck, Terminal, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileChange, SessionEvent, SessionPermissions, WebSession } from '../../shared/types';
import { navigate } from '../App';
import { api, connectSessionWs } from '../api';
import { useT } from '../i18n';

// /session/:id — frame C2: conversation with inline per-step commands, live
// right-rail file changes, permission panel, follow-up composer.
export function SessionPage({ sessionId }: { sessionId: string }) {
    const t = useT();
    const [session, setSession] = useState<WebSession | null>(null);
    const [events, setEvents] = useState<SessionEvent[]>([]);
    const [changes, setChanges] = useState<FileChange[]>([]);
    const [permissions, setPermissions] = useState<SessionPermissions | null>(null);
    const [running, setRunning] = useState(false);
    const [input, setInput] = useState('');
    const [error, setError] = useState('');
    const bottomRef = useRef<HTMLDivElement>(null);

    const load = useCallback(async () => {
        try {
            const detail = await api.getSession(sessionId);
            setSession(detail.session);
            setEvents(detail.events);
            setChanges(detail.changes);
            setRunning(detail.running);
            const permRes = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/permissions`);
            if (permRes.ok) {
                setPermissions(((await permRes.json()) as { permissions: SessionPermissions }).permissions);
            }
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

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [events.length]);

    const send = async () => {
        const message = input.trim();
        if (!message || running) return;
        setInput('');
        setError('');
        try {
            await api.startRun(sessionId, message);
        } catch (err) {
            setError(String(err));
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

                    {/* Follow-up composer (mid-run instruction = next turn input) */}
                    <div className="rounded-2xl border border-border bg-bg-elevated p-3 shadow-sm shadow-zinc-900/5">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                    e.preventDefault();
                                    void send();
                                }
                            }}
                            placeholder={t(
                                '追加指令或纠正… (⌘+Enter 发送)',
                                'Follow-up instruction or correction… (⌘+Enter to send)'
                            )}
                            rows={2}
                            disabled={running}
                            className="w-full resize-none rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-50"
                        />
                        <div className="mt-2 flex justify-end">
                            <button
                                type="button"
                                onClick={() => void send()}
                                disabled={running || !input.trim()}
                                className="rounded-xl bg-brand px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                            >
                                {t('发送', 'Send')}
                            </button>
                        </div>
                    </div>
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
                                <div key={file.path} className="flex items-center gap-2 text-xs">
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
        </div>
    );
}
