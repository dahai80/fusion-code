import { existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.map': 'application/json',
    '.woff2': 'font/woff2',
};

// #232: only regular files are servable — the first candidate for the root
// path is the dist directory itself, and Bun.serve cannot stream a directory
// (EISDIR). Skip non-file candidates so index.html wins. Exported for the
// regression test.
export function serveStatic(pathAfterPrefix: string, distDir = join(import.meta.dir, '../dist')): Response | null {
    const candidates = [
        join(distDir, pathAfterPrefix),
        join(distDir, pathAfterPrefix, 'index.html'),
        join(distDir, 'index.html'),
    ];
    for (const file of candidates) {
        if (!existsSync(file)) continue;
        try {
            if (!statSync(file).isFile()) continue;
        } catch {
            continue;
        }
        const type = MIME[extname(file)] ?? 'application/octet-stream';
        return new Response(Bun.file(file), { headers: { 'content-type': type } });
    }
    return null;
}
