import { readFile } from "fs/promises";
import { join } from "path";
import type {
	LocalCommandCall,
	LocalCommandResult,
} from "../../types/command.js";
import type { SessionBookmark } from "../../types/sessionBookmark.js";
import { getClaudeConfigHomeDir } from "../../utils/envUtils.js";

async function loadBookmarks(): Promise<SessionBookmark[]> {
	const path = join(getClaudeConfigHomeDir(), "session-bookmarks.json");
	try {
		const data = await readFile(path, "utf-8");
		return JSON.parse(data);
	} catch {
		return [];
	}
}

export const call: LocalCommandCall = async (args, _context) => {
	const name = args.trim();
	const bookmarks = await loadBookmarks();

	if (!name) {
		if (bookmarks.length === 0) {
			return {
				type: "display",
				display: "No saved sessions. Use /save-session <name> to save one.",
			} satisfies LocalCommandResult;
		}
		const lines = bookmarks.map((b) => {
			const ago = formatTimeAgo(b.savedAt);
			return `  ${b.name} | ${b.sessionId.slice(0, 8)}… | ${b.projectPath.split("/").slice(-2).join("/")} | saved ${ago}`;
		});
		return {
			type: "display",
			display: `Saved sessions:\n${lines.join("\n")}\n\nResume with /resume-session <name>`,
		} satisfies LocalCommandResult;
	}

	const bookmark = bookmarks.find((b) => b.name === name);
	if (!bookmark) {
		return {
			type: "display",
			display: `No saved session named "${name}". Use /resume-session (no args) to list available sessions.`,
		} satisfies LocalCommandResult;
	}

	console.log(
		`[resume-session] resuming "${name}" → session ${bookmark.sessionId}`,
	);

	return {
		type: "display",
		display: `Resuming session "${name}" (${bookmark.sessionId})...\nSwitch to project dir: ${bookmark.projectPath}\nThen run: /resume ${bookmark.sessionId}`,
		submitNextInput: true,
	} satisfies LocalCommandResult; // log: removed shouldQuery/nextInput - not in display variant
};

function formatTimeAgo(isoDate: string): string {
	const ms = Date.now() - new Date(isoDate).getTime();
	if (ms < 60_000) return "just now";
	if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
	if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
	return `${Math.round(ms / 86_400_000)}d ago`;
}
