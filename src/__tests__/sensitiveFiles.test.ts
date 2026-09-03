import { describe, expect, it } from "bun:test";
import {
	extractCandidatePathsFromCommand,
	isSensitiveFilePath,
} from "../utils/sensitiveFiles.js";

describe("isSensitiveFilePath", () => {
	it("blocks .env files", () => {
		expect(isSensitiveFilePath("/project/.env")).toBe(true);
		expect(isSensitiveFilePath("/project/.env.production")).toBe(true);
		expect(isSensitiveFilePath("/project/.env.local")).toBe(true);
	});

	it("blocks SSH keys", () => {
		expect(isSensitiveFilePath("/home/user/.ssh/id_rsa")).toBe(true);
		expect(isSensitiveFilePath("/home/user/.ssh/id_ed25519")).toBe(true);
		expect(isSensitiveFilePath("/home/user/.ssh/config")).toBe(true);
	});

	it("blocks .ssh directory contents", () => {
		expect(isSensitiveFilePath("/home/user/.ssh/known_hosts")).toBe(true);
	});

	it("blocks certificate/key files", () => {
		expect(isSensitiveFilePath("/server/cert.pem")).toBe(true);
		expect(isSensitiveFilePath("/server/cert.key")).toBe(true);
		expect(isSensitiveFilePath("/server/cert.p12")).toBe(true);
		expect(isSensitiveFilePath("/server/cert.pfx")).toBe(true);
	});

	it("blocks sensitive directories themselves", () => {
		expect(isSensitiveFilePath("/home/user/.gnupg")).toBe(true);
		expect(isSensitiveFilePath("/home/user/.ssh")).toBe(true);
		expect(isSensitiveFilePath("/home/user/.aws")).toBe(true);
		expect(isSensitiveFilePath("/home/user/.kube")).toBe(true);
	});

	it("blocks AWS credentials", () => {
		expect(isSensitiveFilePath("/home/user/.aws/credentials")).toBe(true);
		expect(isSensitiveFilePath("/home/user/.aws/config")).toBe(true);
	});

	it("blocks npmrc and pypirc files", () => {
		expect(isSensitiveFilePath("/home/user/.npmrc")).toBe(true);
		expect(isSensitiveFilePath("/home/user/.pypirc")).toBe(true);
	});

	it("blocks gitconfig", () => {
		expect(isSensitiveFilePath("/home/user/.gitconfig")).toBe(true);
	});

	it("blocks API server auth token (server.token)", () => {
		// P0-1 (audit R1): ~/.fusion-code/server.token = API server 认证 token, AI 读即本地 RCE 面
		expect(isSensitiveFilePath("/home/user/.fusion-code/server.token")).toBe(
			true,
		);
		expect(isSensitiveFilePath("server.token")).toBe(true);
		// 非同名 token 文件不被误伤
		expect(isSensitiveFilePath("/project/src/serverToken.ts")).toBe(false);
	});

	it("blocks direnv .envrc (audit-0902 P1-2)", () => {
		// .envrc = .env+rc (no dot after .env) → slipped past `\.env\.` regex.
		// Holds shell-injected secrets loaded by direnv on cd.
		expect(isSensitiveFilePath("/project/.envrc")).toBe(true);
		expect(isSensitiveFilePath(".envrc")).toBe(true);
		expect(isSensitiveFilePath("/home/user/.config/direnv/.envrc")).toBe(true);
		// Non-sensitive envrc-prefixed source file not over-blocked.
		expect(isSensitiveFilePath("/project/src/envrcHelper.ts")).toBe(false);
	});

	it("blocks additional credential files (audit-0903 P2 SEC-3)", () => {
		// 6 categories slipped past the prior pattern list, each holds plaintext
		// creds readable by a single `cat`.
		expect(isSensitiveFilePath("/home/user/.pgpass")).toBe(true);
		expect(isSensitiveFilePath("/home/user/.my.cnf")).toBe(true);
		expect(isSensitiveFilePath("/etc/apache/.htpasswd")).toBe(true);
		expect(isSensitiveFilePath("/project/.secret")).toBe(true);
		expect(isSensitiveFilePath("/project/.token")).toBe(true);
		expect(isSensitiveFilePath("/etc/dovecot/.passwd")).toBe(true);
		// Non-secret namesakes not over-blocked.
		expect(isSensitiveFilePath("/project/src/myToken.ts")).toBe(false);
		expect(isSensitiveFilePath("/project/passwd-helpers.txt")).toBe(false);
	});

	it("allows non-sensitive paths", () => {
		expect(isSensitiveFilePath("/project/src/index.ts")).toBe(false);
		expect(isSensitiveFilePath("/project/package.json")).toBe(false);
		expect(isSensitiveFilePath("/project/README.md")).toBe(false);
	});

	it("handles bare filenames", () => {
		expect(isSensitiveFilePath(".env")).toBe(true);
		expect(isSensitiveFilePath("id_rsa")).toBe(true);
	});
});

describe("extractCandidatePathsFromCommand", () => {
	it("extracts plain sensitive paths", () => {
		expect(extractCandidatePathsFromCommand("cat ~/.env")).toContain("~/.env");
		expect(
			extractCandidatePathsFromCommand("grep foo ~/.ssh/id_rsa"),
		).toContain("~/.ssh/id_rsa");
	});

	it("strips a dangling trailing quote (bash -c 'cat ~/.env')", () => {
		// P0-1 (audit 0901): trailing-quote bypass. The old splitter left
		// `~/.env'` which regex `\.env$` failed to match → secret leaked.
		const cands = extractCandidatePathsFromCommand("bash -c 'cat ~/.env'");
		expect(cands).toContain("~/.env");
	});

	it("strips a dangling leading quote", () => {
		const cands = extractCandidatePathsFromCommand("cat '~/.env");
		expect(cands).toContain("~/.env");
	});

	it("recurses into bash -c script bodies", () => {
		const cands = extractCandidatePathsFromCommand(
			"bash -c 'cat ~/.ssh/id_rsa'",
		);
		expect(cands).toContain("~/.ssh/id_rsa");
	});

	it("recurses into nested -c scripts", () => {
		const cands = extractCandidatePathsFromCommand(
			"bash -c 'sh -c \"cat ~/.env\"'",
		);
		expect(cands).toContain("~/.env");
	});

	it("recurses into sh -c with double-quoted script", () => {
		const cands = extractCandidatePathsFromCommand(
			'sh -c "grep x ~/.npmrc"',
		);
		expect(cands).toContain("~/.npmrc");
	});

	it("extracts server.token from bash -c", () => {
		const cands = extractCandidatePathsFromCommand(
			"bash -c 'cat ~/.fusion-code/server.token'",
		);
		expect(cands).toContain("~/.fusion-code/server.token");
	});

	it("extracts .envrc from a bash command (audit-0902 P1-2)", () => {
		// SENSITIVE_BASENAMES missed .envrc → `cat ~/.envrc` reached direnv secrets.
		expect(
			extractCandidatePathsFromCommand("cat ~/.envrc"),
		).toContain("~/.envrc");
	});

	it("does not false-positive on flags", () => {
		const cands = extractCandidatePathsFromCommand("ls -la /project/src");
		expect(cands).not.toContain("-la");
	});

	it("returns empty for non-sensitive commands", () => {
		const cands = extractCandidatePathsFromCommand("echo hello world");
		expect(cands).toEqual([]);
	});
});
