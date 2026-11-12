import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    getMemoryFilesForNestedDirectory,
    resetGetMemoryFilesCache,
} from "../../utils/claudemd";
import { getMemoryFilesPortable } from "../../utils/claudemdPortable";

// Evolution plan P1.1: AGENTS.md is the industry-standard context file and
// loads in place of CLAUDE.md per directory — first existing wins, never
// both in the same directory. Rules dirs and CLAUDE.local.md are unaffected.

const tempDirs: string[] = [];

function makeDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "fc-agents-md-"));
    tempDirs.push(dir);
    return dir;
}

beforeAll(() => {
    const configDir = mkdtempSync(join(tmpdir(), "fc-agents-md-cfg-"));
    tempDirs.push(configDir);
    process.env.FUSION_CODE_CONFIG_DIR = configDir;
});

afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    delete process.env.FUSION_CODE_CONFIG_DIR;
});

describe("AGENTS.md precedence (portable loader)", () => {
    test("loads AGENTS.md when only it exists", async () => {
        const dir = makeDir();
        writeFileSync(join(dir, "AGENTS.md"), "# Agents instructions\n");
        const files = await getMemoryFilesPortable(dir);
        const agents = files.filter((f) => f.path === join(dir, "AGENTS.md"));
        expect(agents.length).toBe(1);
        expect(agents[0].content).toContain("Agents instructions");
        expect(files.some((f) => f.path === join(dir, "CLAUDE.md"))).toBe(false);
    });

    test("AGENTS.md wins over CLAUDE.md in the same directory (no double-merge)", async () => {
        const dir = makeDir();
        writeFileSync(join(dir, "AGENTS.md"), "# From agents\n");
        writeFileSync(join(dir, "CLAUDE.md"), "# From claude\n");
        const files = await getMemoryFilesPortable(dir);
        expect(files.some((f) => f.path === join(dir, "AGENTS.md"))).toBe(true);
        expect(files.some((f) => f.path === join(dir, "CLAUDE.md"))).toBe(false);
    });

    test("falls back to CLAUDE.md when no AGENTS.md (legacy unchanged)", async () => {
        const dir = makeDir();
        writeFileSync(join(dir, "CLAUDE.md"), "# Legacy\n");
        const files = await getMemoryFilesPortable(dir);
        expect(files.some((f) => f.path === join(dir, "CLAUDE.md"))).toBe(true);
        expect(files.some((f) => f.path === join(dir, "AGENTS.md"))).toBe(false);
    });

    test("nested dirs resolve independently", async () => {
        const root = makeDir();
        const sub = join(root, "packages", "app");
        mkdirSync(sub, { recursive: true });
        writeFileSync(join(root, "CLAUDE.md"), "# Root claude\n");
        writeFileSync(join(sub, "AGENTS.md"), "# Sub agents\n");
        const files = await getMemoryFilesPortable(sub);
        expect(files.some((f) => f.path === join(root, "CLAUDE.md"))).toBe(true);
        expect(files.some((f) => f.path === join(sub, "AGENTS.md"))).toBe(true);
        expect(files.some((f) => f.path === join(sub, "CLAUDE.md"))).toBe(false);
    });

    test(".fusion-code/rules still load alongside AGENTS.md", async () => {
        const dir = makeDir();
        writeFileSync(join(dir, "AGENTS.md"), "# Agents\n");
        const rulesDir = join(dir, ".fusion-code", "rules");
        mkdirSync(rulesDir, { recursive: true });
        writeFileSync(join(rulesDir, "style.md"), "---\npaths:\n  - \"**/*.ts\"\n---\nuse tabs\n");
        const files = await getMemoryFilesPortable(dir);
        expect(files.some((f) => f.path === join(rulesDir, "style.md"))).toBe(true);
    });
});

describe("AGENTS.md precedence (main loader)", () => {
    test("nested-directory loader prefers AGENTS.md, falls back to CLAUDE.md", async () => {
        const agentsDir = makeDir();
        writeFileSync(join(agentsDir, "AGENTS.md"), "# Agents main\n");
        writeFileSync(join(agentsDir, "CLAUDE.md"), "# Claude main\n");
        const agentsFiles = await getMemoryFilesForNestedDirectory(
            agentsDir,
            agentsDir,
            new Set(),
        );
        expect(agentsFiles.some((f) => f.path === join(agentsDir, "AGENTS.md"))).toBe(true);
        expect(agentsFiles.some((f) => f.path === join(agentsDir, "CLAUDE.md"))).toBe(false);

        const legacyDir = makeDir();
        writeFileSync(join(legacyDir, "CLAUDE.md"), "# Legacy main\n");
        const legacyFiles = await getMemoryFilesForNestedDirectory(
            legacyDir,
            legacyDir,
            new Set(),
        );
        expect(legacyFiles.some((f) => f.path === join(legacyDir, "CLAUDE.md"))).toBe(true);
        resetGetMemoryFilesCache();
    });
});

describe("/init AGENTS.md directive", () => {
    test("fresh project targets AGENTS.md; CLAUDE.md project offers migration", async () => {
        const { default: initCommand } = await import("../../commands/init");
        const originalCwd = process.cwd();
        try {
            const fresh = makeDir();
            process.chdir(fresh);
            const freshPrompt = await initCommand.getPromptForCommand();
            expect(freshPrompt[0].text).toContain("create AGENTS.md (not CLAUDE.md)");

            const legacy = makeDir();
            writeFileSync(join(legacy, "CLAUDE.md"), "# existing\n");
            process.chdir(legacy);
            const legacyPrompt = await initCommand.getPromptForCommand();
            expect(legacyPrompt[0].text).toContain("rename CLAUDE.md to AGENTS.md");

            const migrated = makeDir();
            writeFileSync(join(migrated, "AGENTS.md"), "# migrated\n");
            process.chdir(migrated);
            const migratedPrompt = await initCommand.getPromptForCommand();
            expect(migratedPrompt[0].text).toContain("target AGENTS.md instead");
        } finally {
            process.chdir(originalCwd);
        }
    });
});
