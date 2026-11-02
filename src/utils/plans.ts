import { copyFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import memoize from "lodash-es/memoize.js";
import type { AgentId, SessionId } from "src/types/ids.js";
import type { LogOption } from "src/types/logs.js";
import { getPlanSlugCache, getSessionId } from "../bootstrap/state.js";
import { getCwd } from "./cwd.js";
import { getClaudeConfigHomeDir } from "./envUtils.js";
import { isENOENT } from "./errors.js";
import { getFsImplementation } from "./fsOperations.js";
import { logError } from "./log.js";
import { getInitialSettings } from "./settings/settings.js";
import { generateWordSlug } from "./words.js";

const MAX_SLUG_RETRIES = 10;

/**
 * Get or generate a word slug for the current session's plan.
 * The slug is generated lazily on first access and cached for the session.
 * If a plan file with the generated slug already exists, retries up to 10 times.
 */
export function getPlanSlug(sessionId?: SessionId): string {
	const id = sessionId ?? getSessionId();
	const cache = getPlanSlugCache();
	let slug = cache.get(id);
	if (!slug) {
		const plansDir = getPlansDirectory();
		// Try to find a unique slug that doesn't conflict with existing files
		for (let i = 0; i < MAX_SLUG_RETRIES; i++) {
			slug = generateWordSlug();
			const filePath = join(plansDir, `${slug}.md`);
			if (!getFsImplementation().existsSync(filePath)) {
				break;
			}
		}
		if (slug !== undefined) cache.set(id, slug);
	}
	return slug ?? null;
}

/**
 * Set a specific plan slug for a session (used when resuming a session)
 */
export function setPlanSlug(sessionId: SessionId, slug: string): void {
	getPlanSlugCache().set(sessionId, slug);
}

/**
 * Clear the plan slug for the current session.
 * This should be called on /clear to ensure a fresh plan file is used.
 */
export function clearPlanSlug(sessionId?: SessionId): void {
	const id = sessionId ?? getSessionId();
	getPlanSlugCache().delete(id);
}

/**
 * Clear ALL plan slug entries (all sessions).
 * Use this on /clear to free sub-session slug entries.
 */
export function clearAllPlanSlugs(): void {
	getPlanSlugCache().clear();
}

// Memoized: called from render bodies (FileReadTool/FileEditTool/FileWriteTool UI.tsx)
// and permission checks. Inputs (initial settings + cwd) are fixed at startup, so the
// mkdirSync result is stable for the session. Without memoization, each rendered tool
// message triggers a mkdirSync syscall (regressed in #20005).
export const getPlansDirectory = memoize(function getPlansDirectory(): string {
	const settings = getInitialSettings();
	const settingsDir = settings.plansDirectory;
	let plansPath: string;

	if (settingsDir) {
		// Settings.json (relative to project root)
		const cwd = getCwd();
		const resolved = resolve(cwd, settingsDir);

		// Validate path stays within project root to prevent path traversal
		if (!resolved.startsWith(cwd + sep) && resolved !== cwd) {
			logError(
				new Error(`plansDirectory must be within project root: ${settingsDir}`),
			);
			plansPath = join(getClaudeConfigHomeDir(), "plans");
		} else {
			plansPath = resolved;
		}
	} else {
		// Default
		plansPath = join(getClaudeConfigHomeDir(), "plans");
	}

	// Ensure directory exists (mkdirSync with recursive: true is a no-op if it exists)
	try {
		getFsImplementation().mkdirSync(plansPath);
	} catch (error) {
		logError(error);
	}

	return plansPath;
});

/**
 * Get the file path for a session's plan
 * @param agentId Optional agent ID for subagents. If not provided, returns main session plan.
 * For main conversation (no agentId), returns {planSlug}.md
 * For subagents (agentId provided), returns {planSlug}-agent-{agentId}.md
 */
export function getPlanFilePath(agentId?: AgentId): string {
	const planSlug = getPlanSlug(getSessionId());

	// Main conversation: simple filename with word slug
	if (!agentId) {
		return join(getPlansDirectory(), `${planSlug}.md`);
	}

	// Subagents: include agent ID
	return join(getPlansDirectory(), `${planSlug}-agent-${agentId}.md`);
}

/**
 * Get the plan content for a session
 * @param agentId Optional agent ID for subagents. If not provided, returns main session plan.
 */
export function getPlan(agentId?: AgentId): string | null {
	const filePath = getPlanFilePath(agentId);
	try {
		return getFsImplementation().readFileSync(filePath, { encoding: "utf-8" });
	} catch (error) {
		if (isENOENT(error)) return null;
		logError(error);
		return null;
	}
}

/**
 * Extract the plan slug from a log's message history.
 */
function getSlugFromLog(log: LogOption): string | undefined {
	return log.messages.find((m) => m.slug)?.slug;
}

/**
 * Restore plan slug from a resumed session.
 * Sets the slug in the session cache so getPlanSlug returns it.
 * If the plan file is missing, attempts to recover it from a file snapshot
 * (written incrementally during the session) or from message history.
 * Returns true if a plan file exists (or was recovered) for the slug.
 * @param log The log to restore from
 * @param targetSessionId The session ID to associate the plan slug with.
 *                        This should be the ORIGINAL session ID being resumed,
 *                        not the temporary session ID from before resume.
 */
export async function copyPlanForResume(
	log: LogOption,
	targetSessionId?: SessionId,
): Promise<boolean> {
	const slug = getSlugFromLog(log);
	if (!slug) {
		return false;
	}

	// Set the slug for the target session ID (or current if not provided)
	const sessionId = targetSessionId ?? getSessionId();
	setPlanSlug(sessionId, slug);

	// Attempt to read the plan file directly — recovery triggers on ENOENT.
	const planPath = join(getPlansDirectory(), `${slug}.md`);
	try {
		await getFsImplementation().readFile(planPath, { encoding: "utf-8" });
		return true;
	} catch (e: unknown) {
		if (!isENOENT(e)) {
			// Don't throw — called fire-and-forget (void copyPlanForResume(...)) with no .catch()
			logError(e);
			return false;
		}
		// Recovery was remote-session (CCR) only; cloud stack removed. Local
		// sessions have no missing-file case to recover.
		return false;
	}
}

/**
 * Copy a plan file for a forked session. Unlike copyPlanForResume (which reuses
 * the original slug), this generates a NEW slug for the forked session and
 * writes the original plan content to the new file. This prevents the original
 * and forked sessions from clobbering each other's plan files.
 */
export async function copyPlanForFork(
	log: LogOption,
	targetSessionId: SessionId,
): Promise<boolean> {
	const originalSlug = getSlugFromLog(log);
	if (!originalSlug) {
		return false;
	}

	const plansDir = getPlansDirectory();
	const originalPlanPath = join(plansDir, `${originalSlug}.md`);

	// Generate a new slug for the forked session (do NOT reuse the original)
	const newSlug = getPlanSlug(targetSessionId);
	const newPlanPath = join(plansDir, `${newSlug}.md`);
	try {
		await copyFile(originalPlanPath, newPlanPath);
		return true;
	} catch (error) {
		if (isENOENT(error)) {
			return false;
		}
		logError(error);
		return false;
	}
}
