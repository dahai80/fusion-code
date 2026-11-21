/**
 * Bash command infinite-loop protection
 *
 * Intercepts cases where the same command is executed repeatedly within three
 * conversation rounds with completely identical output, raising a manual
 * intervention prompt to prevent small local models from getting stuck in a
 * command execution loop.
 */

/** History of recent commands (command → last output) */
const recentCommands: Array<{
	command: string;
	output: string;
	timestamp: number;
}> = [];
const MAX_HISTORY = 3;
const DUPLICATE_THRESHOLD = 3;

/** Records a command and checks whether it is stuck in a loop */
export function checkCommandLoop(
	command: string,
	output: string,
): { shouldBlock: boolean; reason?: string } {
	// Evict records older than 10 rounds
	const now = Date.now();
	while (
		recentCommands.length > 0 &&
		now - recentCommands[0].timestamp > 60000
	) {
		recentCommands.shift();
	}

	// Count occurrences of same command + same output
	const sameCommandSameOutput = recentCommands.filter(
		(entry) => entry.command === command && entry.output === output,
	);

	if (sameCommandSameOutput.length >= DUPLICATE_THRESHOLD) {
		return {
			shouldBlock: true,
			reason: `The local model appears to be stuck in a command execution loop: command "${command}" has produced identical output for ${sameCommandSameOutput.length} consecutive rounds. Manual intervention required.`,
		};
	}

	// Record this command
	recentCommands.push({ command, output, timestamp: now });
	if (recentCommands.length > MAX_HISTORY * 2) {
		recentCommands.shift();
	}

	return { shouldBlock: false };
}

/** Clears the history (called on a new conversation round or /clear) */
export function clearCommandLoopHistory(): void {
	recentCommands.length = 0;
}
