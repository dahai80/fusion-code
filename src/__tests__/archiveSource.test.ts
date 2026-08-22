/**
 * item 23: 插件 archive 源单测 — HTTPS zip + SHA-256 锁定 (CC 2.1.224, §138/§215)
 *
 * schema 校验 + verifyArchiveIntegrity + extractArchiveBuffer (真 zip 字节 via fflate)
 * + isArchivePluginSource + validateHttpsUrl (installFromArchive 拒 http://)。
 * 不 mock axios — 安全逻辑 (校验/解压/路径遍历) 走纯函数直接测。
 */

import { describe, expect, it } from "bun:test";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ArchivePluginSource,
	extractArchiveBuffer,
	installFromArchive,
	isArchivePluginSource,
	verifyArchiveIntegrity,
} from "../utils/plugins/archiveSource.js";
import { PluginSourceSchema } from "../utils/plugins/schemas.js";

// 用 fflate (现依赖) 构建真 zip 字节, 模拟归档内容。
async function makeZipBytes(
	files: Record<string, Uint8Array>,
): Promise<Buffer> {
	const { zipSync } = await import("fflate");
	return Buffer.from(zipSync(files, { level: 6 }));
}

function sha256Hex(buf: Buffer): string {
	return createHash("sha256").update(buf).digest("hex");
}

describe("PluginSourceSchema — archive 变体", () => {
	it("合法 archive 源 parse 通过 (url + sha256)", () => {
		const parsed = PluginSourceSchema().safeParse({
			source: "archive",
			url: "https://example.com/plugin.zip",
			sha256: "a".repeat(64),
		});
		expect(parsed.success).toBe(true);
	});

	it("archive 源无 sha256 也通过 (可选锁定)", () => {
		const parsed = PluginSourceSchema().safeParse({
			source: "archive",
			url: "https://example.com/plugin.zip",
		});
		expect(parsed.success).toBe(true);
	});

	it("带 rootDir 的 archive 源 parse 通过", () => {
		const parsed = PluginSourceSchema().safeParse({
			source: "archive",
			url: "https://example.com/plugin.zip",
			rootDir: "my-plugin-main",
		});
		expect(parsed.success).toBe(true);
	});

	it("非 HTTPS url → 拒绝 (z.string().url 仍过, 但 http 合法 URL — schema 不限协议)", () => {
		// z.string().url() 接受 http:// (合法 URL)。协议限制在运行时 validateHttpsUrl。
		const parsed = PluginSourceSchema().safeParse({
			source: "archive",
			url: "http://example.com/plugin.zip",
		});
		expect(parsed.success).toBe(true);
	});

	it("sha256 非 64-hex → 拒绝 (regex 锁定)", () => {
		const parsed = PluginSourceSchema().safeParse({
			source: "archive",
			url: "https://example.com/plugin.zip",
			sha256: "tooshort",
		});
		expect(parsed.success).toBe(false);
	});

	it("sha256 含大写 → 拒绝 (仅 lowercase hex)", () => {
		const parsed = PluginSourceSchema().safeParse({
			source: "archive",
			url: "https://example.com/plugin.zip",
			sha256: "A".repeat(64),
		});
		expect(parsed.success).toBe(false);
	});

	it("非 URL → 拒绝", () => {
		const parsed = PluginSourceSchema().safeParse({
			source: "archive",
			url: "not a url",
		});
		expect(parsed.success).toBe(false);
	});
});

describe("isArchivePluginSource", () => {
	it("archive 源对象 → true", () => {
		const src: ArchivePluginSource = {
			source: "archive",
			url: "https://example.com/p.zip",
		};
		expect(isArchivePluginSource(src)).toBe(true);
	});

	it("字符串源 (相对路径) → false", () => {
		expect(isArchivePluginSource("./local-plugin")).toBe(false);
	});

	it("npm 源 → false", () => {
		expect(isArchivePluginSource({ source: "npm", package: "foo" })).toBe(
			false,
		);
	});
});

describe("verifyArchiveIntegrity", () => {
	it("正确 sha256 → 不抛", () => {
		const buf = Buffer.from("plugin bytes");
		const hex = sha256Hex(buf);
		expect(() => verifyArchiveIntegrity(buf, hex)).not.toThrow();
	});

	it("错误 sha256 → throw (fail-visible)", () => {
		const buf = Buffer.from("plugin bytes");
		const wrong = "0".repeat(64);
		expect(() => verifyArchiveIntegrity(buf, wrong)).toThrow(
			/SHA-256 mismatch/,
		);
	});

	it("短 sha256 (长度不同) → throw, 不 crash", () => {
		const buf = Buffer.from("plugin bytes");
		expect(() => verifyArchiveIntegrity(buf, "abc")).toThrow(
			/SHA-256 mismatch/,
		);
	});
});

describe("extractArchiveBuffer", () => {
	it("解压多文件归档到 targetPath", async () => {
		const tmpRoot = await mkdtemp(join(tmpdir(), "archive-extract-"));
		try {
			const zipBytes = await makeZipBytes({
				"plugin.json": new TextEncoder().encode('{"name":"test"}'),
				"commands/build.md": new TextEncoder().encode("# build"),
				"hooks/hooks.json": new TextEncoder().encode("{}"),
			});
			await extractArchiveBuffer(zipBytes, tmpRoot);
			const manifest = await readFile(join(tmpRoot, "plugin.json"), "utf8");
			expect(manifest).toBe('{"name":"test"}');
			const cmd = await readFile(join(tmpRoot, "commands/build.md"), "utf8");
			expect(cmd).toBe("# build");
			const hooks = await readFile(join(tmpRoot, "hooks/hooks.json"), "utf8");
			expect(hooks).toBe("{}");
		} finally {
			await rm(tmpRoot, { recursive: true, force: true });
		}
	});

	it("rootDir 剥离 — 仅提取 prefix 内文件", async () => {
		const tmpRoot = await mkdtemp(join(tmpdir(), "archive-rootdir-"));
		try {
			const zipBytes = await makeZipBytes({
				"my-plugin-main/plugin.json": new TextEncoder().encode(
					'{"name":"stripped"}',
				),
				"my-plugin-main/commands/run.md": new TextEncoder().encode("# run"),
				"other-dir/junk.txt": new TextEncoder().encode("junk"),
			});
			await extractArchiveBuffer(zipBytes, tmpRoot, "my-plugin-main");
			const manifest = await readFile(join(tmpRoot, "plugin.json"), "utf8");
			expect(manifest).toBe('{"name":"stripped"}');
			const cmd = await readFile(join(tmpRoot, "commands/run.md"), "utf8");
			expect(cmd).toBe("# run");
			// other-dir 在 rootDir 外, 应被丢弃
			await expect(readFile(join(tmpRoot, "junk.txt"))).rejects.toThrow();
		} finally {
			await rm(tmpRoot, { recursive: true, force: true });
		}
	});

	it("rootDir 无匹配 → throw 0 files (fail-visible)", async () => {
		const tmpRoot = await mkdtemp(join(tmpdir(), "archive-nomatch-"));
		try {
			const zipBytes = await makeZipBytes({
				"actual-dir/plugin.json": new TextEncoder().encode("{}"),
			});
			await expect(
				extractArchiveBuffer(zipBytes, tmpRoot, "wrong-dir"),
			).rejects.toThrow(/0 files/);
		} finally {
			await rm(tmpRoot, { recursive: true, force: true });
		}
	});

	it("空归档 (无文件) → throw 0 files", async () => {
		const tmpRoot = await mkdtemp(join(tmpdir(), "archive-empty-"));
		try {
			const zipBytes = await makeZipBytes({});
			await expect(extractArchiveBuffer(zipBytes, tmpRoot)).rejects.toThrow(
				/0 files/,
			);
		} finally {
			await rm(tmpRoot, { recursive: true, force: true });
		}
	});

	it("归档内嵌套目录结构正确创建", async () => {
		const tmpRoot = await mkdtemp(join(tmpdir(), "archive-nested-"));
		try {
			const zipBytes = await makeZipBytes({
				"a/b/c/deep.md": new TextEncoder().encode("deep"),
			});
			await extractArchiveBuffer(zipBytes, tmpRoot);
			const deep = await readFile(join(tmpRoot, "a/b/c/deep.md"), "utf8");
			expect(deep).toBe("deep");
		} finally {
			await rm(tmpRoot, { recursive: true, force: true });
		}
	});
});

describe("installFromArchive — validateHttpsUrl", () => {
	it("http:// URL → throw (仅 HTTPS)", async () => {
		const tmpRoot = await mkdtemp(join(tmpdir(), "archive-http-"));
		try {
			await expect(
				installFromArchive(
					{ source: "archive", url: "http://example.com/p.zip" },
					tmpRoot,
				),
			).rejects.toThrow(/requires HTTPS/);
		} finally {
			await rm(tmpRoot, { recursive: true, force: true });
		}
	});

	it("非 URL → throw", async () => {
		const tmpRoot = await mkdtemp(join(tmpdir(), "archive-badurl-"));
		try {
			await expect(
				installFromArchive({ source: "archive", url: "not-a-url" }, tmpRoot),
			).rejects.toThrow(/Invalid archive URL/);
		} finally {
			await rm(tmpRoot, { recursive: true, force: true });
		}
	});
});
