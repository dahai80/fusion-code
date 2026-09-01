import { describe, expect, it } from "bun:test";
import { BashTool } from "../../../tools/BashTool/BashTool.js";

// P1-9 (audit R16): BashTool.mapToolResultToToolResultBlockParam must scrub
// embedded secrets from stdout + stderr before the tool result reaches the
// model. Redaction families + maskMiddle shared with auditLog.redactSecrets
// (single source of truth). Verifies the hook landed and survives build.
describe("BashTool result redaction (P1-9 audit R16)", () => {
	const map = (
		out: Partial<
			Parameters<typeof BashTool.mapToolResultToToolResultBlockParam>[0]
		>,
	) =>
		BashTool.mapToolResultToToolResultBlockParam(
			{
				interrupted: false,
				stdout: "",
				stderr: "",
				isImage: false,
				backgroundTaskId: undefined,
				backgroundedByUser: false,
				assistantAutoBackgrounded: false,
				structuredContent: undefined,
				persistedOutputPath: undefined,
				persistedOutputSize: 0,
				...out,
			},
			"test-tool-use-id",
		);

	it("scrubs Anthropic sk-ant key from stdout", () => {
		const tok = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJ";
		const result = map({ stdout: `ran: export KEY=${tok}` });
		const content = result.content as string;
		expect(content).not.toContain(tok);
		expect(content).toContain("sk-a…");
	});

	it("scrubs GitHub ghp_ token from stdout", () => {
		const tok = "ghp_0123456789abcdefghijklmnopqrstuvwxyzAB";
		const result = map({ stdout: `push: token ${tok}` });
		expect(result.content as string).not.toContain(tok);
	});

	it("scrubs PEM private key from stdout", () => {
		const body =
			"MIIEowIBAAKCAQEA0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
		const pem = `-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----`;
		const result = map({ stdout: pem });
		const content = result.content as string;
		expect(content).not.toContain(body);
		expect(content).toContain("----…----");
	});

	it("scrubs secrets from stderr too", () => {
		const tok = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJ";
		const result = map({
			stdout: "",
			stderr: `error: auth failed for ${tok}`,
		});
		expect(result.content as string).not.toContain(tok);
	});

	it("preserves non-secret stdout unchanged", () => {
		const plain = "main\nfeature/branch-1\n  origin/main";
		const result = map({ stdout: plain });
		expect(result.content as string).toContain("feature/branch-1");
		expect(result.content as string).not.toContain("…");
	});

	it("scrubs both stdout and stderr in joined content", () => {
		const out = "ghp_0123456789abcdefghijklmnopqrstuvwxyzAB";
		const err = "glpat-0123456789abcdefghij";
		const result = map({ stdout: `o:${out}`, stderr: `e:${err}` });
		const content = result.content as string;
		expect(content).not.toContain(out);
		expect(content).not.toContain(err);
	});
});
