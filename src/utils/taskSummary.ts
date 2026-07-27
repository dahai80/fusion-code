// log: created for TS2307 fix

export function shouldGenerateTaskSummary(): boolean {
	return false;
}

export function maybeGenerateTaskSummary(_opts: {
	systemPrompt?: unknown;
	userContext?: unknown;
	systemContext?: unknown;
	toolUseContext?: unknown;
	forkContextMessages?: unknown[];
}): void {
	console.log("[taskSummary] maybeGenerateTaskSummary called (stub)");
}
