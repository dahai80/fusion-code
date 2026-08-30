// audit 1.3.2: 企业 MCP 配置 mtime-aware 缓存单测
// 旧实现 lodash memoize 永久缓存, 配置变更永不感知。新实现按 mtime 失效。

import { describe, expect, test } from "bun:test";
import { shouldRefreshEnterpriseMcpCache } from "../../services/mcp/index.js";

describe("shouldRefreshEnterpriseMcpCache (audit 1.3.2)", () => {
	test("首查 (cachedResult=null) → 刷新", () => {
		expect(shouldRefreshEnterpriseMcpCache(1000, -1, null)).toBe(true);
	});
	test("mtime 不变 + 已缓存 → 跳过", () => {
		expect(shouldRefreshEnterpriseMcpCache(1000, 1000, false)).toBe(false);
		expect(shouldRefreshEnterpriseMcpCache(1000, 1000, true)).toBe(false);
	});
	test("mtime 变化 → 刷新", () => {
		expect(shouldRefreshEnterpriseMcpCache(2000, 1000, true)).toBe(true);
		expect(shouldRefreshEnterpriseMcpCache(999, 1000, false)).toBe(true);
	});
	test("文件删除 (mtime 0) + 此前存在 → 刷新", () => {
		expect(shouldRefreshEnterpriseMcpCache(0, 1000, true)).toBe(true);
	});
	test("文件删除 (mtime 0) + 此前不存在 (mtime 0) → 跳过", () => {
		expect(shouldRefreshEnterpriseMcpCache(0, 0, false)).toBe(false);
	});
});
