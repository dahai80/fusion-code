import { execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
    LocalCommandCall,
    LocalCommandResult,
} from "../../types/command.js";

const CHECKPOINTS_LOG = ".claude/checkpoints.log";
const CHECKPOINTS_DIR = ".claude/checkpoints";

async function getCheckpointsPath(cwd: string): Promise<string> {
    return join(cwd, CHECKPOINTS_LOG);
}

// Snapshot tar for a named checkpoint. Excludes .git (rollback is about
// the working tree, and .git bloats the snapshot), node_modules, and the
// checkpoints store itself (recursion).
function snapshotArgs(cwd: string, name: string): string[] {
    return [
        "tar",
        "-cf",
        join(cwd, CHECKPOINTS_DIR, `${name}.tar`),
        "-C",
        cwd,
        "--exclude",
        ".git",
        "--exclude",
        "node_modules",
        "--exclude",
        ".claude/checkpoints",
        ".",
    ];
}

export const call: LocalCommandCall = async (args, context) => {
    const parts = args.trim().split(/\s+/);
    const action = parts[0] || "create";
    const name = parts.slice(1).join(" ") || "unnamed";
    const cwd = context.cwd || process.cwd();

    if (action === "list") {
        return handleList(cwd);
    }

    if (action === "verify") {
        return handleVerify(name, cwd);
    }

    if (action === "restore") {
        return handleRestore(name, cwd);
    }

    return handleCreate(name, cwd);
};

function safeCheckpointName(name: string): string {
    return name.replace(/[/\\|]/g, "_");
}

async function handleCreate(
    name: string,
    cwd: string,
): Promise<LocalCommandResult> {
    const logPath = await getCheckpointsPath(cwd);
    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 16);

    let gitRef = "no-git";
    try {
        gitRef = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
            cwd,
            encoding: "utf-8",
        }).trim();
    } catch {
        // not in a git repo, that's fine
    }

    const safeName = safeCheckpointName(name);
    // File-level snapshot (issue #360): the git ref alone cannot restore
    // uncommitted work or anything outside a git repo (temp projects,
    // bench workdirs). Best-effort: snapshot failure downgrades the
    // checkpoint to log-only and is reported, never thrown.
    let snapshotNote: string;
    try {
        await mkdir(join(cwd, CHECKPOINTS_DIR), { recursive: true });
        execFileSync(snapshotArgs(cwd, safeName)[0], snapshotArgs(cwd, safeName).slice(1));
        snapshotNote = `snapshot: ${CHECKPOINTS_DIR}/${safeName}.tar`;
    } catch (e) {
        snapshotNote = `snapshot FAILED (${e}) — checkpoint is log-only`;
    }

    const entry = `${timestamp} | ${safeName} | ${gitRef}\n`;
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, entry, "utf-8");

    console.log(`[checkpoint] created "${name}" at ${gitRef}`);

    return {
        type: "display",
        display: `Checkpoint "${name}" created at ${gitRef} (${timestamp})\n${snapshotNote}\nLog: ${logPath}`,
    } satisfies LocalCommandResult;
}

async function handleList(cwd: string): Promise<LocalCommandResult> {
    const logPath = await getCheckpointsPath(cwd);
    try {
        const content = await readFile(logPath, "utf-8");
        const lines = content.trim().split("\n").filter(Boolean);

        if (lines.length === 0) {
            return {
                type: "display",
                display: "No checkpoints found.",
            } satisfies LocalCommandResult;
        }

        const header = "Timestamp           | Name             | Git Ref  | Snapshot";
        const separator = "--------------------+------------------+----------+---------";
        const rows = lines
            .reverse()
            .slice(0, 20)
            .map((l) => {
                const parts = l.split(" | ").map((p) => p.trim());
                const snap = existsSync(
                    join(cwd, CHECKPOINTS_DIR, `${parts[1]}.tar`),
                )
                    ? "yes"
                    : "no";
                return `${parts[0]} | ${parts[1]} | ${parts[2] ?? "?"} | ${snap}`;
            })
            .join("\n");

        return {
            type: "display",
            display: `Checkpoints (last 20):\n${header}\n${separator}\n${rows}`,
        } satisfies LocalCommandResult;
    } catch {
        return {
            type: "display",
            display: "No checkpoints found.",
        } satisfies LocalCommandResult;
    }
}

async function handleVerify(
    name: string,
    cwd: string,
): Promise<LocalCommandResult> {
    const logPath = await getCheckpointsPath(cwd);
    try {
        const content = await readFile(logPath, "utf-8");
        const lines = content.trim().split("\n").filter(Boolean);

        const match = lines.find((l) => l.includes(`| ${name} |`));
        if (!match) {
            return {
                type: "display",
                display: `Checkpoint "${name}" not found. Use /checkpoint list to see all.`,
            } satisfies LocalCommandResult;
        }

        const parts = match.split(" | ").map((p) => p.trim());
        const checkpointRef = parts[2] || "unknown";

        let currentRef = "no-git";
        try {
            currentRef = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
                cwd,
                encoding: "utf-8",
            }).trim();
        } catch {
            // not in git
        }

        let diffStat = "";
        try {
            diffStat = execFileSync(
                "git",
                ["diff", "--stat", `${checkpointRef}..HEAD`],
                { cwd, encoding: "utf-8" },
            ).trim();
        } catch {
            diffStat = "Unable to compute diff";
        }

        const snapshotPath = join(cwd, CHECKPOINTS_DIR, `${safeCheckpointName(name)}.tar`);
        const hasSnapshot = existsSync(snapshotPath)
            ? `\nSnapshot: ${CHECKPOINTS_DIR}/${safeCheckpointName(name)}.tar (restorable via /checkpoint restore ${name})`
            : "\nSnapshot: none (log-only checkpoint)";

        console.log(
            `[checkpoint] verifying "${name}" (${checkpointRef} -> ${currentRef})`,
        );

        return {
            type: "display",
            display: `Checkpoint: ${name}\nCreated at: ${parts[0]} (${checkpointRef})\nCurrent: ${currentRef}${hasSnapshot}\n\nChanges since checkpoint:\n${diffStat || "None"}`,
        } satisfies LocalCommandResult;
    } catch {
        return {
            type: "display",
            display: "No checkpoints found.",
        } satisfies LocalCommandResult;
    }
}

// Restore the working tree to a checkpoint's file snapshot. Git-free by
// design: extract the tar over cwd so it works outside git repos (temp
// projects, bench workdirs). Safety: the pre-restore tree is snapshotted
// first so the operation itself is reversible.
async function handleRestore(
    name: string,
    cwd: string,
): Promise<LocalCommandResult> {
    const logPath = await getCheckpointsPath(cwd);
    const safeName = safeCheckpointName(name);
    const snapshotPath = join(cwd, CHECKPOINTS_DIR, `${safeName}.tar`);

    if (!existsSync(snapshotPath)) {
        return {
            type: "display",
            display: `No file snapshot for checkpoint "${name}" (looking for ${CHECKPOINTS_DIR}/${safeName}.tar). Log-only checkpoints cannot be restored.`,
        } satisfies LocalCommandResult;
    }

    let gitRef = "no-git";
    try {
        gitRef = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
            cwd,
            encoding: "utf-8",
        }).trim();
    } catch {
        // not in a git repo
    }

    // Auto-backup the current tree before overwriting anything.
    const backupName = `${safeName}-pre-restore`;
    let backupNote: string;
    try {
        await mkdir(join(cwd, CHECKPOINTS_DIR), { recursive: true });
        const backupArgs = snapshotArgs(cwd, backupName);
        execFileSync(backupArgs[0], backupArgs.slice(1));
        backupNote = `pre-restore backup: ${CHECKPOINTS_DIR}/${backupName}.tar`;
    } catch (e) {
        backupNote = `pre-restore backup FAILED (${e}) — restore continues without a fallback`;
    }

    try {
        execFileSync("tar", ["-xf", snapshotPath, "-C", cwd]);
    } catch (e) {
        return {
            type: "display",
            display: `Restore FAILED: ${e}\n${backupNote}`,
        } satisfies LocalCommandResult;
    }

    const entry = `${new Date().toISOString().replace("T", " ").slice(0, 16)} | restore:${safeName} | ${gitRef}\n`;
    try {
        await appendFile(logPath, entry, "utf-8");
    } catch {
        // log is best-effort
    }

    console.log(`[checkpoint] restored "${name}" from ${snapshotPath}`);

    return {
        type: "display",
        display: `Working tree restored to checkpoint "${name}".\nNote: files created after the checkpoint remain on disk (tar extract overlays, it does not delete).\n${backupNote}\nUndo: /checkpoint restore ${backupName}`,
    } satisfies LocalCommandResult;
}
