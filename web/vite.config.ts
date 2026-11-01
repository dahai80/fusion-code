import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev server 11482 (architecture/port-registry.yaml). Proxies API + WS to
// the web backend on 11482 (same port when `bun run start` serves dist;
// in dev the Vite server runs on 11482 and proxies /api + /ws to the
// backend's own port, FUSION_DEV_BACKEND default 11483 — see server/config).
const backend = process.env.FUSION_DEV_BACKEND ?? 'http://127.0.0.1:11483';
const port = Number(process.env.FUSION_CODE_WEB_PORT ?? 11482);

const apiPaths = ['/api', '/health'];

export default defineConfig({
    plugins: [react()],
    // Embedded deployment serves dist under the gateway sub-path
    // /shell/fusion-code/ — relative base + hash router (#/...) resolves
    // assets in BOTH embedded and standalone modes (same as cowork web).
    base: './',
    server: {
        port,
        strictPort: true,
        proxy: {
            ...Object.fromEntries(apiPaths.map((p) => [p, { target: backend, changeOrigin: true }])),
            '/ws': { target: backend.replace('http', 'ws'), ws: true },
        },
    },
    preview: {
        port,
        strictPort: true,
        proxy: {
            ...Object.fromEntries(apiPaths.map((p) => [p, { target: backend, changeOrigin: true }])),
            '/ws': { target: backend.replace('http', 'ws'), ws: true },
        },
    },
    envPrefix: ['VITE_', 'FUSION_'],
});
