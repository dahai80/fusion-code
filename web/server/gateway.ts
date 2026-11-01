import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { log, logWarn } from './config';

// Gateway self-registration (dynamic shell-module manifest). Env-gated:
// FUSION_SHELL_GATEWAY_URL + FUSION_ADMIN_KEY both set = register + 15s
// heartbeat, same protocol as fusion-cowork shell_registry.py. The gateway
// then proxies /shell/fusion-code/ to our upstream.

const HEARTBEAT_INTERVAL_MS = 15_000;

let timer: ReturnType<typeof setInterval> | null = null;

export function manifestJson(): string {
    return readFileSync(join(import.meta.dir, '../manifest.json'), 'utf-8');
}

async function postManifest(gatewayUrl: string, adminKey: string, manifest: string): Promise<boolean> {
    try {
        const res = await fetch(`${gatewayUrl.replace(/\/$/, '')}/api/v1/shell/manifests`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                Authorization: `Bearer ${adminKey}`,
            },
            body: manifest,
        });
        if (!res.ok) {
            logWarn(`gateway manifest POST failed: ${res.status} ${await res.text().catch(() => '')}`);
            return false;
        }
        log('gateway manifest registered');
        return true;
    } catch (err) {
        logWarn(`gateway unreachable: ${err}`);
        return false;
    }
}

async function heartbeat(gatewayUrl: string, adminKey: string, moduleId: string): Promise<void> {
    try {
        const res = await fetch(`${gatewayUrl.replace(/\/$/, '')}/api/v1/shell/manifests/${moduleId}/heartbeat`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${adminKey}` },
        });
        if (!res.ok) {
            logWarn(`gateway heartbeat failed: ${res.status}`);
        }
    } catch (err) {
        logWarn(`gateway heartbeat error: ${err}`);
    }
}

export function startGatewayRegistration(): void {
    const gatewayUrl = process.env.FUSION_SHELL_GATEWAY_URL;
    const adminKey = process.env.FUSION_ADMIN_KEY;
    if (!gatewayUrl || !adminKey) {
        log('gateway registration disabled (FUSION_SHELL_GATEWAY_URL / FUSION_ADMIN_KEY not set)');
        return;
    }
    const manifest = manifestJson();
    let moduleId = 'fusion-code';
    try {
        moduleId = JSON.parse(manifest).id ?? moduleId;
    } catch {
        logWarn('manifest.json unparseable, using default module id');
    }
    void postManifest(gatewayUrl, adminKey, manifest);
    timer = setInterval(() => {
        void heartbeat(gatewayUrl, adminKey, moduleId);
    }, HEARTBEAT_INTERVAL_MS);
}

export function stopGatewayRegistration(): void {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}
