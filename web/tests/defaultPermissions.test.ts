import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    __resetStoreForTest,
    addRepo,
    createSession,
    getDefaultPermissions,
    getPermissions,
    setDefaultPermissions,
    setPermissions,
} from '../server/store';

// Global default permissions: settings-editable, applied to new sessions;
// existing sessions keep their own rules.

const tempDirs: string[] = [];

beforeEach(() => {
    const dataDir = mkdtempSync(join(tmpdir(), 'fcweb-defperm-'));
    tempDirs.push(dataDir);
    process.env.FUSION_CODE_WEB_DATA_DIR = dataDir;
    __resetStoreForTest();
});

afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    delete process.env.FUSION_CODE_WEB_DATA_DIR;
});

describe('default permissions', () => {
    test('unset default falls back to read-only allowlist', () => {
        const perms = getDefaultPermissions();
        expect(perms.mode).toBe('allowlist');
        expect(perms.allowedTools).toEqual(['Read', 'Glob', 'Grep']);
    });

    test('setDefaultPermissions persists and copies are isolated', () => {
        setDefaultPermissions('allowlist', ['Read', 'Edit']);
        const first = getDefaultPermissions();
        first.allowedTools.push('Bash');
        expect(getDefaultPermissions().allowedTools).toEqual(['Read', 'Edit']);
    });

    test('new sessions inherit the configured default', () => {
        const repo = addRepo({ name: 'demo', path: '/tmp/demo' });
        setDefaultPermissions('allowlist', ['Read', 'Edit', 'Bash']);
        const session = createSession({ title: 's', repoId: repo.id, branch: 'main', environment: 'default' });
        expect(getPermissions(session.id).allowedTools).toEqual(['Read', 'Edit', 'Bash']);

        // Existing sessions keep their own rules after the default changes.
        setPermissions(session.id, 'ask', []);
        setDefaultPermissions('allowlist', ['Read']);
        expect(getPermissions(session.id).mode).toBe('ask');
    });
});
