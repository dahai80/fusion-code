// item 23: 插件 `archive` 源 — HTTPS zip 下载 + 可选 SHA-256 锁定 (CC 2.1.224, §138/§215)
//
// 与 url 源 (git-clone) 区别: archive 下 raw .zip 文件 (非 git 仓库), 可选
// SHA-256 内容锁定 (下载字节校验, mismatch refuse 不 fallback)。
//
// 安全 (供应链防篡改):
//   - 仅 HTTPS (拒 http://, 同 mcpbHandler.ts:714 / validateGitUrl precedent)
//   - sha256 提供时: createHash('sha256').update(zipBuf).digest('hex') 常量时间比较,
//     mismatch throw 不解压 (fail-visible, Rule 12)
//   - sha256 省略: 跳过校验 + warn 日志 (匹配 "可选锁定" 原意, fail-open 告知不阻断)
//   - 解压复用 dxt/zip.ts unzipFile (zip-bomb 防护: 100k files / 512MB / 1024MB /
//     50:1 比率) + parseZipModes (exec-bit 保留) + isPathSafe (路径遍历防护)
//
// 物化执行不接 addMarketplaceSource stub (cloud-only 桩, 同其他所有源)。
// 本模块导出独立可测的 installFromArchive 真逻辑, cachePlugin switch 调之。

import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { closeSync, fdatasyncSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import axios from "axios";
import { logForDebugging } from "../debug.js";
import { isPathSafe, parseZipModes, unzipFile } from "../dxt/zip.js";
import { isEnvTruthy } from "../envUtils.js";
import type { PluginSource } from "./schemas.js";

// archive 源子集 (PluginSource 的 source:'archive' 变体)
export interface ArchivePluginSource {
	source: "archive";
	url: string;
	sha256?: string;
	rootDir?: string;
}

// 下载超时 (zip 通常 MB 级, 2min 足够; 大包如超时多半网络问题)
const ARCHIVE_DOWNLOAD_TIMEOUT_MS = 120_000;

// P1-29: 下载累计字节硬上限 — 流式写盘边下边累计, 超限即 abort。与解压层
// (dxt/zip.ts 100k files / 512MB / 1024MB / 50:1) 形成纵深: 下载阶段先拒超大
// 压缩体, 防缓冲 OOM 前就断流。50MB 与 maxContentLength 对齐。
const ARCHIVE_MAX_DOWNLOAD_BYTES = 50_000_000;

/**
 * 判定 PluginSource 是否为 archive 源 (type guard)。
 */
export function isArchivePluginSource(
	source: PluginSource,
): source is ArchivePluginSource {
	return typeof source !== "string" && source.source === "archive";
}

/**
 * 常量时间 SHA-256 比较 (防 timing attack, 非 ===)。
 * 长度不同先拒 (timingSafeEqual 要等长 Buffer)。
 */
function verifySha256(zipBuf: Buffer, expectedHex: string): boolean {
	const actual = createHash("sha256").update(zipBuf).digest("hex");
	if (actual.length !== expectedHex.length) {
		return false;
	}
	const a = Buffer.from(actual);
	const b = Buffer.from(expectedHex);
	return timingSafeEqual(a, b);
}

/**
 * 仅 HTTPS URL (拒 http://)。同 validateGitUrl / mcpbHandler precedent。
 */
function validateHttpsUrl(url: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`Invalid archive URL: ${url}`);
	}
	if (parsed.protocol !== "https:") {
		throw new Error(
			`archive source requires HTTPS URL (got ${parsed.protocol}). ` +
				"HTTP is insecure and not allowed.",
		);
	}
	return url;
}

/**
 * P1-29: 重定向目标 HTTPS 校验。初始 URL 经 validateHttpsUrl 已锁 https,
 * 但 maxRedirects:5 跟随重定向时服务器可 302 到 http:// (降级/中间人)。
 * axios beforeRedirect 回调在每次重定向前触发, options 即新请求配置 —
 * 校验 options.protocol === 'https:' 否则抛错中断 (fail-visible, Rule 12)。
 * 仅放过 https: 重定向, 防下载链路被无声降级到明文。
 */
function assertRedirectHttps(options: {
	protocol?: string;
	hostname?: string;
}): void {
	const proto = options.protocol ?? "";
	if (proto !== "https:") {
		throw new Error(
			`archive source redirect to non-HTTPS rejected: ${proto}//${options.hostname ?? "?"}. ` +
				"HTTPS-only chain enforced (initial + all redirects).",
		);
	}
}

/**
 * 下载 zip → (可选) SHA-256 校验 → 解压到 targetPath。
 *
 * fail-visible (Rule 12): 网络/校验失败/解压失败全 throw, 不静默降级。
 * cachePlugin catch 块负责清理 tempPath。
 *
 * @param source archive 源 (url + 可选 sha256 + 可选 rootDir)
 * @param targetPath 解压目标目录 (cachePlugin 提供的 tempPath)
 */
export async function installFromArchive(
	source: ArchivePluginSource,
	targetPath: string,
): Promise<void> {
	const safeUrl = validateHttpsUrl(source.url);
	logForDebugging(`archive source: downloading ${safeUrl}`);

	// P1-29: 流到临时文件带累计字节上限 (非全量 arraybuffer 缓冲)。
	// 全量 arraybuffer 在解压层 zip-bomb 检查之前就把整包载入 RAM, 攻陷/恶意
	// archive 返多 GB → 进程 OOM。改为 responseType:"stream" 逐块写盘 + 累计
	// bytes, 超 ARCHIVE_MAX_DOWNLOAD_BYTES 即 abort + 删 temp。从盘读回 Buffer
	// 再交 unzipFile (解压层仍守 100k files / 512MB / 50:1)。
	// P1-29b: beforeRedirect 锁每跳重定向亦 https (assertRedirectHttps), 防链路
	// 被 302 无声降级到 http:// 明文。
	const tmpPath = join(tmpdir(), `fusion-archive-${process.pid}-${Date.now()}.zip`);
	let zipBuf: Buffer;
	try {
		const response = await axios.get(safeUrl, {
			responseType: "stream",
			timeout: ARCHIVE_DOWNLOAD_TIMEOUT_MS,
			maxRedirects: 5,
			maxContentLength: ARCHIVE_MAX_DOWNLOAD_BYTES,
			maxBodyLength: ARCHIVE_MAX_DOWNLOAD_BYTES,
			beforeRedirect: (options) => {
				assertRedirectHttps(options as { protocol?: string; hostname?: string });
			},
		});
		const stream = response.data as NodeJS.ReadableStream & {
			destroy(error?: Error): void;
		};
		const fh = await open(tmpPath, "w");
		let received = 0;
		let oversize = false;
		try {
			for await (const chunk of stream) {
				received += chunk.length;
				if (received > ARCHIVE_MAX_DOWNLOAD_BYTES) {
					oversize = true;
					stream.destroy(new Error(`archive download exceeded ${ARCHIVE_MAX_DOWNLOAD_BYTES} bytes (size cap)`));
					break;
				}
				await fh.writeFile(chunk as Buffer);
			}
		} finally {
			await fh.close().catch(() => {});
		}
		if (oversize) {
			throw new Error(
				`archive source aborted: response exceeded ${ARCHIVE_MAX_DOWNLOAD_BYTES} bytes (size cap) from ${safeUrl}`,
			);
		}
		// 落盘耐久性: fdatasync 后再读回, 防 crash 留半写文件被当完整 zip 解。
		let fdSync: number | undefined;
		try {
			fdSync = openSync(tmpPath, "r");
			fdatasyncSync(fdSync);
		} catch {
			// 非正确性问题, 仅丢失断电耐久性。
		} finally {
			if (fdSync !== undefined) closeSync(fdSync);
		}
		zipBuf = await readFile(tmpPath);
		logForDebugging(
			`archive source: downloaded ${zipBuf.length} bytes from ${safeUrl}`,
		);
	} finally {
		await unlink(tmpPath).catch(() => {});
	}

	// SHA-256 锁定 (可选) — 提供则校验, mismatch refuse 不解压
	if (source.sha256) {
		verifyArchiveIntegrity(zipBuf, source.sha256, safeUrl);
		logForDebugging(`archive source: SHA-256 verified for ${safeUrl}`);
	} else {
		// ar-plan PR #6 (E2): STRICT 模式下缺 sha256 也抛错 (fail-visible),
		// 强制供应链锁定。env 未设 = 仍 fail-open (byte-identical, 兼容期渐进)。
		if (isEnvTruthy(process.env.FUSION_CODE_PLUGIN_SHA256_STRICT)) {
			throw new Error(
				`archive source missing sha256 pin for ${safeUrl}: ` +
					"FUSION_CODE_PLUGIN_SHA256_STRICT=1 requires integrity pinning. " +
					"Add a sha256 field to the archive source.",
			);
		}
		// fail-open 告知 (不阻断, 但记日志 — 无校验 = 信任 HTTPS 传输)
		logForDebugging(
			`archive source: no sha256 pin provided for ${safeUrl}, skipping integrity check`,
		);
	}

	await extractArchiveBuffer(zipBuf, targetPath, source.rootDir);

	logForDebugging(`archive source: extracted to ${targetPath}`);
}

/**
 * SHA-256 完整性校验 (供 installFromArchive + 单测直接调, 无需 axios mock)。
 * mismatch → throw (fail-visible, Rule 12), 不静默降级。
 */
export function verifyArchiveIntegrity(
	zipBuf: Buffer,
	expectedHex: string,
	urlForMsg: string = "archive",
): void {
	if (!verifySha256(zipBuf, expectedHex)) {
		throw new Error(
			`archive SHA-256 mismatch for ${urlForMsg}: expected ${expectedHex}`,
		);
	}
}

/**
 * 解压 zip 字节到 targetPath (供 installFromArchive + 单测直接调)。
 * 复用 dxt/zip.ts (zip-bomb + 路径遍历防护) + rootDir 剥离 + exec-bit 保留。
 * 0 文件 → throw (空归档/无 rootDir 匹配)。
 */
export async function extractArchiveBuffer(
	zipBuf: Buffer,
	targetPath: string,
	rootDir?: string,
): Promise<void> {
	const files = await unzipFile(zipBuf);
	const modes = parseZipModes(zipBuf);
	logForDebugging(
		`archive source: unzipped ${Object.keys(files).length} entries`,
	);

	// rootDir: 归档内插件根子目录 (如 "my-plugin-main")。无则整体解压。
	const stripPrefix = rootDir ? `${rootDir.replace(/\/$/, "")}/` : "";
	if (stripPrefix) {
		logForDebugging(`archive source: stripping rootDir "${rootDir}"`);
	}

	await mkdir(targetPath, { recursive: true });

	let extractedFiles = 0;
	for (const [relPath, data] of Object.entries(files)) {
		// 跳过目录条目 (尾部斜杠)
		if (relPath.endsWith("/")) {
			if (!stripPrefix || relPath.startsWith(stripPrefix)) {
				const targetDir = stripPrefix
					? relPath.slice(stripPrefix.length)
					: relPath;
				if (targetDir) {
					await mkdir(join(targetPath, targetDir), { recursive: true });
				}
			}
			continue;
		}

		// rootDir 剥离: 仅提取 prefix 内文件, 丢弃归档外层其他文件
		let outPath = relPath;
		if (stripPrefix) {
			if (!relPath.startsWith(stripPrefix)) {
				continue; // rootDir 外文件跳过
			}
			outPath = relPath.slice(stripPrefix.length);
		}

		// isPathSafe 防路径遍历/绝对路径 (dxt/zip.ts:44-58)
		if (!isPathSafe(outPath)) {
			throw new Error(`archive entry unsafe path: ${relPath}`);
		}

		const fullPath = join(targetPath, outPath);
		await mkdir(dirname(fullPath), { recursive: true });
		await writeFile(fullPath, data);
		// exec-bit 保留 (hooks/scripts 需 +x, 同 zipCache.ts:353-357)
		const mode = modes[relPath];
		if (mode && mode & 0o111) {
			await chmod(fullPath, mode & 0o777).catch(() => {});
		}
		extractedFiles++;
	}

	if (extractedFiles === 0) {
		throw new Error(
			`archive source extracted 0 files` +
				(stripPrefix ? ` (rootDir "${rootDir}" matched nothing)` : ""),
		);
	}

	logForDebugging(
		`archive source: extracted ${extractedFiles} files to ${targetPath}`,
	);
}
