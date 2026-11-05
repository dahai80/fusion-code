import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowCommand } from '../../shared/types';
import { useT } from '../i18n';

// Issue #241: command palette over the curated workflow-command registry.
// Selecting an entry fills the session composer with its prompt template —
// print mode executes prompts, not slash commands, so entries carry
// natural-language prompts rather than kernel slash names.

const CATEGORY_LABELS: Record<WorkflowCommand['category'], [string, string]> = {
    plan: ['规划', 'Plan'],
    review: ['审查', 'Review'],
    security: ['安全', 'Security'],
    git: ['Git', 'Git'],
    quality: ['质量', 'Quality'],
    docs: ['文档', 'Docs'],
};

export function CommandPalette(props: {
    commands: WorkflowCommand[];
    onClose: () => void;
    onSelect: (command: WorkflowCommand) => void;
}) {
    const t = useT();
    const [query, setQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const grouped = useMemo(() => {
        const q = query.trim().toLowerCase();
        const matched = props.commands.filter((c) => {
            if (!q) return true;
            return (
                c.name.includes(q) ||
                c.descriptionEn.toLowerCase().includes(q) ||
                c.descriptionZh.includes(query.trim()) ||
                c.category.includes(q)
            );
        });
        const order: WorkflowCommand['category'][] = ['plan', 'review', 'security', 'git', 'quality', 'docs'];
        return order
            .map((cat) => ({ cat, items: matched.filter((c) => c.category === cat) }))
            .filter((g) => g.items.length > 0);
    }, [props.commands, query]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-950/40 pt-[12vh] backdrop-blur-sm"
            onClick={props.onClose}
            onKeyDown={(e) => {
                if (e.key === 'Escape') props.onClose();
            }}
            role="presentation"
        >
            <div
                className="w-[560px] max-w-[92vw] overflow-hidden rounded-2xl border border-border bg-bg-elevated shadow-md shadow-zinc-900/10"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                role="dialog"
                aria-label={t('命令面板', 'Command palette')}
            >
                <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                    <Search size={16} className="opacity-50" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') props.onClose();
                        }}
                        placeholder={t('搜索工作流命令…', 'Search workflow commands…')}
                        className="w-full bg-transparent text-sm outline-none"
                    />
                    <button
                        type="button"
                        onClick={props.onClose}
                        className="rounded-lg p-1 opacity-60 transition-opacity hover:opacity-100"
                        aria-label={t('关闭', 'Close')}
                    >
                        <X size={16} />
                    </button>
                </div>
                <div className="max-h-[52vh] overflow-y-auto p-2">
                    {grouped.length === 0 && (
                        <div className="px-3 py-6 text-center text-sm opacity-50">
                            {t('没有匹配的命令', 'No matching commands')}
                        </div>
                    )}
                    {grouped.map((g) => (
                        <div key={g.cat} className="mb-1">
                            <div className="px-3 py-1.5 text-xs font-medium opacity-50">
                                {t(CATEGORY_LABELS[g.cat][0], CATEGORY_LABELS[g.cat][1])}
                            </div>
                            {g.items.map((c) => (
                                <button
                                    key={c.name}
                                    type="button"
                                    onClick={() => props.onSelect(c)}
                                    className="w-full rounded-xl px-3 py-2 text-left transition-colors hover:bg-bg"
                                >
                                    <div className="text-sm font-medium">{c.name}</div>
                                    <div className="text-xs opacity-60">{t(c.descriptionZh, c.descriptionEn)}</div>
                                </button>
                            ))}
                        </div>
                    ))}
                </div>
                <div className="border-t border-border px-4 py-2 text-xs opacity-50">
                    {t('选择后填入输入框，可再编辑后发送', 'Picked prompt fills the composer — edit then send')}
                </div>
            </div>
        </div>
    );
}
