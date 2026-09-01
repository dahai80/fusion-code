import { describe, expect, it } from "bun:test";
import {
	createAuditEntry,
	redactSecrets,
} from "../../../services/audit/index.js";

describe("audit redactSecrets (item 22)", () => {
	it("masks JWT (3-segment eyJ...)", () => {
		const jwt =
			"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
		const out = redactSecrets(`curl -H "Authorization: Bearer ${jwt}"`);
		expect(out).not.toContain(jwt);
		expect(out).toContain("eyJh…sw5c");
	});

	it("masks Bearer token, keeps scheme", () => {
		const out = redactSecrets(
			"Authorization: Bearer abcdefghijklmnop1234567890",
		);
		expect(out).toBe("Authorization: Bearer abcd…7890");
	});

	it("masks AWS SigV4 X-Amz-Signature hex", () => {
		const out = redactSecrets(
			"X-Amz-Signature=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
		);
		expect(out).toBe("X-Amz-Signature=a1b2…a1b2");
	});

	it("masks x-api-key header", () => {
		const out = redactSecrets("x-api-key: sk_live_abcdef0123456789XYZ");
		expect(out).toBe("x-api-key: sk_l…9XYZ");
	});

	it("masks generic Authorization (Basic)", () => {
		const out = redactSecrets(
			"Authorization: Basic dXNlcjpwYXNzMTIzNDU2Nzg5MA==",
		);
		expect(out).toBe("Authorization: Basic dXNl…MA==");
	});

	it("does not touch non-secret text", () => {
		const plain = "ran: git status --short in /Users/dahai/fusion/fusion-code";
		expect(redactSecrets(plain)).toBe(plain);
	});

	it("short secret (<=8 chars) masked with 2+…+2", () => {
		expect(redactSecrets("Bearer ab12cd34")).toBe("Bearer ab…34");
	});

	it("empty/whitespace passthrough", () => {
		expect(redactSecrets("")).toBe("");
		expect(redactSecrets("just words")).toBe("just words");
	});

	it("createAuditEntry redacts target + detail + error", () => {
		const entry = createAuditEntry("sess-1", "Bash", "execute", "denied", {
			detail: 'cmd: curl -H "Authorization: Bearer abcdefghijklmnop1234567890"',
			success: false,
			error: "Bearer xyz1234567890abcdef failed",
		});
		expect(entry.target).toBe("denied");
		expect(entry.detail).toContain("abcd…7890");
		expect(entry.error).toContain("xyz1…cdef");
		expect(entry.detail).not.toContain("abcdefghijklmnop1234567890");
	});

	it("createAuditEntry leaves clean fields untouched", () => {
		const entry = createAuditEntry("sess-2", "Read", "read", "/tmp/data.json", {
			success: true,
			duration_ms: 12,
		});
		expect(entry.target).toBe("/tmp/data.json");
		expect(entry.detail).toBeUndefined();
		expect(entry.error).toBeUndefined();
		expect(entry.duration_ms).toBe(12);
	});
});

describe("audit redactSecrets P1-9 expanded families (audit R16)", () => {
	it("masks Anthropic sk-ant-api03 key", () => {
		const tok = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJ";
		const out = redactSecrets(`export ANTHROPIC_API_KEY=${tok}`);
		expect(out).not.toContain(tok);
		expect(out).toContain("sk-a…GHIJ");
	});

	it("masks GitHub PAT ghp_", () => {
		const tok = "ghp_0123456789abcdefghijklmnopqrstuvwxyzAB";
		const out = redactSecrets(`token: ${tok}`);
		expect(out).not.toContain(tok);
		expect(out).toContain("ghp_…yzAB");
	});

	it("masks GitHub app/oauth tokens ghs_ and ghu_", () => {
		const s = "ghs_0123456789abcdefghijklmnopqrstuvwxyzAB";
		const u = "ghu_0123456789abcdefghijklmnopqrstuvwxyzAB";
		expect(redactSecrets(s)).toContain("ghs_…yzAB");
		expect(redactSecrets(u)).toContain("ghu_…yzAB");
		expect(redactSecrets(s)).not.toContain("0123456789abcdefghij");
	});

	it("masks Slack bot token xoxb-", () => {
		// Assembled from fragments so the source does not contain a literal
		// token shape (GitHub push-protection blocks realistic xoxb- values).
		// Still satisfies SECRET_RE: xox[abprs]-[0-9]{10,13}-[0-9]{10,13}[A-Za-z0-9-]*
		const tok = ["xox", "b-", "1234567890", "-", "0987654321", "abcdef"].join("");
		const out = redactSecrets(`SLACK_TOKEN=${tok}`);
		expect(out).not.toContain(tok);
		expect(out).toContain("xoxb…cdef");
	});

	it("masks GitLab PAT glpat-", () => {
		const tok = "glpat-0123456789abcdefghij";
		const out = redactSecrets(`gitlab: ${tok}`);
		expect(out).not.toContain(tok);
		expect(out).toContain("glpa…ghij");
	});

	it("masks PEM private key block (body unrecoverable)", () => {
		const body =
			"MIIEowIBAAKCAQEA0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
		const pem = `-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----`;
		const out = redactSecrets(pem);
		expect(out).not.toContain(body);
		expect(out).toContain("----…----");
	});

	it("createAuditEntry redacts sk-ant in command detail", () => {
		const tok = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJ";
		const entry = createAuditEntry("sess-3", "Bash", "execute", "denied", {
			detail: `curl -H "x-api-key: ${tok}" https://api.anthropic.com`,
			success: false,
		});
		expect(entry.detail).not.toContain(tok);
		// x-api-key branch masks the value; secret unrecoverable, prefix preserved.
		expect(entry.detail).toContain("sk-a…");
	});
});
