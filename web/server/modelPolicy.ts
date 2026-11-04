import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log, logWarn } from './config';

// #240 model policy chain (owner decision 2026-11-04): a model_capable
// module declares its suggested coding model in manifest.json and resolves
// the effective session model at RUN time (no rebuild) through a
// first-wins chain: explicit per-session pick > module override > platform
// preference (gateway model-policy API) > manifest suggested_model > env
// FUSION_MODEL (kernel default). The gateway API is consumed best-effort —
// absent/unreachable means fail-open to the next source, so the module
// works today and picks the platform policy up the moment it exists.

export type ModelPolicy = {
    model?: string;
    privacyMode?: 'standard' | 'local_only';
    allowlist?: string[];
};

export type ModelSource = 'session' | 'module' | 'platform' | 'manifest' | 'env';

const PLATFORM_TIMEOUT_MS = 2000;
const PLATFORM_CACHE_MS = 60_000;

let platformCache: { at: number; policy: ModelPolicy | null } = { at: 0, policy: null };

export function __resetModelPolicyCacheForTest(): void {
    platformCache = { at: 0, policy: null };
}

function serverRoot(): string {
    return join(dirname(fileURLToPath(import.meta.url)), '..');
}

// Manifest is read at run time — editing manifest.json changes the default
// for new sessions without a rebuild (acceptance criterion #240).
export function readManifestModel(): { modelCapable: boolean; suggestedModel?: string } {
    try {
        const raw = JSON.parse(readFileSync(join(serverRoot(), 'manifest.json'), 'utf-8')) as Record<string, unknown>;
        return {
            modelCapable: raw.model_capable === true,
            suggestedModel:
                typeof raw.suggested_model === 'string' && raw.suggested_model ? raw.suggested_model : undefined,
        };
    } catch {
        return { modelCapable: false };
    }
}

// Module-level knobs (admin-controlled via the server process env) — they
// override the platform so an operator can pin a module regardless of what
// the gateway currently advertises.
export function envPolicy(): ModelPolicy {
    const allowlist = process.env.FUSION_CODE_WEB_MODEL_ALLOWLIST;
    return {
        model: process.env.FUSION_CODE_WEB_MODEL_OVERRIDE || undefined,
        privacyMode: process.env.FUSION_CODE_WEB_PRIVACY_MODE === 'local_only' ? 'local_only' : undefined,
        allowlist: allowlist
            ? allowlist
                  .split(',')
                  .map((part) => part.trim())
                  .filter(Boolean)
            : undefined,
    };
}

// Best-effort platform preference: GET <gateway>/api/v1/model-policy. Any
// failure (no gateway, 404 while the API ships, timeout) is fail-open with
// a 60s negative cache so runs never wait on the gateway.
export async function fetchPlatformPolicy(): Promise<ModelPolicy | null> {
    const base = process.env.FUSION_SHELL_GATEWAY_URL ?? '';
    if (!base) return null;
    if (Date.now() - platformCache.at < PLATFORM_CACHE_MS) return platformCache.policy;
    platformCache.at = Date.now();
    platformCache.policy = null;
    try {
        const res = await fetch(`${base.replace(/\/+$/, '')}/api/v1/model-policy`, {
            signal: AbortSignal.timeout(PLATFORM_TIMEOUT_MS),
        });
        if (!res.ok) {
            log(`model policy: gateway returned ${res.status} for model-policy — fail-open`);
            return null;
        }
        const body = (await res.json()) as Record<string, unknown>;
        const policy: ModelPolicy = {
            model: typeof body.model === 'string' && body.model ? body.model : undefined,
            privacyMode: body.privacy_mode === 'local_only' ? 'local_only' : 'standard',
            allowlist: Array.isArray(body.allowlist) ? body.allowlist.map(String).filter(Boolean) : undefined,
        };
        platformCache.policy = policy;
        log(`model policy: platform preference model=${policy.model ?? '-'} privacy=${policy.privacyMode}`);
        return policy;
    } catch (err) {
        logWarn(`model policy: gateway fetch failed — fail-open (${err instanceof Error ? err.message : String(err)})`);
        return null;
    }
}

// Gateway allowlist entries are glob patterns (claude-3*, gpt-4o*).
export function matchesPattern(model: string, pattern: string): boolean {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(model);
}

export function isLocalModel(model: string): boolean {
    const extra = (process.env.FUSION_CODE_WEB_LOCAL_MODELS ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    return /^(mlx[-_]|local[-_])/.test(model) || extra.some((pattern) => matchesPattern(model, pattern));
}

// Returns null when the choice is allowed, else a human-readable reason.
export function validateModelChoice(model: string, policy: ModelPolicy): string | null {
    if (policy.allowlist && policy.allowlist.length > 0 && !policy.allowlist.some((p) => matchesPattern(model, p))) {
        return `model ${model} is not in the allowed list: ${policy.allowlist.join(', ')}`;
    }
    if (policy.privacyMode === 'local_only' && !isLocalModel(model)) {
        return `privacy mode local_only pins sessions to local models — ${model} is not local`;
    }
    return null;
}

export type ModelResolution = { model?: string; source: ModelSource; error?: string };

// Resolve the effective model for a run. An explicit pick is validated
// against the merged policy and REJECTED (not silently swapped) when it
// violates allowlist/privacy; default candidates that violate policy are
// skipped so the next source takes over.
export async function resolveSessionModel(explicit?: string): Promise<ModelResolution> {
    const env = envPolicy();
    const platform = (await fetchPlatformPolicy()) ?? undefined;
    const manifest = readManifestModel();
    const policy: ModelPolicy = {
        model: env.model ?? platform?.model,
        privacyMode: env.privacyMode ?? platform?.privacyMode,
        allowlist: env.allowlist ?? platform?.allowlist,
    };
    if (explicit) {
        const violation = validateModelChoice(explicit, policy);
        if (violation) return { error: violation, source: 'session' };
        return { model: explicit, source: 'session' };
    }
    const candidates: Array<[string | undefined, ModelSource]> = [
        [env.model, 'module'],
        [platform?.model, 'platform'],
        [manifest.suggestedModel, 'manifest'],
    ];
    for (const [model, source] of candidates) {
        if (!model) continue;
        if (!validateModelChoice(model, policy)) return { model, source };
        logWarn(`model policy: candidate ${model} (${source}) violates policy — trying next source`);
    }
    // No resolved default — the kernel falls back to its own FUSION_MODEL env.
    return { source: 'env' };
}

// Shape for GET /api/models — the composer reads this to show the effective
// default, the privacy constraint, and the overridable candidates.
export async function modelInfo(): Promise<{
    modelCapable: boolean;
    suggestedModel?: string;
    defaultModel?: string;
    defaultSource?: ModelSource;
    privacyMode?: 'standard' | 'local_only';
    allowlist?: string[];
}> {
    const env = envPolicy();
    const platform = (await fetchPlatformPolicy()) ?? undefined;
    const manifest = readManifestModel();
    const resolution = await resolveSessionModel();
    return {
        modelCapable: manifest.modelCapable,
        suggestedModel: manifest.suggestedModel,
        defaultModel: resolution.model,
        defaultSource: resolution.source,
        privacyMode: env.privacyMode ?? platform?.privacyMode,
        allowlist: env.allowlist ?? platform?.allowlist,
    };
}
