import { homedir } from 'node:os';
import { join } from 'node:path';

// Backend configuration. Production: the backend serves the built SPA + API
// + WS on 11482 (port-registry). Dev: Vite takes 11482, backend runs on
// 11481 (FUSION_CODE_WEB_PORT) and Vite proxies /api + /ws to it.

export function webPort(): number {
    return Number(process.env.FUSION_CODE_WEB_PORT ?? 11482);
}

export function dataDir(): string {
    return process.env.FUSION_CODE_WEB_DATA_DIR ?? join(homedir(), '.fusion-code', 'web');
}

export function bindHost(): string {
    return process.env.FUSION_CODE_WEB_BIND ?? '127.0.0.1';
}

export function log(line: string): void {
    console.log(`[fusion-code-web] ${new Date().toISOString()} ${line}`);
}

export function logWarn(line: string): void {
    console.warn(`[fusion-code-web] ${new Date().toISOString()} WARN ${line}`);
}
