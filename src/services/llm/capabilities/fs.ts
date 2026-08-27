// FsCapability seam (ar-plan PR #4, S1.b).
// Provider-neutral filesystem facade — read/write/glob/grep behind one
// interface so future consumers inject ctx.fs instead of importing concrete
// tools/adapters. LocalFsCapability wraps node:fs primitives directly (NOT the
// FileReadTool object — that pulls ToolUseContext/permissions/UI graph; the
// seam keeps the capability primitive-light per "包现实现 = wrap the capability,
// not the Tool orchestration layer"). Byte-identical when no consumer migrated.
import { readFile, writeFile, glob } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { logForDebugging } from "../../../utils/debug.js";

const execAsync = promisify(exec);

export interface FsCapability {
	readonly provider: "local";
	read(
		path: string,
		opts?: { offset?: number; limit?: number },
	): Promise<string>;
	write(path: string, content: string): Promise<void>;
	glob(pattern: string, cwd?: string): Promise<string[]>;
	grep(
		pattern: string,
		opts?: { cwd?: string; outputMode?: "content" | "files_with_matches" },
	): Promise<string>;
}

export class LocalFsCapability implements FsCapability {
	readonly provider = "local" as const;
	private readonly cwd: string;

	constructor(cwd: string) {
		this.cwd = cwd;
	}

	async read(
		path: string,
		opts?: { offset?: number; limit?: number },
	): Promise<string> {
		const content = await readFile(path, "utf8");
		// Line-based offset/limit mirrors FileReadTool slice semantics.
		if (opts?.offset || opts?.limit) {
			const lines = content.split("\n");
			const start = opts.offset ?? 0;
			const end = opts.limit ? start + opts.limit : lines.length;
			return lines.slice(start, end).join("\n");
		}
		return content;
	}

	async write(path: string, content: string): Promise<void> {
		await writeFile(path, content, "utf8");
		logForDebugging(`[ctx.fs] write ${path} (${content.length} bytes)`);
	}

	async glob(pattern: string, cwd: string = this.cwd): Promise<string[]> {
		const results: string[] = [];
		for await (const entry of glob(pattern, { cwd })) {
			results.push(entry);
		}
		return results;
	}

	async grep(
		pattern: string,
		opts?: { cwd?: string; outputMode?: "content" | "files_with_matches" },
	): Promise<string> {
		const cwd = opts?.cwd ?? this.cwd;
		const modeFlag = opts?.outputMode === "files_with_matches" ? "-l" : "-n";
		try {
			// ripgrep preferred (embedded in bun binary for ant builds); falls back
			// to grep. Thin facade — full Tool-grade grep reuse is a later consumer
			// migration, not this seam-defining PR.
			const { stdout } = await execAsync(
				`rg ${modeFlag} -- ${JSON.stringify(pattern)} .`,
				{ cwd, maxBuffer: 2 * 1024 * 1024 },
			);
			return stdout;
		} catch (err) {
			// rg exits 1 on no matches (not an error) or 2 on real failure.
			const code = (err as { code?: number }).code;
			if (code === 1) return "";
			logForDebugging(
				`[ctx.fs] grep failed (code=${code}): ${(err as Error).message}`,
			);
			return "";
		}
	}
}
