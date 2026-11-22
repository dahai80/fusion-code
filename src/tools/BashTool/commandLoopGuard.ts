/**
 * Bash command infinite-loop protection
 *
 * Records each completed command's real output and exit code, and blocks when
 * the same command has produced completely identical output for N consecutive
 * completed runs. When the repeats exited 0 (the command already succeeded,
 * e.g. a passing test suite), the block message tells the model to use the
 * earlier result instead of re-running — plain loop otherwise.
 */

/** History of recently completed commands (command → last output) */
const recentCommands: Array<{
	command: string;
	output: string;
	timestamp: number;
}> = [];
const MAX_HISTORY = 3;
const DUPLICATE_THRESHOLD = 3;

/**
 * Records a completed command result and checks whether it is stuck in a loop.
 * Must be called AFTER execution with the real output — the previous
 * pre-exec wiring compared empty outputs and degraded into a plain
 * same-command repeat counter.
 */
export function checkCommandLoop(
	command: string,
	output: string,
	exitCode: number,
): { shouldBlock: boolean; reason?: string } {
	// Evict records older than 60s
	const now = Date.now();
	while (
		recentCommands.length > 0 &&
		now - recentCommands[0].timestamp > 60000
	) {
		recentCommands.shift();
	}

	// Count prior occurrences of same command + same output
	const sameCommandSameOutput = recentCommands.filter(
		(entry) => entry.command === command && entry.output === output,
	);

	if (sameCommandSameOutput.length >= DUPLICATE_THRESHOLD) {
		return {
			shouldBlock: true,
			reason:
				exitCode === 0
					? `Command "${command}" has already exited 0 with identical output ${sameCommandSameOutput.length} rounds in a row. It has already succeeded — do not run it again. Use the earlier result and report the outcome.`
					: `The local model appears to be stuck in a command execution loop: command "${command}" has produced identical output for ${sameCommandSameOutput.length} consecutive rounds. Manual intervention required.`,
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
