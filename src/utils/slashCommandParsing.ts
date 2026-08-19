/**
 * Centralized utilities for parsing slash commands
 */

export type ParsedSlashCommand = {
	commandName: string;
	args: string;
	isMcp: boolean;
};

// 最大前导堆叠 slash 命令数 (对齐 CC 2.1.199 "最多 5 前导技能")
export const MAX_STACKED_LEADING_COMMANDS = 5;

export type StackedSlashParse = {
	// 前导 slash 命令 (含 terminal /cmd, 若存在); 单命令时长度 1
	commands: ParsedSlashCommand[];
	// 前导命令之后的终末 free-text (作最后一条命令的 args), 无则为空串
	freeText: string;
};

/**
 * Parses a slash command input string into its component parts
 *
 * @param input - The raw input string (should start with '/')
 * @returns Parsed command name, args, and MCP flag, or null if invalid
 *
 * @example
 * parseSlashCommand('/search foo bar')
 * // => { commandName: 'search', args: 'foo bar', isMcp: false }
 *
 * @example
 * parseSlashCommand('/mcp:tool (MCP) arg1 arg2')
 * // => { commandName: 'mcp:tool (MCP)', args: 'arg1 arg2', isMcp: true }
 */
export function parseSlashCommand(input: string): ParsedSlashCommand | null {
	const trimmedInput = input.trim();

	// Check if input starts with '/'
	if (!trimmedInput.startsWith("/")) {
		return null;
	}

	// Remove the leading '/' and split by spaces
	const withoutSlash = trimmedInput.slice(1);
	const words = withoutSlash.split(" ");

	if (!words[0]) {
		return null;
	}

	let commandName = words[0];
	let isMcp = false;
	let argsStartIndex = 1;

	// Check for MCP commands (second word is '(MCP)')
	if (words.length > 1 && words[1] === "(MCP)") {
		commandName = commandName + " (MCP)";
		isMcp = true;
		argsStartIndex = 2;
	}

	// Extract arguments (everything after command name)
	const args = words.slice(argsStartIndex).join(" ");

	return {
		commandName,
		args,
		isMcp,
	};
}

// 命令名合法字符 (与 processSlashCommand.tsx looksLikeCommand 一致)
const COMMAND_NAME_RE = /^[a-zA-Z0-9:\-_]+$/;

// 判断 token 是否为可堆叠的 slash 命令 (以 / 开头, 名字仅含合法字符)
function isStackableCommandToken(token: string): boolean {
	if (!token.startsWith("/")) return false;
	const name = token.slice(1);
	if (!name) return false;
	return COMMAND_NAME_RE.test(name);
}

// 解析堆叠 slash 命令输入: 从开头连续提取 leading /cmd, 最多 MAX_STACKED_LEADING_COMMANDS,
// 遇到首个非 / 起始 token 停止 (之后全部作 freeText)。
// 向后兼容: 单 /cmd args 行为不变 (commands 长度 1, freeText 为空)。
// 超过 MAX_STACKED_LEADING_COMMANDS 个前导命令时, 第 6 个起并入 freeText (拒绝堆叠)。
//
// @example
// parseStackedSlashCommands('/skill-a /skill-b do XYZ')
// // => { commands: [{commandName:'skill-a',...},{commandName:'skill-b',...}], freeText:'do XYZ' }
//
// @example
// parseStackedSlashCommands('/search foo bar')
// // => { commands: [{commandName:'search',args:'foo bar',isMcp:false}], freeText:'' }
export function parseStackedSlashCommands(
	input: string,
): StackedSlashParse | null {
	const trimmedInput = input.trim();
	if (!trimmedInput.startsWith("/")) {
		return null;
	}

	const words = trimmedInput.split(/\s+/);
	const commands: ParsedSlashCommand[] = [];
	let freeTextWords: string[] = [];
	let i = 0;

	// 连续提取前导 /cmd (无 args, 仅命令名)
	while (i < words.length) {
		const word = words[i]!;
		if (!isStackableCommandToken(word)) {
			break;
		}
		if (commands.length >= MAX_STACKED_LEADING_COMMANDS) {
			break;
		}
		const commandName = word.slice(1);
		commands.push({ commandName, args: "", isMcp: false });
		i++;
	}

	if (commands.length === 0) {
		return null;
	}

	// 剩余全部作 freeText (首个非 / token 或超限的第 6+ 命令)
	freeTextWords = words.slice(i);
	const freeText = freeTextWords.join(" ").trim();

	return { commands, freeText };
}
