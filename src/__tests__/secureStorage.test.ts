import { afterEach, describe, expect, it, mock } from "bun:test";

// P0-6 (audit R5): non-macOS encrypted credential storage.
// Verifies platform dispatch + macOS throw-on-fail (no plaintext fallback)
// with a MOCKED keychain — no real security/secret-tool/powershell spawns.
// The libsecret availability probe cache is reset between cases.

const ORIGINAL_PLATFORM = process.platform;

function setPlatform(platform: string): void {
	Object.defineProperty(process, "platform", { value: platform });
}

function restorePlatform(): void {
	Object.defineProperty(process, "platform", { value: ORIGINAL_PLATFORM });
}

// Stub the macOS keychain backend so the darwin wrapper's throw-on-fail path
// is deterministic (a real dev-host keychain write succeeds, masking the
// throw contract). Registered before any require() of index.js so the live
// binding resolves to the stub. update() returns success:false to model a
// locked/unavailable keychain; the wrapper must throw, not fall back.
mock.module("../utils/secureStorage/macOsKeychainStorage.js", () => ({
	macOsKeychainStorage: {
		name: "keychain",
		read: () => null,
		readAsync: async () => null,
		update: () => ({ success: false }),
		delete: () => true,
	},
}));

describe("secureStorage platform dispatch (P0-6)", () => {
	afterEach(() => {
		restorePlatform();
		delete process.env.FUSION_CODE_LIBSECRET_ENABLED;
		try {
			const mod =
				require("../utils/secureStorage/linuxLibsecretStorage.js") as {
					__resetLibsecretAvailabilityCache: () => void;
				};
			mod.__resetLibsecretAvailabilityCache();
		} catch {
			// module load failure is itself a test signal
		}
	});

	it("macOS selects keychain (no plaintext fallback name)", () => {
		setPlatform("darwin");
		const { getSecureStorage } = require("../utils/secureStorage/index.js");
		const storage = getSecureStorage();
		expect(storage.name).toBe("keychain");
		expect(storage.name).not.toContain("fallback");
		expect(storage.name).not.toContain("plaintext");
	});

	it("macOS update() throws on keychain failure (no silent plaintext downgrade)", () => {
		setPlatform("darwin");
		const { getSecureStorage } = require("../utils/secureStorage/index.js");
		const storage = getSecureStorage();
		// Stubbed keychain update() returns success:false → wrapper must throw,
		// NOT silently fall back to plaintext storage.
		expect(() => storage.update({} as never)).toThrow(/Keychain/);
		expect(() => storage.update({} as never)).toThrow(
			/NOT stored to avoid an unencrypted plaintext fallback/,
		);
	});

	it("macOS read()/delete() stay non-throwing (missing entry ≠ security failure)", () => {
		setPlatform("darwin");
		const { getSecureStorage } = require("../utils/secureStorage/index.js");
		const storage = getSecureStorage();
		expect(storage.read()).toBeNull();
		expect(storage.delete()).toBe(true);
	});

	it("Linux without FUSION_CODE_LIBSECRET_ENABLED selects plaintext", () => {
		setPlatform("linux");
		delete process.env.FUSION_CODE_LIBSECRET_ENABLED;
		const { getSecureStorage } = require("../utils/secureStorage/index.js");
		const storage = getSecureStorage();
		expect(storage.name).toBe("plaintext");
	});

	it("Linux with FUSION_CODE_LIBSECRET_ENABLED selects libsecret", () => {
		setPlatform("linux");
		process.env.FUSION_CODE_LIBSECRET_ENABLED = "1";
		const { getSecureStorage } = require("../utils/secureStorage/index.js");
		const storage = getSecureStorage();
		expect(storage.name).toBe("libsecret");
	});

	it("Windows selects DPAPI", () => {
		setPlatform("win32");
		const { getSecureStorage } = require("../utils/secureStorage/index.js");
		const storage = getSecureStorage();
		expect(storage.name).toBe("dpapi");
	});

	it("libsecret read returns null when secret-tool absent (fail-open, no crash)", () => {
		// secret-tool is absent in CI → isLibsecretAvailable() caches false.
		const {
			linuxLibsecretStorage,
		} = require("../utils/secureStorage/linuxLibsecretStorage.js");
		const result = linuxLibsecretStorage.read();
		expect(result).toBeNull();
		// update() must return success:false with a warning, not throw.
		const updateResult = linuxLibsecretStorage.update({} as never);
		expect(updateResult.success).toBe(false);
		expect(updateResult.warning).toBeDefined();
	});
});
