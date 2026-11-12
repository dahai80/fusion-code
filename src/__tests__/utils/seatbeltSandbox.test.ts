import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SandboxManager } from "../../utils/sandbox/sandbox-adapter";
import type { SandboxRuntimeConfig } from "../../vendor/sandbox-runtime/dist/sandbox/sandbox-config";

// Evolution plan P1.2: macOS sandboxing must be verified end-to-end — the
// vendored sandbox-runtime generates a Seatbelt (sandbox-exec) profile and
// Shell.ts routes sandboxed commands through it on darwin. These probes run
// the real wrapped command; skipped off-macOS (Linux uses bubblewrap, covered
// upstream).

const isDarwin = process.platform === "darwin";

async function runWrapped(command: string, cwd: string, config?: Partial<SandboxRuntimeConfig>) {
    const wrapped = await SandboxManager.wrapWithSandbox(command, "/bin/sh", config);
    return spawnSync("/bin/sh", ["-c", wrapped], { cwd, encoding: "utf8" });
}

describe.skipIf(!isDarwin)("macOS Seatbelt end-to-end (P1.2)", () => {
    test("platform is supported and dependency check is clean", () => {
        expect(SandboxManager.isSupportedPlatform()).toBe(true);
        const deps = SandboxManager.checkDependencies();
        expect(deps.errors).toEqual([]);
    });

    test("read-only command runs inside the Seatbelt profile", async () => {
        const dir = mkdtempSync(join(tmpdir(), "fc-seatbelt-"));
        try {
            const res = await runWrapped("echo seatbelt-ok", dir);
            expect(res.status).toBe(0);
            expect((res.stdout ?? "").trim()).toBe("seatbelt-ok");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("write outside the workspace is denied by the profile", async () => {
        const dir = mkdtempSync(join(tmpdir(), "fc-seatbelt-"));
        const outside = join(tmpdir(), `fc-seatbelt-deny-${Date.now()}.txt`);
        try {
            const res = await runWrapped(`echo pwned > ${outside}`, dir);
            expect(res.status).not.toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
            rmSync(outside, { force: true });
        }
    });

    test("write inside a customConfig allowWrite path succeeds", async () => {
        const dir = mkdtempSync(join(tmpdir(), "fc-seatbelt-"));
        try {
            const config: Partial<SandboxRuntimeConfig> = {
                filesystem: { allowWrite: [dir], denyRead: [], denyWrite: [] },
                network: { allowedDomains: [], deniedDomains: [] },
            };
            const res = await runWrapped("echo ok > inside.txt", dir, config);
            expect(res.status).toBe(0);
            expect(Bun.file(join(dir, "inside.txt")).text().then((t) => t.trim())).resolves.toBe("ok");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
