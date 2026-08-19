/**
 * 堆叠 slash-skill 解析测试 (WS2, issue #72, 对齐 CC 2.1.199)
 *
 * 测试目标:
 * - parseSlashCommand 单命令行为不变 (向后兼容)
 * - parseStackedSlashCommands 多前导返回列表, freeText 作终末 args
 * - 超 MAX_STACKED_LEADING_COMMANDS (5) 前导时第 6 个起并入 freeText
 * - 非命令首 token 返回 null / 单命令
 */
import { describe, expect, it } from "bun:test";
import {
	MAX_STACKED_LEADING_COMMANDS,
	parseSlashCommand,
	parseStackedSlashCommands,
} from "../../src/utils/slashCommandParsing.js";

describe("parseSlashCommand (向后兼容)", () => {
	it("单命令 + args", () => {
		const r = parseSlashCommand("/search foo bar");
		expect(r).not.toBeNull();
		expect(r!.commandName).toBe("search");
		expect(r!.args).toBe("foo bar");
		expect(r!.isMcp).toBe(false);
	});

	it("无 args", () => {
		const r = parseSlashCommand("/clear");
		expect(r).not.toBeNull();
		expect(r!.commandName).toBe("clear");
		expect(r!.args).toBe("");
	});

	it("MCP 命令", () => {
		const r = parseSlashCommand("/mcp:tool (MCP) arg1 arg2");
		expect(r).not.toBeNull();
		expect(r!.commandName).toBe("mcp:tool (MCP)");
		expect(r!.isMcp).toBe(true);
		expect(r!.args).toBe("arg1 arg2");
	});

	it("非 / 开头返回 null", () => {
		expect(parseSlashCommand("hello world")).toBeNull();
	});
});

describe("parseStackedSlashCommands", () => {
	it("单命令保持兼容: commands 长度 1, freeText 空", () => {
		const r = parseStackedSlashCommands("/search foo bar");
		expect(r).not.toBeNull();
		expect(r!.commands).toHaveLength(1);
		expect(r!.commands[0]!.commandName).toBe("search");
		// 单命令场景 args 仍走原 parseSlashCommand; 堆叠解析这里 freeText 为剩余
		expect(r!.freeText).toBe("foo bar");
	});

	it("两前导 + freeText", () => {
		const r = parseStackedSlashCommands("/skill-a /skill-b do XYZ");
		expect(r).not.toBeNull();
		expect(r!.commands).toHaveLength(2);
		expect(r!.commands[0]!.commandName).toBe("skill-a");
		expect(r!.commands[1]!.commandName).toBe("skill-b");
		expect(r!.freeText).toBe("do XYZ");
	});

	it("三前导无 freeText", () => {
		const r = parseStackedSlashCommands("/a /b /c");
		expect(r).not.toBeNull();
		expect(r!.commands).toHaveLength(3);
		expect(r!.commands.map((c) => c.commandName)).toEqual(["a", "b", "c"]);
		expect(r!.freeText).toBe("");
	});

	it("首个非 / token 起作 freeText (停止提取)", () => {
		const r = parseStackedSlashCommands("/skill-a do /skill-b");
		expect(r).not.toBeNull();
		expect(r!.commands).toHaveLength(1);
		expect(r!.commands[0]!.commandName).toBe("skill-a");
		// do /skill-b 全部作 freeText (不中途恢复提取)
		expect(r!.freeText).toBe("do /skill-b");
	});

	it("超 5 前导: 第 6 个起并入 freeText", () => {
		const input = "/a /b /c /d /e /f extra";
		const r = parseStackedSlashCommands(input);
		expect(r).not.toBeNull();
		expect(r!.commands).toHaveLength(MAX_STACKED_LEADING_COMMANDS);
		expect(r!.commands.map((c) => c.commandName)).toEqual([
			"a",
			"b",
			"c",
			"d",
			"e",
		]);
		expect(r!.freeText).toBe("/f extra");
	});

	it("恰好 5 前导 + freeText", () => {
		const r = parseStackedSlashCommands("/a /b /c /d /e do task");
		expect(r).not.toBeNull();
		expect(r!.commands).toHaveLength(5);
		expect(r!.freeText).toBe("do task");
	});

	it("非 / 开头返回 null", () => {
		expect(parseStackedSlashCommands("plain text")).toBeNull();
	});

	it("仅 / 无名返回 null", () => {
		expect(parseStackedSlashCommands("/")).toBeNull();
	});

	it("非法命令名字符 (路径) 不作命令 -> null", () => {
		// /var/tmp 为单 word, name='var/tmp' 含 / -> isStackableCommandToken 判否
		// 首个 word 即非命令, 无前导命令, 返回 null
		expect(parseStackedSlashCommands("/var/tmp foo")).toBeNull();
	});

	it("MCP 风格命令名 (含冒号) 可作前导", () => {
		const r = parseStackedSlashCommands("/mcp:tool /skill-b task");
		expect(r).not.toBeNull();
		expect(r!.commands).toHaveLength(2);
		expect(r!.commands[0]!.commandName).toBe("mcp:tool");
		expect(r!.commands[1]!.commandName).toBe("skill-b");
		expect(r!.freeText).toBe("task");
	});

	it("多个空格归一化", () => {
		const r = parseStackedSlashCommands("/a   /b    do   XYZ");
		expect(r).not.toBeNull();
		expect(r!.commands).toHaveLength(2);
		expect(r!.freeText).toBe("do XYZ");
	});
});
