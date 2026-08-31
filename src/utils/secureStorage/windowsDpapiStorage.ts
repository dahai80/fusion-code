import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { execaSync } from "execa";
import { logForDebugging } from "../debug.js";
import { getClaudeConfigHomeDir } from "../envUtils.js";
import { getErrnoCode } from "../errors.js";
import { jsonParse, jsonStringify } from "../slowOperations.js";
import type { SecureStorage, SecureStorageData } from "./types.js";

// DPAPI encrypts per-user (CurrentUser scope) — only the Windows account that
// encrypted can decrypt. Stored as base64 of the ciphertext in a file named
// by config-dir hash (mirrors macOS service-name / libsecret label scheme),
// so multiple config dirs don't collide.
const DPAPI_FILE_PREFIX = ".credentials.dpapi";

function getDpapiFileName(): string {
	const configDir = getClaudeConfigHomeDir();
	const isDefaultDir = !process.env.CLAUDE_CONFIG_DIR;
	const dirHash = isDefaultDir
		? ""
		: `-${createHash("sha256").update(configDir).digest("hex").substring(0, 8)}`;
	return `${DPAPI_FILE_PREFIX}${dirHash}.enc`;
}

function getDpapiFilePath(): string {
	return join(getClaudeConfigHomeDir(), getDpapiFileName());
}

// PowerShell availability — Windows always has it, but guard for WSL/edge cases.
let powershellAvailableCache: boolean | undefined;

function isPowerShellAvailable(): boolean {
	if (powershellAvailableCache !== undefined) {
		return powershellAvailableCache;
	}
	try {
		const result = execaSync(
			"powershell.exe",
			["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"],
			{ reject: false, stdio: ["ignore", "pipe", "pipe"], timeout: 10000 },
		);
		powershellAvailableCache = result.exitCode === 0;
	} catch {
		powershellAvailableCache = false;
	}
	return powershellAvailableCache;
}

export function __resetDpapiAvailabilityCache(): void {
	powershellAvailableCache = undefined;
}

// Returns base64 of DPAPI-encrypted UTF-8 JSON, or null on failure.
function dpapiEncrypt(plaintext: string): string | null {
	if (!isPowerShellAvailable()) {
		return null;
	}
	try {
		const inputB64 = Buffer.from(plaintext, "utf-8").toString("base64");
		const script = `
$ErrorActionPreference = 'Stop'
$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$enc = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($enc))
`.trim();
		const result = execaSync(
			"powershell.exe",
			["-NoProfile", "-NonInteractive", "-Command", script],
			{
				input: inputB64,
				reject: false,
				stdio: ["pipe", "pipe", "pipe"],
				timeout: 15000,
			},
		);
		if (result.exitCode === 0 && result.stdout) {
			return result.stdout.trim();
		}
		logForDebugging(
			`[dpapi] encrypt failed (exit ${result.exitCode}): ${result.stderr}`,
		);
		return null;
	} catch (e: unknown) {
		logForDebugging(`[dpapi] encrypt exception: ${e}`);
		return null;
	}
}

function dpapiDecrypt(ciphertextB64: string): string | null {
	if (!isPowerShellAvailable()) {
		return null;
	}
	try {
		const script = `
$ErrorActionPreference = 'Stop'
$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$dec = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($dec))
`.trim();
		const result = execaSync(
			"powershell.exe",
			["-NoProfile", "-NonInteractive", "-Command", script],
			{
				input: ciphertextB64,
				reject: false,
				stdio: ["pipe", "pipe", "pipe"],
				timeout: 15000,
			},
		);
		if (result.exitCode === 0 && result.stdout) {
			return result.stdout;
		}
		logForDebugging(
			`[dpapi] decrypt failed (exit ${result.exitCode}): ${result.stderr}`,
		);
		return null;
	} catch (e: unknown) {
		logForDebugging(`[dpapi] decrypt exception: ${e}`);
		return null;
	}
}

export const windowsDpapiStorage = {
	name: "dpapi",
	read(): SecureStorageData | null {
		try {
			const filePath = getDpapiFilePath();
			if (!existsSync(filePath)) {
				return null;
			}
			const ciphertextB64 = readFileSync(filePath, { encoding: "utf8" });
			const plaintext = dpapiDecrypt(ciphertextB64);
			if (plaintext === null) {
				return null;
			}
			return jsonParse(plaintext);
		} catch (e: unknown) {
			if (getErrnoCode(e) === "ENOENT") {
				return null;
			}
			logForDebugging(`[dpapi] read failed: ${e}`);
			return null;
		}
	},
	async readAsync(): Promise<SecureStorageData | null> {
		return this.read();
	},
	update(data: SecureStorageData): { success: boolean; warning?: string } {
		try {
			if (!isPowerShellAvailable()) {
				return {
					success: false,
					warning:
						"PowerShell not found. DPAPI encrypted storage unavailable on this Windows environment.",
				};
			}
			const filePath = getDpapiFilePath();
			const configDir = getClaudeConfigHomeDir();
			try {
				mkdirSync(configDir, { recursive: true, mode: 0o700 });
			} catch (e: unknown) {
				if (getErrnoCode(e) !== "EEXIST") throw e;
			}
			try {
				chmodSync(configDir, 0o700);
			} catch {
				// best-effort hardening
			}
			const plaintext = jsonStringify(data);
			const ciphertextB64 = dpapiEncrypt(plaintext);
			if (ciphertextB64 === null) {
				return {
					success: false,
					warning: "Failed to encrypt credentials via DPAPI.",
				};
			}
			const tmpPath = `${filePath}.tmp`;
			writeFileSync(tmpPath, ciphertextB64, { encoding: "utf8", mode: 0o600 });
			renameSync(tmpPath, filePath);
			return { success: true };
		} catch (e: unknown) {
			logForDebugging(`[dpapi] update failed: ${e}`);
			return { success: false };
		}
	},
	delete(): boolean {
		try {
			unlinkSync(getDpapiFilePath());
			return true;
		} catch (e: unknown) {
			if (getErrnoCode(e) === "ENOENT") {
				return true;
			}
			logForDebugging(`[dpapi] delete failed: ${e}`);
			return false;
		}
	},
} satisfies SecureStorage;
