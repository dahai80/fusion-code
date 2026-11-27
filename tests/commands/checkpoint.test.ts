import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call } from "../../src/commands/checkpoint/checkpoint.js";

// /checkpoint file-level snapshot + restore (issue #360). Restore is a
// destructive overlay: covered here with temp dirs and a pre-restore
// backup roundtrip so the undo path is exercised too.
describe("checkpoint command", () => {
    let cwd: string;
    const cleanup: string[] = [];

    beforeEach(() => {
        cwd = mkdtempSync(join(tmpdir(), "cp-test-"));
        cleanup.push(cwd);
        writeFileSync(join(cwd, "app.txt"), "v1\n");
    });

    afterEach(() => {
        for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
        cleanup.length = 0;
    });

    test("create writes a restorable snapshot outside git repos", async () => {
        const res = await call(`create base`, { cwd });
        expect(res.display).toContain("snapshot: .claude/checkpoints/base.tar");
        expect(existsSync(join(cwd, ".claude/checkpoints/base.tar"))).toBe(true);
    });

    test("restore rolls the tree back to the snapshot state", async () => {
        await call(`create base`, { cwd });
        writeFileSync(join(cwd, "app.txt"), "v2-broken\n");
        const res = await call(`restore base`, { cwd });
        expect(res.display).toContain("restored");
        expect(readFileSync(join(cwd, "app.txt"), "utf8")).toBe("v1\n");
    });

    test("restore keeps post-checkpoint files and creates a pre-restore backup", async () => {
        await call(`create base`, { cwd });
        writeFileSync(join(cwd, "new.txt"), "added later\n");
        writeFileSync(join(cwd, "app.txt"), "v2-broken\n");
        const res = await call(`restore base`, { cwd });
        expect(res.display).toContain("pre-restore backup");
        expect(res.display).toContain("remain on disk");
        expect(readFileSync(join(cwd, "new.txt"), "utf8")).toBe("added later\n");
        expect(existsSync(join(cwd, ".claude/checkpoints/base-pre-restore.tar"))).toBe(true);
        // undo path works
        writeFileSync(join(cwd, "app.txt"), "v3\n");
        await call(`restore base-pre-restore`, { cwd });
        expect(readFileSync(join(cwd, "app.txt"), "utf8")).toBe("v2-broken\n");
    });

    test("restore without a snapshot fails with guidance", async () => {
        const res = await call(`restore missing`, { cwd });
        expect(res.display).toContain("No file snapshot");
    });

    test("list marks snapshot availability", async () => {
        await call(`create base`, { cwd });
        const res = await call(`list`, { cwd });
        expect(res.display).toContain("base");
        expect(res.display).toContain("yes");
    });
});
