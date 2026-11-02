import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveStatic } from '../server/static';

// #232 regression: GET / used to hit the dist directory itself as the first
// candidate — Bun.serve cannot stream a directory (EISDIR). serveStatic must
// skip non-file candidates and fall through to index.html.

let distDir: string;

beforeAll(() => {
    distDir = mkdtempSync(join(tmpdir(), 'fcweb-static-'));
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><html><body><div id="root"></div></body></html>\n');
    mkdirSync(join(distDir, 'assets'));
    writeFileSync(join(distDir, 'assets', 'app.js'), 'console.log(1);\n');
    mkdirSync(join(distDir, 'subdir'));
});

afterAll(() => {
    rmSync(distDir, { recursive: true, force: true });
});

describe('serveStatic (#232)', () => {
    test('root path serves index.html, not the dist directory', async () => {
        const res = serveStatic('', distDir);
        expect(res).not.toBeNull();
        expect(res?.status).toBe(200);
        expect(res?.headers.get('content-type')).toContain('text/html');
        expect(await res?.text()).toContain('<div id="root">');
    });

    test('existing asset file is served with js mime', async () => {
        const res = serveStatic('assets/app.js', distDir);
        expect(res).not.toBeNull();
        expect(res?.headers.get('content-type')).toContain('text/javascript');
    });

    test('deep hash-route path falls back to index.html', async () => {
        const res = serveStatic('session/abc-123', distDir);
        expect(res).not.toBeNull();
        expect(res?.headers.get('content-type')).toContain('text/html');
        expect(await res?.text()).toContain('<div id="root">');
    });

    test('directory candidate is skipped, not streamed', () => {
        const res = serveStatic('subdir', distDir);
        expect(res).not.toBeNull();
        expect(res?.headers.get('content-type')).toContain('text/html');
    });

    test('no dist at all returns null (404 path)', () => {
        expect(serveStatic('', join(distDir, 'missing'))).toBeNull();
    });
});
