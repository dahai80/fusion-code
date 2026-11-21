/**
 * Centralized utilities for parsing slash commands
 */

export type ParsedSlashCommand = {
	commandName: string;
	args: string;
	isMcp: boolean;
};

// Maximum number of leading stacked slash commands (aligned with CC 2.1.199 "max 5 leading skills")
export const MAX_STACKED_LEADING_COMMANDS = 5;

export type StackedSlashParse = {
	// Leading slash commands (including the terminal /cmd, if present); length 1 for a single command
	commands: ParsedSlashCommand[];
	// Trailing free-text after the leading commands (used as the last command's args), empty string if none
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
		commandName = `${commandName} (MCP)`;
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

// Valid command-name characters (consistent with processSlashCommand.tsx looksLikeCommand)
const COMMAND_NAME_RE = /^[a-zA-Z0-9:\-_]+$/;

// Determines whether a token is a stackable slash command (starts with /, name contains only valid chars)
function isStackableCommandToken(token: string): boolean {
	if (!token.startsWith("/")) return false;
	const name = token.slice(1);
	if (!name) return false;
	return COMMAND_NAME_RE.test(name);
}

// Parses stacked slash command input: consecutively extracts leading /cmd from the start, up to MAX_STACKED_LEADING_COMMANDS,
// stopping at the first token not starting with / (everything after becomes freeText).
// Backward compatible: single /cmd args behavior unchanged (commands length 1, freeText empty).
// When there are more than MAX_STACKED_LEADING_COMMANDS leading commands, the 6th onward merges into freeText (stacking rejected).
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

	// Consecutively extract leading /cmd (no args, command name only)
	while (i < words.length) {
		const word = words[i];
		if (word === undefined || !isStackableCommandToken(word)) {
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

	// All remaining tokens become freeText (first non-/ token, or the overflowing 6th+ command)
	freeTextWords = words.slice(i);
	const freeText = freeTextWords.join(" ").trim();

	return { commands, freeText };
}
