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
import { chmod, mkdir, writeFile } from "node:fs/promises";
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

	// 下载 raw zip 字节 (arraybuffer, 同 officialMarketplaceGcs.ts:107-111)
	const response = await axios.get(safeUrl, {
		responseType: "arraybuffer",
		timeout: ARCHIVE_DOWNLOAD_TIMEOUT_MS,
		maxRedirects: 5,
	});
	const zipBuf = Buffer.from(response.data);
	logForDebugging(
		`archive source: downloaded ${zipBuf.length} bytes from ${safeUrl}`,
	);

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
