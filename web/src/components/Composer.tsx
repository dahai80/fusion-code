import { ArrowUp, Paperclip, Settings2, Square } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useT } from '../i18n';

// FCS-1 five-zone session composer (fusion-composer-standard-1101 §1-§5):
// ① context chips row (caller-provided) ② attachment chips (absent on the
// Code face) ③ auto-grow textarea (1→8 lines, then inner scroll) ④ tool row —
// left 📎→＠ reference entry, right [⚙ params popup][⬆ send] with the three
// send states (disabled / enabled / stop-while-running) — ⑤ persistent hint
// row. Shortcuts per §3: Enter send · Shift+Enter newline · Esc stop or close
// popup · ⌘K palette · '/' at line start palette. The send button never
// changes label — only form (icon swap ⬆→⏹).

export function Composer(props: {
    value: string;
    onChange: (value: string) => void;
    onSend: () => void;
    onStop: () => void;
    running: boolean;
    chips?: ReactNode;
    params?: ReactNode;
    placeholder: string;
    onOpenPalette?: () => void;
}) {
    const t = useT();
    const taRef = useRef<HTMLTextAreaElement>(null);
    const [paramsOpen, setParamsOpen] = useState(false);

    // Zone ③: auto-grow 1→8 lines (~176px), overflow scrolls beyond that.
    useEffect(() => {
        const ta = taRef.current;
        if (!ta) return;
        ta.style.height = 'auto';
        ta.style.height = `${Math.min(ta.scrollHeight, 176)}px`;
    }, [props.value]);

    // 📎→＠: the attach entry inserts an @ reference at the cursor (the Code
    // face references files by @path; there is no file-upload chip here).
    const insertAt = () => {
        const ta = taRef.current;
        if (!ta) return;
        const pos = ta.selectionStart ?? props.value.length;
        const next = `${props.value.slice(0, pos)}@${props.value.slice(ta.selectionEnd ?? pos)}`;
        props.onChange(next);
        requestAnimationFrame(() => {
            ta.focus();
            ta.setSelectionRange(pos + 1, pos + 1);
        });
    };

    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (!props.running && props.value.trim()) props.onSend();
            return;
        }
        if (e.key === 'Escape') {
            if (paramsOpen) {
                setParamsOpen(false);
                return;
            }
            if (props.running) {
                e.preventDefault();
                props.onStop();
            }
            return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            props.onOpenPalette?.();
            return;
        }
        if (e.key === '/' && props.onOpenPalette) {
            const pos = e.currentTarget.selectionStart ?? 0;
            const before = props.value.slice(0, pos);
            if (before === '' || before.endsWith('\n')) {
                e.preventDefault();
                props.onOpenPalette();
            }
        }
    };

    const canSend = !props.running && props.value.trim().length > 0;

    return (
        <div className="rounded-2xl border border-border bg-bg-elevated shadow-sm shadow-zinc-900/5 transition-shadow focus-within:ring-2 focus-within:ring-brand/30">
            {props.chips}
            <textarea
                ref={taRef}
                value={props.value}
                onChange={(e) => props.onChange(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={props.placeholder}
                rows={1}
                className="block w-full resize-none border-0 bg-transparent px-4 pt-3 pb-2 text-sm outline-none placeholder:text-text-muted"
            />
            <div className="flex items-center gap-1 px-3 pb-2">
                <button
                    type="button"
                    title={t('@ 引用文件', '@ reference a file')}
                    aria-label={t('@ 引用文件', '@ reference a file')}
                    onClick={() => insertAt()}
                    className="flex h-8 w-8 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-bg-muted hover:text-text-primary"
                >
                    <Paperclip size={15} />
                </button>
                <div className="flex-1" />
                {props.params && (
                    <div className="relative">
                        <button
                            type="button"
                            title={t('参数', 'Parameters')}
                            aria-label={t('参数', 'Parameters')}
                            onClick={() => setParamsOpen((v) => !v)}
                            className={`flex h-8 w-8 items-center justify-center rounded-xl transition-colors hover:bg-bg-muted ${
                                paramsOpen ? 'text-brand' : 'text-text-muted hover:text-text-primary'
                            }`}
                        >
                            <Settings2 size={15} />
                        </button>
                        {paramsOpen && (
                            <div className="absolute right-0 bottom-10 z-30 w-72 rounded-2xl border border-border bg-bg-elevated p-4 shadow-md shadow-zinc-900/10">
                                {props.params}
                                <div className="mt-2 text-right">
                                    <button
                                        type="button"
                                        onClick={() => setParamsOpen(false)}
                                        className="text-xs text-text-muted transition-colors hover:text-text-primary"
                                    >
                                        {t('完成', 'Done')}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                {props.running ? (
                    <button
                        type="button"
                        title={t('停止', 'Stop')}
                        aria-label={t('停止', 'Stop')}
                        onClick={props.onStop}
                        className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white transition-opacity hover:opacity-90"
                    >
                        <Square size={13} fill="currentColor" />
                    </button>
                ) : (
                    <button
                        type="button"
                        title={t('发送', 'Send')}
                        aria-label={t('发送', 'Send')}
                        onClick={props.onSend}
                        disabled={!canSend}
                        className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white transition-opacity hover:opacity-90 disabled:bg-bg-muted disabled:text-text-muted"
                    >
                        <ArrowUp size={17} />
                    </button>
                )}
            </div>
            <div className="px-4 pb-2 text-[11px] text-text-muted">
                {props.running
                    ? t('生成中 · Esc 停止', 'Generating · Esc to stop')
                    : t('Enter 发送 · Shift+Enter 换行 · ⌘K 命令', 'Enter to send · Shift+Enter newline · ⌘K commands')}
            </div>
        </div>
    );
}
