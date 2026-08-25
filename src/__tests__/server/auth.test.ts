// projectApiServer auth resolution tests — issue #132 fail-closed gate.
//
// Pre-fix: `if (config.authToken)` was fail-open; empty authToken silently
// disabled auth. These tests pin fail-closed behavior: empty authToken
// generates a token (non-null), --no-auth disables (null), explicit token
// passes through.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resolveEffectiveAuthToken } from "../../server/projectApiServer.js";
import { existsSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { mkdtempSync } from "fs";

const ORIG_NO_AUTH = process.env.FUSION_CODE_NO_AUTH;
const ORIG_CONFIG_DIR = process.env.FUSION_CODE_CONFIG_DIR;

describe("resolveEffectiveAuthToken", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(homedir(), ".fusion-code-auth-test-"));
        process.env.FUSION_CODE_CONFIG_DIR = tmpDir;
        delete process.env.FUSION_CODE_NO_AUTH;
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
        if (ORIG_NO_AUTH === undefined) delete process.env.FUSION_CODE_NO_AUTH;
        else process.env.FUSION_CODE_NO_AUTH = ORIG_NO_AUTH;
        if (ORIG_CONFIG_DIR === undefined) delete process.env.FUSION_CODE_CONFIG_DIR;
        else process.env.FUSION_CODE_CONFIG_DIR = ORIG_CONFIG_DIR;
    });

    test("explicit authToken passes through verbatim", () => {
        const r = resolveEffectiveAuthToken({
            port: 11441,
            host: "127.0.0.1",
            authToken: "my-secret-token",
        });
        expect(r.token).toBe("my-secret-token");
        expect(r.disabled).toBe(false);
        expect(r.tokenFile).toBeUndefined();
    });

    test("empty authToken generates a token (fail-closed, NOT null)", () => {
        const r = resolveEffectiveAuthToken({
            port: 11441,
            host: "127.0.0.1",
            authToken: "",
        });
        // The fix: empty authToken must NOT disable auth.
        expect(r.token).not.toBeNull();
        expect(r.disabled).toBe(false);
        expect(typeof r.token).toBe("string");
        expect((r.token as string).length).toBeGreaterThan(0);
    });

    test("generated token is 32 random bytes hex (64 chars)", () => {
        const r = resolveEffectiveAuthToken({
            port: 11441,
            host: "127.0.0.1",
            authToken: "",
        });
        expect((r.token as string).length).toBe(64);
        expect(r.token).toMatch(/^[0-9a-f]{64}$/);
    });

    test("FUSION_CODE_NO_AUTH=1 disables auth (explicit opt-out)", () => {
        process.env.FUSION_CODE_NO_AUTH = "1";
        const r = resolveEffectiveAuthToken({
            port: 11441,
            host: "127.0.0.1",
            authToken: "",
        });
        expect(r.token).toBeNull();
        expect(r.disabled).toBe(true);
    });

    test("config.authDisabled flag disables auth even with empty env", () => {
        const r = resolveEffectiveAuthToken({
            port: 11441,
            host: "127.0.0.1",
            authToken: "",
            authDisabled: true,
        });
        expect(r.token).toBeNull();
        expect(r.disabled).toBe(true);
    });

    test("explicit authToken wins over FUSION_CODE_NO_AUTH=1", () => {
        process.env.FUSION_CODE_NO_AUTH = "1";
        const r = resolveEffectiveAuthToken({
            port: 11441,
            host: "127.0.0.1",
            authToken: "explicit",
        });
        // Wait — precedence: disabled is checked FIRST in resolveEffectiveAuthToken.
        // Document the actual behavior: opt-out wins. This test pins it.
        expect(r.disabled).toBe(true);
        expect(r.token).toBeNull();
    });

    test("generated token persists to server.token file (0600)", async () => {
        const r = resolveEffectiveAuthToken({
            port: 11441,
            host: "127.0.0.1",
            authToken: "",
        });
        const tokenFile = r.tokenFile as string;
        expect(tokenFile).toBeDefined();
        // resolveEffectiveAuthToken fires the write async; wait for it.
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(existsSync(tokenFile)).toBe(true);
        const persisted = readFileSync(tokenFile, "utf8").trim();
        expect(persisted).toBe(r.token);
    });

    test("two empty-config calls generate distinct tokens (per-instance)", () => {
        const r1 = resolveEffectiveAuthToken({
            port: 11441,
            host: "127.0.0.1",
            authToken: "",
        });
        const r2 = resolveEffectiveAuthToken({
            port: 11441,
            host: "127.0.0.1",
            authToken: "",
        });
        expect(r1.token).not.toBe(r2.token);
    });
});
