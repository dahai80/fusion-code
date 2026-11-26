// DRA-lite: over-edit attribution for resolved harness-gain tasks.
// Method: Delta Residue Attribution (arXiv 2611.34875) — replay the
// transcript's Edit/Write units against the task's final tree snapshot
// (BENCH_DRA=1), revert units cumulatively newest-first, and rerun the
// task verify at each prefix. A unit prefix whose verify still passes is
// jointly unneeded. Design: code-research/docs/dra-lite-experiment-design.md
//
// Usage: bun benchmarks/harness-gain/dra.ts <resultsDir>
//   <resultsDir> must contain T*.final.tar (from BENCH_DRA=1) and
//   T*.transcript.jsonl; tasks.json is read from the suite dir.
import { mkdirSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verify, toSnapshotPath } from "./verify.js";

const suiteDir = import.meta.dir;
const resultsDir = process.argv[2];
if (!resultsDir) {
    console.error("usage: bun dra.ts <resultsDir> [--tasks <tasks.json>]");
    process.exit(1);
}
// --tasks overrides the suite tasks.json (used by tests to inject fixtures)
const tasksIdx = process.argv.indexOf("--tasks");
const tasksPath =
    tasksIdx !== -1 ? process.argv[tasksIdx + 1] : join(suiteDir, "tasks.json");
const suite = JSON.parse(readFileSync(tasksPath, "utf8"));
const tasksById = new Map<string, any>(
    suite.tasks.map((t: any) => [t.id, t]),
);

interface Unit {
    kind: "Edit" | "Write";
    file: string;
    old?: string;
    new?: string;
    content?: string;
    existedBefore: boolean;
}

// Extract ordered Edit/Write units from a transcript. Bash-heredoc writes
// are out of scope in v1 — their share is reported as coverage so the
// blind-spot size is known.
function extractUnits(transcriptPath: string): {
    units: Unit[];
    bashWrites: number;
} {
    const units: Unit[] = [];
    let bashWrites = 0;
    const seenFiles = new Set<string>();
    for (const line of readFileSync(transcriptPath, "utf8").split("\n")) {
        if (!line.trim()) continue;
        let d: any;
        try {
            d = JSON.parse(line);
        } catch {
            continue;
        }
        const stack: any[] = [d];
        while (stack.length) {
            const o = stack.pop();
            if (o == null || typeof o !== "object") continue;
            if (Array.isArray(o)) {
                stack.push(...o);
                continue;
            }
            if (o.type === "tool_use" && (o.name === "Edit" || o.name === "Write")) {
                const file = o.input?.file_path;
                if (typeof file !== "string") continue;
                if (o.name === "Edit") {
                    units.push({
                        kind: "Edit",
                        file,
                        old: String(o.input.old_string ?? ""),
                        new: String(o.input.new_string ?? ""),
                        existedBefore: true,
                    });
                } else {
                    units.push({
                        kind: "Write",
                        file,
                        content: String(o.input.content ?? ""),
                        existedBefore: seenFiles.has(file),
                    });
                }
                seenFiles.add(file);
            } else if (o.type === "tool_use" && o.name === "Bash") {
                const cmd = String(o.input?.command ?? "");
                if (/>|tee |heredoc|<<|cat >/.test(cmd)) bashWrites++;
            } else {
                stack.push(...Object.values(o));
            }
        }
    }
    return { units, bashWrites };
}

function inverseApply(u: Unit, dir: string): "applied" | "ambiguous" {
    const path = toSnapshotPath(u.file, dir);
    if (u.kind === "Edit") {
        if (!existsSync(path)) return "ambiguous";
        const text = readFileSync(path, "utf8");
        if (!text.includes(u.new!)) return "ambiguous";
        writeText(path, text.replace(u.new!, u.old!));
        return "applied";
    }
    // Write inverse: delete the file if it did not exist before the write.
    if (u.existedBefore) return "ambiguous";
    if (!existsSync(path)) return "ambiguous";
    rmSync(path);
    return "applied";
}

// The runner never imports a write helper; dra.ts writes via node fs.
function writeText(path: string, text: string): void {
    Bun.write(path, text);
}

function runVerify(task: any, dir: string): boolean {
    return verify(task.verify, dir).resolved;
}

const out: any = { resultsDir, tasks: [] };
let totalUnits = 0;
let totalUnneeded = 0;
let totalAmbiguous = 0;

for (const f of readdirSync(resultsDir).sort()) {
    if (!f.endsWith(".final.tar")) continue;
    const taskId = f.replace(/\.final\.tar$/, "");
    const task = tasksById.get(taskId);
    const transcriptPath = join(resultsDir, `${taskId}.transcript.jsonl`);
    if (!task || !existsSync(transcriptPath)) {
        console.log(`${taskId}: skip (no task def or transcript)`);
        continue;
    }
    const { units, bashWrites } = extractUnits(transcriptPath);
    const work = join(tmpdir(), `dra-${taskId}-${Date.now()}`);
    mkdirSync(work, { recursive: true });
    try {
        Bun.spawnSync(["tar", "-xf", join(resultsDir, f), "-C", work]);
        if (!runVerify(task, work)) {
            console.log(`${taskId}: snapshot does not verify — skipping`);
            out.tasks.push({ id: taskId, error: "snapshot-verify-failed" });
            continue;
        }
        // Cumulative reverse replay: revert newest-first; while verify keeps
        // passing, reverted units are jointly unneeded. First failing verify
        // marks the boundary; the last reverted unit is the needed one.
        let unneeded = 0;
        let ambiguous = 0;
        let needed = 0;
        for (let i = units.length - 1; i >= 0; i--) {
            const r = inverseApply(units[i], work);
            if (r === "ambiguous") {
                ambiguous += i + 1;
                break;
            }
            if (runVerify(task, work)) {
                unneeded++;
            } else {
                needed++;
                break;
            }
        }
        if (units.length === 0) needed = 0;
        totalUnits += units.length;
        totalUnneeded += unneeded;
        totalAmbiguous += ambiguous;
        out.tasks.push({
            id: taskId,
            kind: task.kind,
            units: units.length,
            bashWrites,
            needed,
            unneeded,
            ambiguous,
        });
        console.log(
            `${taskId} kind=${task.kind} units=${units.length} bashWrites=${bashWrites} needed=${needed} unneeded=${unneeded} ambiguous=${ambiguous}`,
        );
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

out.summary = {
    tasksReplayed: out.tasks.filter((t: any) => !t.error).length,
    totalUnits,
    totalUnneeded,
    unneededRate: totalUnits
        ? Math.round((totalUnneeded / totalUnits) * 1000) / 1000
        : 0,
    totalAmbiguous,
};
console.log(`\nSUMMARY ${JSON.stringify(out.summary)}`);
const outPath = join(resultsDir, "dra.json");
Bun.write(outPath, JSON.stringify(out, null, 4) + "\n");
console.log(`written ${outPath}`);
