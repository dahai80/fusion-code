import type { UUID } from "crypto";
import { getSessionId } from "../../bootstrap/state.js";
import type { LocalJSXCommandContext } from "../../commands.js";
import type { LocalJSXCommandOnDone } from "../../types/command.js";
import {
	getTranscriptPath,
	saveAgentName,
	saveCustomTitle,
} from "../../utils/sessionStorage.js";

export async function call(
	onDone: LocalJSXCommandOnDone,
	context: LocalJSXCommandContext,
	args: string,
): Promise<React.ReactNode> {
	const trimmedArgs = (args ?? "").trim();
	if (!trimmedArgs) {
		onDone(
			"Usage: /rename <name> — provide a name for the session",
			{ display: "system" }, // log: removed 'type' - not in LocalJSXCommandOnDone options
		);
		return null;
	}

	const newName = trimmedArgs;
	const sessionId = getSessionId() as UUID;
	const fullPath = getTranscriptPath();

	await saveCustomTitle(sessionId, newName, fullPath);
	await saveAgentName(sessionId, newName, fullPath);

	context.setAppState((prev) => ({
		...prev,
		standaloneAgentContext: {
			...prev.standaloneAgentContext,
			name: newName,
		},
	}));

	onDone(`Session renamed to: ${newName}`, { display: "system" }); // log: removed 'type'
	return null;
}
