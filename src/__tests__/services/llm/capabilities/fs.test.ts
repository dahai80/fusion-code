import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { LocalFsCapability } = await import(
	"../../../../services/llm/capabilities/fs.js"
);

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "ctx-fs-"));
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

describe("LocalFsCapability.read", () => {
	test("round-trips write then read full content", async () => {
		const cap = new LocalFsCapability(tmpDir);
		const path = join(tmpDir, "a.txt");
		await cap.write(path, "hello world\nline two");
		expect(await cap.read(path)).toBe("hello world\nline two");
	});

	test("offset/limit slices lines", async () => {
		const cap = new LocalFsCapability(tmpDir);
		const path = join(tmpDir, "b.txt");
		const content = ["l0", "l1", "l2", "l3", "l4"].join("\n");
		await writeFile(path, content, "utf8");
		// offset=1 limit=2 → lines 1,2
		expect(await cap.read(path, { offset: 1, limit: 2 })).toBe("l1\nl2");
	});

	test("offset without limit reads to end", async () => {
		const cap = new LocalFsCapability(tmpDir);
		const path = join(tmpDir, "c.txt");
		await writeFile(path, "x\ny\nz", "utf8");
		expect(await cap.read(path, { offset: 1 })).toBe("y\nz");
	});
});

describe("LocalFsCapability.glob", () => {
	test("returns matching entries under cwd", async () => {
		const cap = new LocalFsCapability(tmpDir);
		await mkdir(join(tmpDir, "sub"), { recursive: true });
		await writeFile(join(tmpDir, "a.ts"), "", "utf8");
		await writeFile(join(tmpDir, "b.md"), "", "utf8");
		await writeFile(join(tmpDir, "sub", "c.ts"), "", "utf8");
		const ts = await cap.glob("**/*.ts");
		expect(ts.sort()).toEqual(["a.ts", "sub/c.ts"]);
	});
});

describe("LocalFsCapability.grep", () => {
	test("content mode returns matched lines with path", async () => {
		const cap = new LocalFsCapability(tmpDir);
		await writeFile(join(tmpDir, "g.txt"), "alpha\nbeta\nGAMMA\ndelta", "utf8");
		const out = await cap.grep("GAMMA");
		// rg -n output: <path>:<lineno>:<match>
		expect(out).toContain("GAMMA");
		expect(out).toContain("g.txt");
	});

	test("no matches returns empty string (rg exit 1, not error)", async () => {
		const cap = new LocalFsCapability(tmpDir);
		await writeFile(join(tmpDir, "h.txt"), "nothing here", "utf8");
		expect(await cap.grep("zzz_nomatch_zzz")).toBe("");
	});

	test("files_with_matches mode lists matching files", async () => {
		const cap = new LocalFsCapability(tmpDir);
		await writeFile(join(tmpDir, "i.txt"), "needle here", "utf8");
		const out = await cap.grep("needle", {
			outputMode: "files_with_matches",
		});
		expect(out.trim()).toContain("i.txt");
	});
});

describe("LocalFsCapability.provider", () => {
	test("provider is local", () => {
		expect(new LocalFsCapability(tmpDir).provider).toBe("local");
	});
});
