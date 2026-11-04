import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    __resetModelPolicyCacheForTest,
    envPolicy,
    fetchPlatformPolicy,
    isLocalModel,
    matchesPattern,
    modelInfo,
    readManifestModel,
    resolveSessionModel,
    validateModelChoice,
} from '../server/modelPolicy';
import { kernelSpawnEnv } from '../server/runner';

// #240 model policy chain: explicit pick > module override > platform
// preference (best-effort gateway API) > manifest suggested_model, with
// allowlist + privacy-mode constraints applied at every level.

const tempDirs: string[] = [];

beforeEach(() => {
    const dataDir = mkdtempSync(join(tmpdir(), 'fcweb-mp-data-'));
    tempDirs.push(dataDir);
    process.env.FUSION_CODE_WEB_DATA_DIR = dataDir;
    process.env.FUSION_CODE_WEB_ENV_FILE = join(dataDir, 'no-such-env-file');
    delete process.env.FUSION_CODE_WEB_MODEL_OVERRIDE;
    delete process.env.FUSION_CODE_WEB_PRIVACY_MODE;
    delete process.env.FUSION_CODE_WEB_MODEL_ALLOWLIST;
    delete process.env.FUSION_CODE_WEB_LOCAL_MODELS;
    delete process.env.FUSION_SHELL_GATEWAY_URL;
    delete process.env.FUSION_MODEL;
    __resetModelPolicyCacheForTest();
});

afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    for (const key of [
        'FUSION_CODE_WEB_DATA_DIR',
        'FUSION_CODE_WEB_ENV_FILE',
        'FUSION_CODE_WEB_MODEL_OVERRIDE',
        'FUSION_CODE_WEB_PRIVACY_MODE',
        'FUSION_CODE_WEB_MODEL_ALLOWLIST',
        'FUSION_CODE_WEB_LOCAL_MODELS',
        'FUSION_SHELL_GATEWAY_URL',
        'FUSION_MODEL',
    ]) {
        delete process.env[key];
    }
});

describe('model policy (#240)', () => {
    test('manifest declares model_capable + suggested_model', () => {
        const manifest = readManifestModel();
        expect(manifest.modelCapable).toBe(true);
        expect(manifest.suggestedModel).toBe('claude-3-5-haiku');
    });

    test('manifest suggested_model is the default when nothing else is set', async () => {
        const res = await resolveSessionModel();
        expect(res.model).toBe('claude-3-5-haiku');
        expect(res.source).toBe('manifest');
    });

    test('module override wins over the manifest suggestion', async () => {
        process.env.FUSION_CODE_WEB_MODEL_OVERRIDE = 'qwen2.5-coder-32b';
        const res = await resolveSessionModel();
        expect(res.model).toBe('qwen2.5-coder-32b');
        expect(res.source).toBe('module');
    });

    test('explicit per-session pick wins over everything', async () => {
        process.env.FUSION_CODE_WEB_MODEL_OVERRIDE = 'qwen2.5-coder-32b';
        const res = await resolveSessionModel('claude-3-5-haiku');
        expect(res.model).toBe('claude-3-5-haiku');
        expect(res.source).toBe('session');
    });

    test('explicit pick outside the allowlist is rejected with a reason', async () => {
        process.env.FUSION_CODE_WEB_MODEL_ALLOWLIST = 'claude-3*, qwen*';
        const ok = await resolveSessionModel('claude-3-5-haiku');
        expect(ok.model).toBe('claude-3-5-haiku');
        const bad = await resolveSessionModel('gpt-5-turbo');
        expect(bad.error).toContain('not in the allowed list');
        expect(bad.error).toContain('claude-3*');
    });

    test('privacy local_only rejects non-local picks and pins defaults', async () => {
        process.env.FUSION_CODE_WEB_PRIVACY_MODE = 'local_only';
        const bad = await resolveSessionModel('claude-3-5-haiku');
        expect(bad.error).toContain('local_only');
        // Default candidates violating policy are skipped — no model is
        // forced in, the kernel keeps its own FUSION_MODEL default.
        const pinned = await resolveSessionModel();
        expect(pinned.error).toBeUndefined();
        expect(pinned.source).toBe('env');
        // A local pick passes.
        const local = await resolveSessionModel('mlx-community--Qwen2.5-Coder-32B');
        expect(local.model).toBe('mlx-community--Qwen2.5-Coder-32B');
        expect(local.source).toBe('session');
    });

    test('local model detection: mlx-/local- prefixes + extra env list', () => {
        expect(isLocalModel('mlx-community--Qwen2.5-Coder-32B')).toBe(true);
        expect(isLocalModel('local-qwen')).toBe(true);
        expect(isLocalModel('claude-3-5-haiku')).toBe(false);
        process.env.FUSION_CODE_WEB_LOCAL_MODELS = 'qwen2.5-coder-32b, gpt-oss*';
        expect(isLocalModel('qwen2.5-coder-32b')).toBe(true);
        expect(isLocalModel('gpt-oss-20b')).toBe(true);
        expect(isLocalModel('gpt-4o')).toBe(false);
    });

    test('allowlist patterns are gateway-style globs', () => {
        expect(matchesPattern('claude-3-5-haiku', 'claude-3*')).toBe(true);
        expect(matchesPattern('claude-4-sonnet', 'claude-3*')).toBe(false);
        expect(matchesPattern('gpt-4o-mini', 'gpt-4o*')).toBe(true);
        // Regex metacharacters in model names are literal.
        expect(matchesPattern('a.c', 'a.c')).toBe(true);
        expect(matchesPattern('abc', 'a.c')).toBe(false);
    });

    test('validateModelChoice returns null for allowed models', () => {
        expect(validateModelChoice('qwen*', { allowlist: ['qwen*'] })).toBeNull();
        expect(validateModelChoice('anything', {})).toBeNull();
    });

    test('envPolicy parses the module knobs', () => {
        expect(envPolicy()).toEqual({});
        process.env.FUSION_CODE_WEB_MODEL_OVERRIDE = 'm1';
        process.env.FUSION_CODE_WEB_PRIVACY_MODE = 'local_only';
        process.env.FUSION_CODE_WEB_MODEL_ALLOWLIST = 'a*, b*';
        expect(envPolicy()).toEqual({
            model: 'm1',
            privacyMode: 'local_only',
            allowlist: ['a*', 'b*'],
        });
    });

    test('platform preference is fail-open when no gateway is configured', async () => {
        const policy = await fetchPlatformPolicy();
        expect(policy).toBeNull();
        const res = await resolveSessionModel();
        expect(res.model).toBe('claude-3-5-haiku');
    });

    test('platform preference is fail-open when the gateway has no model-policy API yet', async () => {
        // Port 9 (discard) refuses immediately — no long timeout wait.
        process.env.FUSION_SHELL_GATEWAY_URL = 'http://127.0.0.1:9';
        __resetModelPolicyCacheForTest();
        const policy = await fetchPlatformPolicy();
        expect(policy).toBeNull();
        const res = await resolveSessionModel();
        expect(res.model).toBe('claude-3-5-haiku');
        expect(res.source).toBe('manifest');
    }, 10_000);

    test('modelInfo exposes the composer surface', async () => {
        const info = await modelInfo();
        expect(info.modelCapable).toBe(true);
        expect(info.suggestedModel).toBe('claude-3-5-haiku');
        expect(info.defaultModel).toBe('claude-3-5-haiku');
        expect(info.defaultSource).toBe('manifest');
    });

    test('kernelSpawnEnv(model) overrides FUSION_MODEL above the env file', async () => {
        const envFile = join(tempDirs[0], 'env-file');
        await Bun.write(envFile, 'FUSION_MODEL=envfile-model\nFUSION_BASE_URL=http://127.0.0.1:11432\n');
        process.env.FUSION_CODE_WEB_ENV_FILE = envFile;
        process.env.FUSION_MODEL = 'process-model';
        expect(kernelSpawnEnv().FUSION_MODEL).toBe('envfile-model');
        expect(kernelSpawnEnv('resolved-model').FUSION_MODEL).toBe('resolved-model');
        expect(kernelSpawnEnv('resolved-model').FUSION_BASE_URL).toBe('http://127.0.0.1:11432');
    });
});
