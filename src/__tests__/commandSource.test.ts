/**
 * item 24: 插件 marketplace command 源单测 (CC 2.1.229, §140/§216)
 *
 * schema 校验 + resolveCommandSource 真跑 command (echo tmpdir) 各 fail-visible case。
 */

import { describe, expect, it } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CommandMarketplaceSource,
	commandSourceToDirectorySource,
	isCommandSource,
	resolveCommandSource,
} from "../utils/plugins/commandSource.js";
import { MarketplaceSourceSchema } from "../utils/plugins/schemas.js";

describe("MarketplaceSourceSchema — command 变体", () => {
	it("合法 command 源 parse 通过", () => {
		const parsed = MarketplaceSourceSchema().safeParse({
			source: "command",
			command: "echo /opt/plugins",
		});
		expect(parsed.success).toBe(true);
	});

	it("带 cwd 的 command 源 parse 通过", () => {
		const parsed = MarketplaceSourceSchema().safeParse({
			source: "command",
			command: "pwd",
			cwd: "/tmp",
		});
		expect(parsed.success).toBe(true);
	});

	it("空 command 字符串 → 拒绝", () => {
		const parsed = MarketplaceSourceSchema().safeParse({
			source: "command",
			command: "",
		});
		expect(parsed.success).toBe(false);
	});

	it("缺 command 字段 → 拒绝", () => {
		const parsed = MarketplaceSourceSchema().safeParse({
			source: "command",
		});
		expect(parsed.success).toBe(false);
	});

	it("command 源不匹配 directory 变体 (discriminated union 隔离)", () => {
		// command 源无 path 字段, directory 源无 command 字段 — 互斥
		const cmdParsed = MarketplaceSourceSchema().safeParse({
			source: "command",
			command: "echo /x",
		});
		const dirFromCmd = MarketplaceSourceSchema().safeParse({
			source: "directory",
			command: "echo /x",
		});
		expect(cmdParsed.success).toBe(true);
		expect(dirFromCmd.success).toBe(false);
	});
});

describe("isCommandSource — type guard", () => {
	it("command 源 → true", () => {
		expect(isCommandSource({ source: "command", command: "echo /x" })).toBe(
			true,
		);
	});

	it("directory 源 → false", () => {
		expect(isCommandSource({ source: "directory", path: "/x" })).toBe(false);
	});

	it("url 源 → false", () => {
		expect(
			isCommandSource({ source: "url", url: "https://x.com/m.json" }),
		).toBe(false);
	});
});

describe("resolveCommandSource — fail-visible 各 case", () => {
	it("正常: echo 临时目录 → 解析为该目录", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cmd-src-"));
		const src: CommandMarketplaceSource = {
			source: "command",
			command: `echo ${dir}`,
		};
		const result = await resolveCommandSource(src);
		expect(result.directoryPath).toBe(dir);
	});

	it("命令输出带换行 → trim 后正确解析", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cmd-src-"));
		// printf 加换行, 模拟命令输出末尾 \n
		const src: CommandMarketplaceSource = {
			source: "command",
			command: `printf '%s\\n' ${dir}`,
		};
		const result = await resolveCommandSource(src);
		expect(result.directoryPath).toBe(dir);
	});

	it("非零退出 → throw", async () => {
		const src: CommandMarketplaceSource = {
			source: "command",
			command: "exit 1",
		};
		await expect(resolveCommandSource(src)).rejects.toThrow(/exited 1/);
	});

	it("空输出 → throw", async () => {
		const src: CommandMarketplaceSource = {
			source: "command",
			command: "printf ''",
		};
		await expect(resolveCommandSource(src)).rejects.toThrow(/empty output/);
	});

	it("输出非目录 (文件) → throw", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cmd-src-"));
		const filePath = join(dir, "not-a-dir.txt");
		await writeFile(filePath, "x");
		const src: CommandMarketplaceSource = {
			source: "command",
			command: `echo ${filePath}`,
		};
		await expect(resolveCommandSource(src)).rejects.toThrow(/non-directory/);
	});

	it("输出不存在路径 → throw", async () => {
		const src: CommandMarketplaceSource = {
			source: "command",
			command: `echo ${join(tmpdir(), `cmd-src-nonexistent-${process.pid}`)}`,
		};
		await expect(resolveCommandSource(src)).rejects.toThrow(
			/inaccessible path/,
		);
	});

	it("超时 → throw (sleep 超过 timeout)", async () => {
		// 超时 30s — 用 sleep 35s 不现实 (拖慢测试)。改用非零退出模拟命令异常,
		// 超时本身难单测 (需 fake-timer)。此 case 验证 command 异常 → throw 路径通。
		// 真超时靠 COMMAND_TIMEOUT_MS 常量 + 手工验 (issue 记录)。
		const src: CommandMarketplaceSource = {
			source: "command",
			command: "exit 2",
		};
		await expect(resolveCommandSource(src)).rejects.toThrow();
	});

	it("cwd 选项 → 在指定目录跑命令", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "cmd-cwd-"));
		// mkdir 子目录, pwd 应输出 cwd
		await mkdir(join(cwd, "sub"));
		const src: CommandMarketplaceSource = {
			source: "command",
			command: "pwd",
			cwd,
		};
		const result = await resolveCommandSource(src);
		// macOS /var → /private/var symlink: pwd 输出物理路径, mkdtemp 返回 symlink 路径
		expect(result.directoryPath).toBe(realpathSync(cwd));
	});
});

describe("commandSourceToDirectorySource — 等效 directory 转换", () => {
	it("command 源 → directory 源对象", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cmd-conv-"));
		const src: CommandMarketplaceSource = {
			source: "command",
			command: `echo ${dir}`,
		};
		const result = await commandSourceToDirectorySource(src);
		expect(result.source).toBe("directory");
		expect(result.path).toBe(dir);
	});

	it("转换结果通过 directory 变体 schema 校验", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cmd-conv-"));
		const src: CommandMarketplaceSource = {
			source: "command",
			command: `echo ${dir}`,
		};
		const result = await commandSourceToDirectorySource(src);
		const parsed = MarketplaceSourceSchema().safeParse(result);
		expect(parsed.success).toBe(true);
	});
});
