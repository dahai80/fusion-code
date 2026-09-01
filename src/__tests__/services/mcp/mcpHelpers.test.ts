import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
	expandEnvVarsInString,
	getServerKey,
	hashMcpConfig,
	issuerKey,
	normalizeNameForMCP,
} from "../../../services/mcp/index.js";

// P1-8 (audit R15): service-layer unit tests — MCP pure helpers. None of the
// five modules execute side effects at load (verified: lazy settings() closures,
// const-only top level), so direct import with no mock.module.

describe("MCP getServerKey (audit P1-8)", () => {
	it("produces <name>|<16 hex> deterministically", () => {
		const key = getServerKey("myserver", {
			type: "http",
			url: "https://example.com/mcp",
			headers: {},
		});
		expect(key.startsWith("myserver|")).toBe(true);
		const hash = key.split("|")[1];
		expect(hash.length).toBe(16);
		expect(/^[0-9a-f]{16}$/.test(hash)).toBe(true);
	});

	it("same config → same key; headers undefined vs {} collide", () => {
		const a = getServerKey("s", { type: "http", url: "https://x" } as any);
		const b = getServerKey("s", {
			type: "http",
			url: "https://x",
			headers: {},
		});
		expect(a).toBe(b);
	});

	it("different url → different key", () => {
		const a = getServerKey("s", { type: "http", url: "https://x" } as any);
		const c = getServerKey("s", { type: "http", url: "https://y" } as any);
		expect(a).not.toBe(c);
	});

	it("matches independent sha256-truncate computation", () => {
		const cfg = {
			type: "sse" as const,
			url: "https://u/p",
			headers: { k: "v" },
		};
		const expected =
			"srv|" +
			createHash("sha256")
				.update(
					JSON.stringify({
						type: cfg.type,
						url: cfg.url,
						headers: cfg.headers,
					}),
				)
				.digest("hex")
				.substring(0, 16);
		expect(getServerKey("srv", cfg)).toBe(expected);
	});
});

describe("MCP normalizeNameForMCP (audit P1-8)", () => {
	it("replaces non [a-zA-Z0-9_-] with _", () => {
		expect(normalizeNameForMCP("my.server")).toBe("my_server");
		expect(normalizeNameForMCP("a b")).toBe("a_b");
		expect(normalizeNameForMCP("a/b")).toBe("a_b");
	});

	it("passes valid names through", () => {
		expect(normalizeNameForMCP("valid_name-1")).toBe("valid_name-1");
	});

	it("collapses + trims underscores for claude.ai prefix", () => {
		const out = normalizeNameForMCP("claude.ai my..server");
		expect(out).not.toContain("__");
		expect(out.startsWith("_")).toBe(false);
		expect(out.endsWith("_")).toBe(false);
	});
});

describe("MCP expandEnvVarsInString (audit P1-8)", () => {
	const stash: Record<string, string | undefined> = {};
	beforeEach(() => {
		stash.MCP_TEST_SET = process.env.MCP_TEST_SET;
		stash.MCP_TEST_UNSET = process.env.MCP_TEST_UNSET;
		process.env.MCP_TEST_SET = "value123";
		delete process.env.MCP_TEST_UNSET;
	});
	afterEach(() => {
		if (stash.MCP_TEST_SET === undefined) delete process.env.MCP_TEST_SET;
		else process.env.MCP_TEST_SET = stash.MCP_TEST_SET;
		if (stash.MCP_TEST_UNSET === undefined) delete process.env.MCP_TEST_UNSET;
		else process.env.MCP_TEST_UNSET = stash.MCP_TEST_UNSET;
	});

	it("expands ${VAR} from env", () => {
		expect(expandEnvVarsInString("v=${MCP_TEST_SET}").expanded).toBe(
			"v=value123",
		);
	});

	it("uses ${VAR:-default} when unset", () => {
		expect(
			expandEnvVarsInString("v=${MCP_TEST_UNSET:-fallback}").expanded,
		).toBe("v=fallback");
	});

	it("tracks missing vars and leaves token", () => {
		const r = expandEnvVarsInString("v=${MCP_TEST_UNSET}");
		expect(r.expanded).toBe("v=${MCP_TEST_UNSET}");
		expect(r.missingVars).toContain("MCP_TEST_UNSET");
	});

	it("accumulates multiple missing vars in order", () => {
		const r = expandEnvVarsInString("${A}${B}");
		expect(r.missingVars).toEqual(["A", "B"]);
	});
});

describe("MCP hashMcpConfig (audit P1-8)", () => {
	it("produces 16 hex chars", () => {
		const h = hashMcpConfig({
			scope: "user",
			type: "http",
			url: "https://x",
			headers: {},
		} as any);
		expect(h.length).toBe(16);
		expect(/^[0-9a-f]{16}$/.test(h)).toBe(true);
	});

	it("strips scope — same config under different scopes → same hash", () => {
		const base = { type: "http", url: "https://x", headers: {} } as any;
		expect(hashMcpConfig({ scope: "user", ...base })).toBe(
			hashMcpConfig({ scope: "project", ...base }),
		);
	});

	it("key-order independent", () => {
		const a = {
			scope: "user",
			type: "http",
			url: "https://x",
			headers: { k: "v", j: "w" },
		} as any;
		const b = {
			scope: "user",
			type: "http",
			url: "https://x",
			headers: { j: "w", k: "v" },
		} as any;
		expect(hashMcpConfig(a)).toBe(hashMcpConfig(b));
	});

	it("different url → different hash", () => {
		const a = {
			scope: "user",
			type: "http",
			url: "https://x",
			headers: {},
		} as any;
		const c = {
			scope: "user",
			type: "http",
			url: "https://y",
			headers: {},
		} as any;
		expect(hashMcpConfig(a)).not.toBe(hashMcpConfig(c));
	});
});

describe("MCP issuerKey (audit P1-8)", () => {
	it("lowercases host and strips trailing slashes", () => {
		expect(issuerKey("https://Example.com/auth/")).toBe(
			"https://example.com/auth",
		);
		expect(issuerKey("https://x.com/a//")).toBe("https://x.com/a");
	});

	it("idempotent", () => {
		const v = issuerKey("https://Example.com/auth/");
		expect(issuerKey(v)).toBe(v);
	});

	it("fallback strips trailing slashes on non-URL", () => {
		expect(issuerKey("not-a-url/")).toBe("not-a-url");
	});
});
