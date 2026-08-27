/**
 * ar-plan PR #6 (E2): archive 源 STRICT gate — 缺 sha256 行为单测。
 *
 * - 缺 sha256 + FUSION_CODE_PLUGIN_SHA256_STRICT=1 → throw (fail-visible)
 * - 缺 sha256 + STRICT 未设 → fail-open (不抛, byte-identical)
 * - schemaVersion=0 接受 (PluginManifestSchema, 兼容窗口)
 *
 * installFromArchive 先 axios.get 下载再查 sha256 (archiveSource.ts:97-125),
 * 故 mock axios 供 zip 字节 (同 discover.test.ts mock.module 模式)。
 * pure 安全逻辑 (verify/extract) 见 archiveSource.test.ts, 此处只测 STRICT gate。
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 真 zip 字节 (fflate 同 archiveSource.test.ts)。空归档 → 0 entries →
// extractArchiveBuffer throw "0 files" (在 sha256 gate 之后, 证明 gate 未拦)。
// 用 await top-level: 测试文件是 ESM, 顶层 await 合法。
const { zipSync } = await import("fflate");
const fakeZipBytes = Buffer.from(zipSync({}, { level: 6 }));

mock.module("axios", () => ({
	default: {
		get: mock(async (_url: string) => ({ data: fakeZipBytes })),
	},
}));

const { installFromArchive } = await import(
	"../utils/plugins/archiveSource.js"
);
const { PluginManifestSchema } = await import("../utils/plugins/schemas.js");

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
	savedEnv.FUSION_CODE_PLUGIN_SHA256_STRICT =
		process.env.FUSION_CODE_PLUGIN_SHA256_STRICT;
	delete process.env.FUSION_CODE_PLUGIN_SHA256_STRICT;
});

afterEach(() => {
	if (savedEnv.FUSION_CODE_PLUGIN_SHA256_STRICT !== undefined) {
		process.env.FUSION_CODE_PLUGIN_SHA256_STRICT =
			savedEnv.FUSION_CODE_PLUGIN_SHA256_STRICT;
	} else {
		delete process.env.FUSION_CODE_PLUGIN_SHA256_STRICT;
	}
});

describe("installFromArchive — STRICT gate (ar-plan PR #6 E2)", () => {
	it("缺 sha256 + STRICT=1 → throw (fail-visible, 强制锁定)", async () => {
		const tmpRoot = await mkdtemp(join(tmpdir(), "archive-strict-"));
		try {
			process.env.FUSION_CODE_PLUGIN_SHA256_STRICT = "1";
			await expect(
				installFromArchive(
					{ source: "archive", url: "https://example.com/p.zip" },
					tmpRoot,
				),
			).rejects.toThrow(/FUSION_CODE_PLUGIN_SHA256_STRICT=1 requires/);
		} finally {
			await rm(tmpRoot, { recursive: true, force: true });
		}
	});

	it("缺 sha256 + STRICT 未设 → fail-open (不抛, byte-identical)", async () => {
		const tmpRoot = await mkdtemp(join(tmpdir(), "archive-open-"));
		try {
			// STRICT unset = 默认 fail-open (兼容期渐进)。
			// mock axios 返回空 zip → extractArchiveBuffer throw "0 files",
			// 但那在 sha256 gate 之后, 证明 gate 未拦 (走到解压步)。
			await expect(
				installFromArchive(
					{ source: "archive", url: "https://example.com/p.zip" },
					tmpRoot,
				),
			).rejects.toThrow(/0 files/);
		} finally {
			await rm(tmpRoot, { recursive: true, force: true });
		}
	});

	it("缺 sha256 + STRICT=0 → fail-open (falsy 不触发)", async () => {
		const tmpRoot = await mkdtemp(join(tmpdir(), "archive-strict0-"));
		try {
			process.env.FUSION_CODE_PLUGIN_SHA256_STRICT = "0";
			await expect(
				installFromArchive(
					{ source: "archive", url: "https://example.com/p.zip" },
					tmpRoot,
				),
			).rejects.toThrow(/0 files/);
		} finally {
			await rm(tmpRoot, { recursive: true, force: true });
		}
	});

	it("缺 sha256 + STRICT=空串 → fail-open (falsy 不触发)", async () => {
		const tmpRoot = await mkdtemp(join(tmpdir(), "archive-emptystr-"));
		try {
			process.env.FUSION_CODE_PLUGIN_SHA256_STRICT = "";
			await expect(
				installFromArchive(
					{ source: "archive", url: "https://example.com/p.zip" },
					tmpRoot,
				),
			).rejects.toThrow(/0 files/);
		} finally {
			await rm(tmpRoot, { recursive: true, force: true });
		}
	});
});

describe("PluginManifestSchema — schemaVersion (ar-plan PR #6 E2)", () => {
	// 最小合法 manifest (name 必填, 余 optional)。PluginManifestSchema 是 lazy
	// 工厂 → 调用取 .shape。manifest 字段全集见 schemas.ts:891-920。
	function minimalManifest(
		overrides: Record<string, unknown> = {},
	): Record<string, unknown> {
		return { name: "test-plugin", ...overrides };
	}

	it("缺 schemaVersion → undefined (optional), parse 通过 (兼容窗口)", () => {
		const r = PluginManifestSchema().safeParse(minimalManifest());
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.schemaVersion).toBeUndefined();
		}
	});

	it("schemaVersion=0 显式 → parse 通过", () => {
		const r = PluginManifestSchema().safeParse(
			minimalManifest({ schemaVersion: 0 }),
		);
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.schemaVersion).toBe(0);
		}
	});

	it("schemaVersion=2 (stable even) → parse 通过", () => {
		const r = PluginManifestSchema().safeParse(
			minimalManifest({ schemaVersion: 2 }),
		);
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.schemaVersion).toBe(2);
		}
	});

	it("schemaVersion=1 (experimental odd) → parse 通过", () => {
		const r = PluginManifestSchema().safeParse(
			minimalManifest({ schemaVersion: 1 }),
		);
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.schemaVersion).toBe(1);
		}
	});

	it("schemaVersion 非整数 → 拒绝", () => {
		const r = PluginManifestSchema().safeParse(
			minimalManifest({ schemaVersion: 1.5 }),
		);
		expect(r.success).toBe(false);
	});

	it("schemaVersion 非数字 → 拒绝", () => {
		const r = PluginManifestSchema().safeParse(
			minimalManifest({ schemaVersion: "2" }),
		);
		expect(r.success).toBe(false);
	});
});
