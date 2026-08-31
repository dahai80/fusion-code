/**
 * P0-3 (audit R2): archive 源 sha256 gate — 缺 sha256 行为单测。
 *
 * - 缺 sha256 + 默认 (LENIENT 未设) → throw (fail-closed, 企业级供应链基线)
 * - 缺 sha256 + LENIENT=1 → fail-open (走到解压, extractArchiveBuffer throw "0 files")
 * - schemaVersion=0 接受 (PluginManifestSchema, 兼容窗口)
 *
 * installFromArchive 先 axios.get 下载再查 sha256 (archiveSource.ts:97-125),
 * 故 mock axios 供 zip 字节 (同 discover.test.ts mock.module 模式)。
 * pure 安全逻辑 (verify/extract) 见 archiveSource.test.ts, 此处只测 sha256 gate。
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { join } from "node:path";

// 真 zip 字节 (fflate 同 archiveSource.test.ts)。空归档 → 0 entries →
// extractArchiveBuffer throw "0 files" (在 sha256 gate 之后, 证明 gate 未拦)。
// 用 await top-level: 测试文件是 ESM, 顶层 await 合法。
const { zipSync } = await import("fflate");
const fakeZipBytes = Buffer.from(zipSync({}, { level: 6 }));

mock.module("axios", () => ({
	default: {
		// P1-29: installFromArchive 现 responseType:"stream" 流式写盘, 故 mock
		// 返回 Node Readable (非裸 Buffer) — Readable.from(Buffer) 逐块产出字节
		// 且带 destroy(), 与流式下载代码契约一致。
		get: mock(async (_url: string) => ({ data: Readable.from(fakeZipBytes) })),
	},
}));

const { installFromArchive } = await import(
	"../utils/plugins/archiveSource.js"
);
const { PluginManifestSchema } = await import("../utils/plugins/schemas.js");

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
	savedEnv.FUSION_CODE_PLUGIN_SHA256_LENIENT =
		process.env.FUSION_CODE_PLUGIN_SHA256_LENIENT;
	delete process.env.FUSION_CODE_PLUGIN_SHA256_LENIENT;
});

afterEach(() => {
	if (savedEnv.FUSION_CODE_PLUGIN_SHA256_LENIENT !== undefined) {
		process.env.FUSION_CODE_PLUGIN_SHA256_LENIENT =
			savedEnv.FUSION_CODE_PLUGIN_SHA256_LENIENT;
	} else {
		delete process.env.FUSION_CODE_PLUGIN_SHA256_LENIENT;
	}
});

describe("installFromArchive — sha256 gate (P0-3 audit R2)", () => {
	it("缺 sha256 + 默认 → throw (fail-closed, 企业级供应链基线)", async () => {
		const tmpRoot = await mkdtemp(join(tmpdir(), "archive-strict-"));
		try {
			// LENIENT 未设 = 默认 strict (fail-closed)。企业级基线强制 pin。
			await expect(
				installFromArchive(
					{ source: "archive", url: "https://example.com/p.zip" },
					tmpRoot,
				),
			).rejects.toThrow(/integrity pinning required by default/);
		} finally {
			await rm(tmpRoot, { recursive: true, force: true });
		}
	});

	it("缺 sha256 + LENIENT=1 → fail-open (走到解压, byte-identical 兼容期)", async () => {
		const tmpRoot = await mkdtemp(join(tmpdir(), "archive-open-"));
		try {
			// LENIENT=1 = fail-open (受信 registry 渐进迁移)。
			// mock axios 返回空 zip → extractArchiveBuffer throw "0 files",
			// 但那在 sha256 gate 之后, 证明 gate 未拦 (走到解压步)。
			process.env.FUSION_CODE_PLUGIN_SHA256_LENIENT = "1";
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

	it("缺 sha256 + LENIENT=0 → throw (falsy 不触发 fail-open, 仍 strict)", async () => {
		const tmpRoot = await mkdtemp(join(tmpdir(), "archive-lenient0-"));
		try {
			process.env.FUSION_CODE_PLUGIN_SHA256_LENIENT = "0";
			await expect(
				installFromArchive(
					{ source: "archive", url: "https://example.com/p.zip" },
					tmpRoot,
				),
			).rejects.toThrow(/integrity pinning required by default/);
		} finally {
			await rm(tmpRoot, { recursive: true, force: true });
		}
	});

	it("缺 sha256 + LENIENT=空串 → throw (falsy 不触发 fail-open, 仍 strict)", async () => {
		const tmpRoot = await mkdtemp(join(tmpdir(), "archive-emptystr-"));
		try {
			process.env.FUSION_CODE_PLUGIN_SHA256_LENIENT = "";
			await expect(
				installFromArchive(
					{ source: "archive", url: "https://example.com/p.zip" },
					tmpRoot,
				),
			).rejects.toThrow(/integrity pinning required by default/);
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
