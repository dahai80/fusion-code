import { BarChart3, Code2, FolderGit2, MessageSquare, Settings, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from './i18n';
import { ReposPage } from './pages/ReposPage';
import { ReviewsPage } from './pages/ReviewsPage';
import { SessionPage } from './pages/SessionPage';
import { SessionsPage } from './pages/SessionsPage';
import { SettingsPage } from './pages/SettingsPage';
import { UsagePage } from './pages/UsagePage';
import { isEmbedded } from './theme';

// Hash router (no router dep): #/sessions (default), #/session/:id,
// #/repos, #/reviews, #/usage, #/settings. Standalone shows its own top nav;
// embedded (?embedded=1 or iframe) the shell owns the chrome so own nav hides.
type Route = { name: 'sessions' | 'repos' | 'settings' | 'usage' | 'reviews' } | { name: 'session'; id: string };

function parseHash(): Route {
    const hash = location.hash.replace(/^#\/?/, '');
    const parts = hash.split('/').filter(Boolean);
    if (parts[0] === 'session' && parts[1]) return { name: 'session', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'repos') return { name: 'repos' };
    if (parts[0] === 'reviews') return { name: 'reviews' };
    if (parts[0] === 'usage') return { name: 'usage' };
    if (parts[0] === 'settings') return { name: 'settings' };
    return { name: 'sessions' };
}

export function navigate(route: string): void {
    location.hash = route;
}

export function App() {
    const [route, setRoute] = useState<Route>(parseHash);
    const t = useT();
    const embedded = isEmbedded() || new URLSearchParams(location.search).get('embedded') === '1';

    useEffect(() => {
        const onHash = () => setRoute(parseHash());
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, []);

    const navItems = [
        {
            path: '#/sessions',
            label: t('会话', 'Sessions'),
            icon: MessageSquare,
            active: route.name === 'sessions' || route.name === 'session',
        },
        { path: '#/repos', label: t('仓库', 'Repos'), icon: FolderGit2, active: route.name === 'repos' },
        { path: '#/reviews', label: t('评审', 'Reviews'), icon: ShieldCheck, active: route.name === 'reviews' },
        { path: '#/usage', label: t('用量', 'Usage'), icon: BarChart3, active: route.name === 'usage' },
        {
            path: '#/settings',
            label: t('权限与环境', 'Permissions'),
            icon: Settings,
            active: route.name === 'settings',
        },
    ];

    return (
        <div className="min-h-screen bg-bg text-text-primary">
            {!embedded && (
                <header className="sticky top-0 z-10 border-b border-border bg-bg-elevated/90 backdrop-blur">
                    <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
                        <div className="flex items-center gap-2">
                            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand/15 text-brand">
                                <Code2 size={18} />
                            </span>
                            <span className="text-sm font-semibold tracking-wide">Fusion Code</span>
                        </div>
                        <nav className="flex items-center gap-1">
                            {navItems.map((item) => (
                                <a
                                    key={item.path}
                                    href={item.path}
                                    className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm transition-colors ${
                                        item.active
                                            ? 'bg-brand/10 text-brand'
                                            : 'text-text-secondary hover:bg-bg-muted hover:text-text-primary'
                                    }`}
                                >
                                    <item.icon size={15} />
                                    {item.label}
                                </a>
                            ))}
                        </nav>
                    </div>
                </header>
            )}
            <main className="mx-auto max-w-6xl px-4 py-6">
                {route.name === 'sessions' && <SessionsPage />}
                {route.name === 'repos' && <ReposPage />}
                {route.name === 'reviews' && <ReviewsPage />}
                {route.name === 'usage' && <UsagePage />}
                {route.name === 'settings' && <SettingsPage />}
                {route.name === 'session' && <SessionPage sessionId={route.id} />}
            </main>
        </div>
    );
}
