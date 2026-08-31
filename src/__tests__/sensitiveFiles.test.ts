import { describe, expect, it } from "bun:test";
import { isSensitiveFilePath } from "../utils/sensitiveFiles.js";

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
		expect(isSensitiveFilePath("/home/user/.fusion-code/server.token")).toBe(true);
		expect(isSensitiveFilePath("server.token")).toBe(true);
		// 非同名 token 文件不被误伤
		expect(isSensitiveFilePath("/project/src/serverToken.ts")).toBe(false);
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
