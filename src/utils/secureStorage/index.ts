import {
	isLibsecretEnabled,
	linuxLibsecretStorage,
} from "./linuxLibsecretStorage.js";
import { macOsKeychainStorage } from "./macOsKeychainStorage.js";
import { plainTextStorage } from "./plainTextStorage.js";
import type { SecureStorage, SecureStorageData } from "./types.js";
import { windowsDpapiStorage } from "./windowsDpapiStorage.js";

// P0-6 (audit R5): non-macOS encrypted credential storage.
// - macOS: keychain-only. Keychain failure throws (NO plaintext fallback) so a
//   failure is visible, not silently downgraded to unencrypted storage.
// - Linux: libsecret (Secret Service API) when FUSION_CODE_LIBSECRET_ENABLED=1
//   AND secret-tool is present; else plaintext (fail-open, never crashes —
//   libsecret absent on many headless images).
// - Windows: DPAPI (CurrentUser scope). Auto-enabled — DPAPI is always present.

// macOS keychain-only wrapper: throws on update() failure instead of falling
// back to plaintext. read()/delete() stay non-throwing (a missing entry is not
// a security failure). Callers (auth.ts) wrap update() in try/catch and
// surface the error as a warning, so the throw propagates to the user.
const macOsKeychainOnlyStorage: SecureStorage = {
	name: "keychain",
	read(): SecureStorageData | null {
		return macOsKeychainStorage.read();
	},
	async readAsync(): Promise<SecureStorageData | null> {
		return macOsKeychainStorage.readAsync();
	},
	update(data: SecureStorageData): { success: boolean; warning?: string } {
		const result = macOsKeychainStorage.update(data);
		if (!result.success) {
			throw new Error(
				"Security: failed to store credentials in macOS Keychain. " +
					"Resolve the Keychain issue (unlock keychain, grant access) and retry. " +
					"Credentials were NOT stored to avoid an unencrypted plaintext fallback.",
			);
		}
		return result;
	},
	delete(): boolean {
		return macOsKeychainStorage.delete();
	},
};

export function getSecureStorage(): SecureStorage {
	if (process.platform === "darwin") {
		return macOsKeychainOnlyStorage;
	}
	if (process.platform === "win32") {
		return windowsDpapiStorage;
	}
	// Linux + others
	if (isLibsecretEnabled()) {
		return linuxLibsecretStorage;
	}
	return plainTextStorage;
}
