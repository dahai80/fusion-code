import { sdk } from './sdk';

// Follow the shell theme toggle inside the embedded iframe (tokens.css: dark
// is default, html.light flips the --fs-* palette). Standalone: initial mode
// from localStorage, else prefers-color-scheme, else dark.
const STORAGE_KEY = 'fusion.shell.theme';

type ThemeMode = 'dark' | 'light';

export function applyTheme(mode: ThemeMode): void {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('light', mode === 'light');
    document.documentElement.classList.toggle('dark', mode === 'dark');
}

export function initialTheme(): ThemeMode {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === 'light' || stored === 'dark') return stored;
    } catch {
        // storage unavailable — fall through
    }
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
        return 'light';
    }
    return 'dark';
}

export function initTheme(): () => void {
    applyTheme(isEmbedded() ? sdk.theme.get() : initialTheme());
    const unsubscribe = sdk.theme.subscribe((mode) => {
        applyTheme(mode);
        try {
            localStorage.setItem(STORAGE_KEY, mode);
        } catch {
            // storage unavailable — theme still applies for this session
        }
    });
    return unsubscribe;
}

export function isEmbedded(): boolean {
    return typeof window !== 'undefined' && window.parent !== window;
}
