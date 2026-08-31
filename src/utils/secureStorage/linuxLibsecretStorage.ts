import { createHash } from "node:crypto";
import { userInfo } from "node:os";
import { execaSync } from "execa";
import { logForDebugging } from "../debug.js";
import { getClaudeConfigHomeDir, isEnvTruthy } from "../envUtils.js";
import { getErrnoCode } from "../errors.js";
import { jsonParse, jsonStringify } from "../slowOperations.js";
import type { SecureStorage, SecureStorageData } from "./types.js";

// Secret Service API collection label prefix. Suffix derives from the config
// dir hash (mirrors macOS keychain service-name scheme) so multiple config dirs
// do not collide on a shared D-Bus session bus.
const LIBSECRET_LABEL_PREFIX = "Fusion-Code-credentials";

function getLibsecretLabel(): string {
	const configDir = getClaudeConfigHomeDir();
	const isDefaultDir = !process.env.CLAUDE_CONFIG_DIR;
	const dirHash = isDefaultDir
		? ""
		: `-${createHash("sha256").update(configDir).digest("hex").substring(0, 8)}`;
	return `${LIBSECRET_LABEL_PREFIX}${dirHash}`;
}

function getLibsecretAccount(): string {
	try {
		return process.env.USER || userInfo().username || "fusion-code-user";
	} catch {
		return "fusion-code-user";
	}
}

// libsecret (`secret-tool`) availability. Absent on many headless/minimal
// Linux images. Probed once per process — secret-tool --version is a fast
// no-op spawn (~5ms). Caching avoids a blocking subprocess per credential op.
let libsecretAvailableCache: boolean | undefined;

function isLibsecretAvailable(): boolean {
	if (libsecretAvailableCache !== undefined) {
		return libsecretAvailableCache;
	}
	try {
		const result = execaSync("secret-tool", ["--version"], {
			reject: false,
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 5000,
		});
		libsecretAvailableCache = result.exitCode === 0;
	} catch {
		libsecretAvailableCache = false;
	}
	return libsecretAvailableCache;
}

// Exported for tests to reset the probe cache between cases.
export function __resetLibsecretAvailabilityCache(): void {
	libsecretAvailableCache = undefined;
}

export const linuxLibsecretStorage = {
	name: "libsecret",
	read(): SecureStorageData | null {
		if (!isLibsecretAvailable()) {
			logForDebugging("[libsecret] secret-tool absent; read returns null");
			return null;
		}
		try {
			const label = getLibsecretLabel();
			const account = getLibsecretAccount();
			const result = execaSync(
				"secret-tool",
				["lookup", "application", label, "account", account],
				{ reject: false, stdio: ["ignore", "pipe", "pipe"], timeout: 10000 },
			);
			if (result.exitCode === 0 && result.stdout) {
				return jsonParse(result.stdout);
			}
		} catch (e: unknown) {
			logForDebugging(`[libsecret] read failed: ${e}`);
		}
		return null;
	},
	async readAsync(): Promise<SecureStorageData | null> {
		// Interface requires async mirror; delegate to sync (secret-tool is fast).
		return this.read();
	},
	update(data: SecureStorageData): { success: boolean; warning?: string } {
		if (!isLibsecretAvailable()) {
			return {
				success: false,
				warning:
					"libsecret (secret-tool) not found. Install gnome-keyring or seahorse for encrypted credential storage, or set FUSION_CODE_LIBSECRET_ENABLED=0 to use plaintext.",
			};
		}
		try {
			const label = getLibsecretLabel();
			const account = getLibsecretAccount();
			const payload = jsonStringify(data);
			// Clear any prior entry first (secret-tool store rejects duplicates on
			// some backends). Best-effort; ignore ENOENT-equivalent (exit 1).
			execaSync(
				"secret-tool",
				["clear", "application", label, "account", account],
				{ reject: false, stdio: ["ignore", "pipe", "pipe"], timeout: 10000 },
			);
			// Store via stdin to avoid leaking the payload in argv (process monitors).
			const result = execaSync(
				"secret-tool",
				["store", "--label", label, "application", label, "account", account],
				{
					input: payload,
					reject: false,
					stdio: ["pipe", "pipe", "pipe"],
					timeout: 10000,
				},
			);
			if (result.exitCode === 0) {
				return { success: true };
			}
			logForDebugging(
				`[libsecret] store failed (exit ${result.exitCode}): ${result.stderr}`,
			);
			return {
				success: false,
				warning: "Failed to store credentials via libsecret.",
			};
		} catch (e: unknown) {
			const code = getErrnoCode(e);
			logForDebugging(`[libsecret] update exception (${code}): ${e}`);
			return { success: false };
		}
	},
	delete(): boolean {
		if (!isLibsecretAvailable()) {
			return false;
		}
		try {
			const label = getLibsecretLabel();
			const account = getLibsecretAccount();
			const result = execaSync(
				"secret-tool",
				["clear", "application", label, "account", account],
				{ reject: false, stdio: ["ignore", "pipe", "pipe"], timeout: 10000 },
			);
			return result.exitCode === 0;
		} catch (e: unknown) {
			logForDebugging(`[libsecret] delete failed: ${e}`);
			return false;
		}
	},
} satisfies SecureStorage;

// Runtime gate: libsecret is used only when explicitly opted in AND available.
// Default-off mirrors P0-3 fail-closed semantics — enterprises explicitly
// enable FUSION_CODE_LIBSECRET_ENABLED=1 after confirming gnome-keyring /
// seahorse is deployed. Off (or libsecret absent) → caller falls back to
// plaintext (index.ts decides), never crashes.
export function isLibsecretEnabled(): boolean {
	return isEnvTruthy(process.env.FUSION_CODE_LIBSECRET_ENABLED);
}
