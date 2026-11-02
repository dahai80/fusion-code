import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { designSyncDir, pollDesignSyncOnce } from '../server/designSync';
import { buildDesignPrompt } from '../server/runner';
import { __resetStoreForTest, addRepo, listSessions } from '../server/store';

// #231: design handoff ingestion — notification file -> session with design
// context -> archived; first run consumes the context as prompt.

const tempDirs: string[] = [];

beforeEach(() => {
    const webDir = mkdtempSync(join(tmpdir(), 'fcweb-ds-web-'));
    const designDir = mkdtempSync(join(tmpdir(), 'fcweb-ds-design-'));
    tempDirs.push(webDir, designDir);
    process.env.FUSION_CODE_WEB_DATA_DIR = webDir;
    process.env.FUSION_DESIGN_DATA_DIR = designDir;
    delete process.env.FUSION_CODE_WEB_DESIGN_REPO_ID;
    __resetStoreForTest();
});

afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    delete process.env.FUSION_CODE_WEB_DATA_DIR;
    delete process.env.FUSION_DESIGN_DATA_DIR;
    delete process.env.FUSION_CODE_WEB_DESIGN_REPO_ID;
});

function ensureDesignDir(): string {
    const dir = designSyncDir();
    mkdirSync(dir, { recursive: true });
    return dir;
}

function writeNotification(component: string, files: string[]): string {
    const dir = ensureDesignDir();
    const path = join(dir, `${Date.now()}_test_1.json`);
    writeFileSync(
        path,
        JSON.stringify({
            target: 'FusionCode',
            action: 'sync-to-code',
            payload: { component, files },
        })
    );
    return path;
}

describe('designSync: notification ingestion (#231)', () => {
    test('creates session with design context and archives notification', async () => {
        const designDir = ensureDesignDir();
        const html = '<html><body>LoginCard</body></html>';
        const tsx = 'export function LoginCard() { return null; }';
        writeFileSync(join(designDir, 'FusionDesignExport.html'), html);
        writeFileSync(join(designDir, 'FusionDesignExport.tsx'), tsx);
        const notifyPath = writeNotification('LoginCard', [
            join(designDir, 'FusionDesignExport.html'),
            join(designDir, 'FusionDesignExport.tsx'),
        ]);
        addRepo({ name: 'demo', path: '/tmp/demo' });

        const ingested = await pollDesignSyncOnce();
        expect(ingested).toBe(1);
        expect(existsSync(notifyPath)).toBe(false);
        const processed = join(designDir, 'processed');
        expect(existsSync(processed)).toBe(true);

        const sessions = listSessions();
        expect(sessions.length).toBe(1);
        const session = sessions[0];
        expect(session.title).toBe('Design: LoginCard');
        expect(session.designPending).toBe(true);
        expect(session.designContext?.component).toBe('LoginCard');
        expect(session.designContext?.files.length).toBe(2);
        const htmlFile = session.designContext?.files.find((f) => f.name === 'FusionDesignExport.html');
        expect(htmlFile?.content).toBe(html);
        expect(htmlFile?.language).toBe('html');
    });

    test('deferred when no repos registered; retried on next poll', async () => {
        const designDir = ensureDesignDir();
        writeFileSync(join(designDir, 'Card.tsx'), 'export const Card = 1;');
        const notifyPath = writeNotification('Card', [join(designDir, 'Card.tsx')]);

        expect(await pollDesignSyncOnce()).toBe(0);
        expect(existsSync(notifyPath)).toBe(true);

        addRepo({ name: 'later', path: '/tmp/later' });
        expect(await pollDesignSyncOnce()).toBe(1);
        expect(existsSync(notifyPath)).toBe(false);
        expect(listSessions()[0].title).toBe('Design: Card');
    });

    test('foreign json files are skipped and left alone', async () => {
        mkdirSync(designSyncDir(), { recursive: true });
        const foreign = join(designSyncDir(), 'unrelated.json');
        writeFileSync(foreign, JSON.stringify({ target: 'Other', action: 'noop' }));
        addRepo({ name: 'demo', path: '/tmp/demo' });

        expect(await pollDesignSyncOnce()).toBe(0);
        expect(existsSync(foreign)).toBe(true);
        expect(listSessions().length).toBe(0);
    });

    test('env override pins the target repo', async () => {
        process.env.FUSION_CODE_WEB_DESIGN_REPO_ID = 'nonexistent-repo';
        const designDir = ensureDesignDir();
        writeFileSync(join(designDir, 'X.tsx'), 'export const X = 1;');
        writeNotification('X', [join(designDir, 'X.tsx')]);
        addRepo({ name: 'demo', path: '/tmp/demo' });

        // Override points at a repo that does not exist -> createSession
        // would attach to it; session creation succeeds but repo lookup for
        // branch falls back to main.
        expect(await pollDesignSyncOnce()).toBe(1);
        expect(listSessions()[0].branch).toBe('main');
    });
});

describe('buildDesignPrompt (#231)', () => {
    test('inlines files and component name', () => {
        const prompt = buildDesignPrompt(
            {
                component: 'LoginCard',
                source: '/tmp/design',
                ingestedAt: 0,
                files: [
                    {
                        path: '/tmp/design/a.html',
                        name: 'a.html',
                        language: 'html',
                        content: '<html/>',
                        truncated: false,
                    },
                    {
                        path: '/tmp/design/a.tsx',
                        name: 'a.tsx',
                        language: 'tsx',
                        content: 'const a=1;',
                        truncated: true,
                    },
                ],
            },
            'implement it'
        );
        expect(prompt).toContain('[Design handoff from fusion-design] Component: LoginCard');
        expect(prompt).toContain('--- FILE: a.html (html) ---');
        expect(prompt).toContain('<html/>');
        expect(prompt).toContain('--- FILE: a.tsx (tsx, truncated) ---');
        expect(prompt).toContain('User instruction:\nimplement it');
    });

    test('archived notification content is the original json', async () => {
        const designDir = ensureDesignDir();
        writeFileSync(join(designDir, 'Z.tsx'), 'export const Z = 1;');
        writeNotification('Z', [join(designDir, 'Z.tsx')]);
        addRepo({ name: 'demo', path: '/tmp/demo' });

        await pollDesignSyncOnce();
        const processedDir = join(designDir, 'processed');
        const archived = readdirSync(processedDir);
        expect(archived.length).toBe(1);
        const raw = readFileSync(join(processedDir, archived[0]), 'utf-8');
        expect(raw).toContain('sync-to-code');
        expect(raw).toContain('"Z"');
    });
});
