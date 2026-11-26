// Shared task verifiers — used by run.ts (scoring) and dra.ts (unit
// necessity replay). Extracted from run.ts so the replay tool can reuse
// the exact predicates without triggering run.ts's main().
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Transcripts record absolute file_path under the runner's temp workdir
// (…/hg-<taskId>-<rand>/…). Snapshots (BENCH_DRA=1) are tarred with the
// workdir as root, so strip everything through the hg-* segment to get
// the snapshot-relative path; keep the raw path when already relative.
export function toSnapshotPath(file: string, dir: string): string {
    const m = file.match(/\/hg-[^/]+\//);
    if (m && m.index !== undefined) file = file.slice(m.index + m[0].length);
    return join(dir, file);
}

export function verify(
	verifySpec: any,
	dir: string,
): { resolved: boolean; detail: string } {
	switch (verifySpec.type) {
		case "file-contains": {
			const path = join(dir, verifySpec.path);
			if (!existsSync(path))
				return { resolved: false, detail: `missing ${verifySpec.path}` };
			const text = readFileSync(path, "utf8");
			return {
				resolved: text.includes(verifySpec.text),
				detail: `file-contains ${verifySpec.path}`,
			};
		}
		case "regex-absent": {
			const path = join(dir, verifySpec.path);
			if (!existsSync(path))
				return { resolved: false, detail: `missing ${verifySpec.path}` };
			const re = new RegExp(verifySpec.pattern);
			return {
				resolved: !re.test(readFileSync(path, "utf8")),
				detail: `regex-absent ${verifySpec.pattern} ${verifySpec.path}`,
			};
		}
		case "grep-absent": {
			const proc = Bun.spawnSync(["grep", "-rl", verifySpec.pattern, "."], {
				cwd: dir,
			});
			const hits = proc.stdout.toString().trim();
			return {
				resolved: proc.exitCode !== 0 && hits === "",
				detail: `grep-absent ${verifySpec.pattern} hits=${hits || "none"}`,
			};
		}
		case "json-field": {
			const path = join(dir, verifySpec.path);
			if (!existsSync(path))
				return { resolved: false, detail: `missing ${verifySpec.path}` };
			try {
				const doc = JSON.parse(readFileSync(path, "utf8"));
				const keys = verifySpec.field.split(".");
				let cur: any = doc;
				for (const k of keys) cur = cur?.[k];
				return {
					resolved: cur === verifySpec.value,
					detail: `json-field ${verifySpec.field}`,
				};
			} catch (e) {
				return { resolved: false, detail: `json parse failed` };
			}
		}
		case "command-exit": {
			const proc = Bun.spawnSync(verifySpec.command.split(" "), {
				cwd: dir,
				timeout: 60_000,
				killSignal: 9,
			});
			if (verifySpec.exitCode !== undefined) {
				return {
					resolved: proc.exitCode === verifySpec.exitCode,
					detail: `exit=${proc.exitCode}`,
				};
			}
			const want = String(verifySpec.stdout ?? "");
			return {
				resolved: proc.stdout.toString().trim() === want,
				detail: `stdout=${proc.stdout.toString().trim()}`,
			};
		}
		case "command-stdout": {
			const proc = Bun.spawnSync(verifySpec.command.split(" "), {
				cwd: dir,
				timeout: 60_000,
				killSignal: 9,
			});
			return {
				resolved: proc.stdout.toString().trim() === verifySpec.stdout,
				detail: `stdout=${proc.stdout.toString().trim()}`,
			};
		}
		case "count-max": {
			// Refactor tasks: behavior tests pass on untouched code, so the
			// verifier must instead bound how many times a duplicated marker
			// still appears in the file (untouched fixture fails high counts).
			const path = join(dir, verifySpec.path);
			if (!existsSync(path))
				return { resolved: false, detail: `missing ${verifySpec.path}` };
			const content = readFileSync(path, "utf8");
			const n = (content.match(new RegExp(verifySpec.pattern, "gm")) ?? [])
				.length;
			return {
				resolved: n <= verifySpec.max,
				detail: `count=${n} max=${verifySpec.max} ${verifySpec.path}`,
			};
		}
		case "count-min": {
			// Split/refactor tasks: behavior tests pass on the untouched
			// monolith, so require the restructure to have happened (enough
			// top-level definitions) alongside the behavior gate.
			const path = join(dir, verifySpec.path);
			if (!existsSync(path))
				return { resolved: false, detail: `missing ${verifySpec.path}` };
			const content = readFileSync(path, "utf8");
			const n = (content.match(new RegExp(verifySpec.pattern, "gm")) ?? [])
				.length;
			return {
				resolved: n >= verifySpec.min,
				detail: `count=${n} min=${verifySpec.min} ${verifySpec.path}`,
			};
		}
		case "all": {
			// Composite: every sub-verifier must resolve (e.g. behavior gate
			// AND structural marker). Fails fast.
			for (const sub of verifySpec.specs as any[]) {
				const r = verify(sub, dir);
				if (!r.resolved) {
					return { resolved: false, detail: `all: ${r.detail}` };
				}
			}
			return { resolved: true, detail: "all: every sub-verifier passed" };
		}
		case "pytest": {
			// Verify must never hang: an untouched fixture can contain code
			// that loops forever when the tested behavior is missing (T13).
			// Timeout is treated as unresolved, same as a failing test.
			const proc = Bun.spawnSync(
				["python3", "-m", "pytest", ...verifySpec.test.split(" "), "-q"],
				{ cwd: dir, timeout: 60_000, killSignal: 9 },
			);
			if (proc.signalCode === "SIGKILL") {
				return { resolved: false, detail: "pytest verify timeout" };
			}
			return {
				resolved: proc.exitCode === 0,
				detail: `pytest exit=${proc.exitCode}`,
			};
		}
		default:
			return {
				resolved: false,
				detail: `unknown verify type ${verifySpec.type}`,
			};
	}
}
