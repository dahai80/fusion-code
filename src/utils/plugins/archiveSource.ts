// item 23: plugin `archive` source — HTTPS zip download + optional SHA-256 pinning (CC 2.1.224, §138/§215)
//
// Difference from the url source (git-clone): archive downloads a raw .zip file (not a git repo), with
// optional SHA-256 content pinning (byte verification on download, mismatch refuses without fallback).
//
// Security (supply-chain tamper resistance):
//   - HTTPS only (reject http://, same as mcpbHandler.ts:714 / validateGitUrl precedent)
//   - When sha256 is provided: constant-time comparison via createHash('sha256').update(zipBuf).digest('hex'),
//     mismatch throws without extraction (fail-visible, Rule 12)
//   - When sha256 is omitted: skip verification + warn log (matches the "optional pinning" intent, fail-open with notice, non-blocking)
//   - Extraction reuses dxt/zip.ts unzipFile (zip-bomb guards: 100k files / 512MB / 1024MB /
//     50:1 ratio) + parseZipModes (exec-bit preservation) + isPathSafe (path traversal protection)
//
// Materialization does not wire the addMarketplaceSource stub (cloud-only stub, same as all other sources).
// This module exports independently testable installFromArchive real logic, called from the cachePlugin switch.

import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual } from "node:crypto";
import { closeSync, fdatasyncSync, openSync } from "node:fs";
import {
	chmod,
	mkdir,
	open,
	readFile,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import axios from "axios";
import { logForDebugging } from "../debug.js";
import { isPathSafe, parseZipModes, unzipFile } from "../dxt/zip.js";
import { isEnvTruthy } from "../envUtils.js";
import type { PluginSource } from "./schemas.js";

// archive source subset (PluginSource's source:'archive' variant)
export interface ArchivePluginSource {
	source: "archive";
	url: string;
	sha256?: string;
	rootDir?: string;
}

// Download timeout (zips are usually MB-scale, 2min is enough; timeouts on large archives are mostly network issues)
const ARCHIVE_DOWNLOAD_TIMEOUT_MS = 120_000;

// P1-29: hard cap on cumulative download bytes — count while streaming to disk, abort on exceed. Forms
// defense-in-depth with the extraction layer (dxt/zip.ts 100k files / 512MB / 1024MB / 50:1): the
// download phase rejects an oversized compressed body first, cutting the stream before a buffered OOM.
// 50MB aligned with maxContentLength.
const ARCHIVE_MAX_DOWNLOAD_BYTES = 50_000_000;

/**
 * Determine whether a PluginSource is an archive source (type guard).
 */
export function isArchivePluginSource(
	source: PluginSource,
): source is ArchivePluginSource {
	return typeof source !== "string" && source.source === "archive";
}

/**
 * Constant-time SHA-256 comparison (guards against timing attacks, not ===).
 * Reject differing lengths first (timingSafeEqual requires equal-length Buffers).
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
 * HTTPS-only URL (reject http://). Same as validateGitUrl / mcpbHandler precedent.
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
 * P1-29: HTTPS validation of redirect targets. The initial URL is already pinned to https by
 * validateHttpsUrl, but when following redirects with maxRedirects:5 the server can 302 to http://
 * (downgrade/MITM). The axios beforeRedirect callback fires before each redirect; options is the new
 * request config —
 * verify options.protocol === 'https:' or throw to abort (fail-visible, Rule 12).
 * Only https: redirects are allowed, preventing silent downgrade of the download chain to plaintext.
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
 * Download zip → (optional) SHA-256 verification → extract to targetPath.
 *
 * fail-visible (Rule 12): network / verification failure / extraction failure all throw, no silent degradation.
 * The cachePlugin catch block cleans up tempPath.
 *
 * @param source archive source (url + optional sha256 + optional rootDir)
 * @param targetPath extraction target directory (tempPath provided by cachePlugin)
 */
export async function installFromArchive(
	source: ArchivePluginSource,
	targetPath: string,
): Promise<void> {
	const safeUrl = validateHttpsUrl(source.url);
	logForDebugging(`archive source: downloading ${safeUrl}`);

	// P1-29: stream to a temp file with a cumulative byte cap (not full arraybuffer buffering).
	// A full arraybuffer loads the entire package into RAM before the extraction layer's zip-bomb
	// check — a compromised/malicious archive returning multi-GB → process OOM. Instead use
	// responseType:"stream", write to disk chunk by chunk + accumulate
	// bytes; abort + delete temp on exceeding ARCHIVE_MAX_DOWNLOAD_BYTES. Read the Buffer back
	// from disk and hand it to unzipFile (the extraction layer still enforces 100k files / 512MB / 50:1).
	// P1-29b: beforeRedirect pins every redirect hop to https (assertRedirectHttps), preventing the
	// chain from being silently downgraded to http:// plaintext via 302.
	const tmpPath = join(
		tmpdir(),
		`fusion-archive-${process.pid}-${Date.now()}.zip`,
	);
	let zipBuf: Buffer;
	try {
		const response = await axios.get(safeUrl, {
			responseType: "stream",
			timeout: ARCHIVE_DOWNLOAD_TIMEOUT_MS,
			maxRedirects: 5,
			maxContentLength: ARCHIVE_MAX_DOWNLOAD_BYTES,
			maxBodyLength: ARCHIVE_MAX_DOWNLOAD_BYTES,
			beforeRedirect: (options) => {
				assertRedirectHttps(
					options as { protocol?: string; hostname?: string },
				);
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
					stream.destroy(
						new Error(
							`archive download exceeded ${ARCHIVE_MAX_DOWNLOAD_BYTES} bytes (size cap)`,
						),
					);
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
		// On-disk durability: fdatasync before reading back, preventing a crash from leaving a
		// half-written file that gets treated as a complete zip.
		let fdSync: number | undefined;
		try {
			fdSync = openSync(tmpPath, "r");
			fdatasyncSync(fdSync);
		} catch {
			// Not a correctness issue, only loses power-failure durability.
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

	// SHA-256 pinning — verify when provided, mismatch refuses without extraction
	if (source.sha256) {
		verifyArchiveIntegrity(zipBuf, source.sha256, safeUrl);
		logForDebugging(`archive source: SHA-256 verified for ${safeUrl}`);
	} else {
		// P0-3 (audit R2): strict by default — reject when sha256 is missing (fail-closed), forcing supply-chain pinning.
		// Enterprise baseline: plugin archive sources must carry a sha256 pin, otherwise tampering in HTTPS transit goes undetected.
		// LENIENT mode (FUSION_CODE_PLUGIN_SHA256_LENIENT=1) keeps a fail-open compat window
		// (trusts HTTPS transport, no verification) — only for gradual migration off trusted registries.
		if (!isEnvTruthy(process.env.FUSION_CODE_PLUGIN_SHA256_LENIENT)) {
			throw new Error(
				`archive source missing sha256 pin for ${safeUrl}: ` +
					"integrity pinning required by default (enterprise supply-chain baseline). " +
					"Add a sha256 field to the archive source, or set " +
					"FUSION_CODE_PLUGIN_SHA256_LENIENT=1 to allow unpinned (fail-open).",
			);
		}
		logForDebugging(
			`archive source: no sha256 pin provided for ${safeUrl}, LENIENT mode skipping integrity check`,
		);
	}

	await extractArchiveBuffer(zipBuf, targetPath, source.rootDir);

	logForDebugging(`archive source: extracted to ${targetPath}`);
}

/**
 * SHA-256 integrity verification (called directly by installFromArchive + unit tests, no axios mock needed).
 * mismatch → throw (fail-visible, Rule 12), no silent degradation.
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
 * Extract zip bytes to targetPath (called directly by installFromArchive + unit tests).
 * Reuses dxt/zip.ts (zip-bomb + path traversal protection) + rootDir stripping + exec-bit preservation.
 * 0 files → throw (empty archive / no rootDir match).
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

	// rootDir: plugin root subdirectory inside the archive (e.g. "my-plugin-main"). If absent, extract everything.
	const stripPrefix = rootDir ? `${rootDir.replace(/\/$/, "")}/` : "";
	if (stripPrefix) {
		logForDebugging(`archive source: stripping rootDir "${rootDir}"`);
	}

	await mkdir(targetPath, { recursive: true });

	let extractedFiles = 0;
	for (const [relPath, data] of Object.entries(files)) {
		// Skip directory entries (trailing slash)
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

		// rootDir stripping: only extract files under the prefix, discard other files in the archive's outer layer
		let outPath = relPath;
		if (stripPrefix) {
			if (!relPath.startsWith(stripPrefix)) {
				continue; // skip files outside rootDir
			}
			outPath = relPath.slice(stripPrefix.length);
		}

		// isPathSafe guards path traversal / absolute paths (dxt/zip.ts:44-58)
		if (!isPathSafe(outPath)) {
			throw new Error(`archive entry unsafe path: ${relPath}`);
		}

		const fullPath = join(targetPath, outPath);
		await mkdir(dirname(fullPath), { recursive: true });
		await writeFile(fullPath, data);
		// exec-bit preservation (hooks/scripts need +x, same as zipCache.ts:353-357)
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
