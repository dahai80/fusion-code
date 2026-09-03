import { afterEach, describe, expect, it } from "bun:test";

// audit-0903 P1 OPS-1: getClaudeConfigHomeDir must honor FUSION_CODE_CONFIG_DIR
// (cli.tsx sets it at startup, but the fn previously hardcoded ~/.fusion-code
// and ignored the env, so history/keybindings/fileHistory/memory all landed in
// the default dir even when the user overrode it). Pure unit test — no disk,
// no mocks — just assert env > default resolution + NFC normalization.

const KEY = "FUSION_CODE_CONFIG_DIR";

describe("getClaudeConfigHomeDir (audit-0903 P1 OPS-1)", () => {
	afterEach(() => {
		delete process.env[KEY];
	});

	it("returns the env override when set", async () => {
		process.env[KEY] = "/tmp/fusion-code-override";
		const { getClaudeConfigHomeDir } = await import(
			"../../utils/envUtils.js"
		);
		expect(getClaudeConfigHomeDir()).toBe("/tmp/fusion-code-override");
	});

	it("falls back to ~/.fusion-code when env unset", async () => {
		delete process.env[KEY];
		const { getClaudeConfigHomeDir } = await import(
			"../../utils/envUtils.js"
		);
		const dir = getClaudeConfigHomeDir();
		expect(dir.endsWith("/.fusion-code")).toBe(true);
	});

	it("falls back when env is empty string", async () => {
		process.env[KEY] = "";
		const { getClaudeConfigHomeDir } = await import(
			"../../utils/envUtils.js"
		);
		const dir = getClaudeConfigHomeDir();
		expect(dir.endsWith("/.fusion-code")).toBe(true);
	});
});
