import type { Message } from "../../types/message.js"; // log: import Message for tokenCountWithEstimation cast
import { getContextWindowForModel } from "../../utils/context.js";
import { logForDebugging } from "../../utils/debug.js";
import { getMainLoopModel } from "../../utils/model/model.js";
import {
	recordContextCollapseCommit,
	recordContextCollapseSnapshot,
} from "../../utils/sessionStorage.js";
import { tokenCountWithEstimation } from "../../utils/tokens.js";
import { projectView } from "./operations.js";
import { restoreFromEntries } from "./persist.js";

type ContextCollapseStats = {
	collapsedSpans: number;
	collapsedMessages: number;
	stagedSpans: number;
	health: {
		totalErrors: number;
		totalEmptySpawns: number;
		totalSpawns: number;
		emptySpawnWarningEmitted: boolean;
		lastError: string | null;
	};
};

type CommittedCollapse = {
	collapseId: string;
	summaryUuid: string;
	summaryContent: string;
	summary: string;
	firstArchivedUuid: string;
	lastArchivedUuid: string;
	archived: unknown[];
};

type StagedSpan = {
	startUuid: string;
	endUuid: string;
	summary: string;
	risk: number;
	stagedAt: number;
};

const EMPTY_STATS: ContextCollapseStats = {
	collapsedSpans: 0,
	collapsedMessages: 0,
	stagedSpans: 0,
	health: {
		totalErrors: 0,
		totalEmptySpawns: 0,
		totalSpawns: 0,
		emptySpawnWarningEmitted: false,
		lastError: null,
	},
};

let enabled = false;
let nextCollapseId = 1;
const commits: CommittedCollapse[] = [];
const staged: StagedSpan[] = [];
const subscribers = new Set<() => void>();
let spawnArmed = false;
let lastSpawnTokens = 0;

const COLLAPSE_THRESHOLD_PCT = 0.7;
const SPAWN_INTERVAL_TOKENS = 50000;

function notify(): void {
	for (const cb of subscribers) {
		try {
			cb();
		} catch {}
	}
}

function generateCollapseId(): string {
	return String(nextCollapseId++).padStart(16, "0");
}

function generateUuid(): string {
	return `collapse-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getUuid(msg: unknown): string | undefined {
	if (msg && typeof msg === "object") {
		const m = msg as Record<string, unknown>;
		if (typeof m.uuid === "string") return m.uuid;
		if (m.message && typeof m.message === "object") {
			const inner = m.message as Record<string, unknown>;
			if (typeof inner.uuid === "string") return inner.uuid;
		}
	}
	return undefined;
}

function isUserMessage(msg: unknown): boolean {
	if (msg && typeof msg === "object") {
		const m = msg as Record<string, unknown>;
		if (m.role === "user") return true;
		if (
			m.message &&
			typeof (m.message as Record<string, unknown>).role === "string"
		) {
			return (m.message as Record<string, unknown>).role === "user";
		}
	}
	return false;
}

function estimateSpanTokens(messages: unknown[]): number {
	return Math.ceil(messages.length * 200);
}

export function initContextCollapse(): void {
	enabled = true;
	commits.length = 0;
	staged.length = 0;
	nextCollapseId = 1;
	spawnArmed = false;
	lastSpawnTokens = 0;
	logForDebugging("[contextCollapse] initialized");
}

export function resetContextCollapse(): void {
	commits.length = 0;
	staged.length = 0;
	nextCollapseId = 1;
	spawnArmed = false;
	lastSpawnTokens = 0;
	notify();
	logForDebugging("[contextCollapse] reset");
}

export function isContextCollapseEnabled(): boolean {
	return enabled;
}

export function getStats(): ContextCollapseStats {
	const collapsedMessages = commits.reduce(
		(sum, c) => sum + c.archived.length,
		0,
	);
	return {
		collapsedSpans: commits.length,
		collapsedMessages,
		stagedSpans: staged.length,
		health: EMPTY_STATS.health,
	};
}

export function subscribe(callback: () => void): () => void {
	subscribers.add(callback);
	return () => {
		subscribers.delete(callback);
	};
}

function findMessageIndexByUuid(messages: unknown[], uuid: string): number {
	return messages.findIndex((m) => getUuid(m) === uuid);
}

function findCollapsibleSpan(messages: unknown[]): {
	startIdx: number;
	endIdx: number;
} | null {
	if (messages.length < 6) return null;
	const startIdx = 1;
	let endIdx = -1;
	for (let i = messages.length - 1; i >= startIdx + 4; i--) {
		if (isUserMessage(messages[i])) {
			endIdx = i - 1;
			break;
		}
	}
	if (endIdx < startIdx + 3) return null;
	return { startIdx, endIdx };
}

async function commitSpan(
	messages: unknown[],
	startIdx: number,
	endIdx: number,
	summary: string,
): Promise<void> {
	const spanMessages = messages.slice(startIdx, endIdx + 1);
	const firstUuid = getUuid(spanMessages[0]);
	const lastUuid = getUuid(spanMessages[spanMessages.length - 1]);
	if (!firstUuid || !lastUuid) {
		logForDebugging("[contextCollapse] skipping span: missing uuid boundaries");
		return;
	}

	const collapseId = generateCollapseId();
	const summaryUuid = generateUuid();
	const summaryContent = `<collapsed id="${collapseId}">${summary}</collapsed>`;

	const commit: CommittedCollapse = {
		collapseId,
		summaryUuid,
		summaryContent,
		summary,
		firstArchivedUuid: firstUuid,
		lastArchivedUuid: lastUuid,
		archived: spanMessages,
	};
	commits.push(commit);

	try {
		await recordContextCollapseCommit({
			collapseId,
			summaryUuid,
			summaryContent,
			summary,
			firstArchivedUuid: firstUuid,
			lastArchivedUuid: lastUuid,
		});
	} catch (err) {
		logForDebugging(
			`[contextCollapse] failed to persist commit: ${(err as Error).message}`,
		);
	}

	logForDebugging(
		`[contextCollapse] committed span ${collapseId}: ${spanMessages.length} messages`,
	);
	notify();
}

export async function applyCollapsesIfNeeded<T>(
	messages: T[],
	_toolUseContext: unknown,
	_querySource?: string,
): Promise<{ messages: T[] }> {
	if (!enabled) return { messages };

	let projected = projectView(messages, commits);

	const model = getMainLoopModel() ?? "default";
	const ctxWindow = getContextWindowForModel(model);
	const usedTokens = tokenCountWithEstimation(projected as Message[]); // log: cast for tokenCountWithEstimation
	const usagePct = usedTokens / ctxWindow;

	if (usagePct >= COLLAPSE_THRESHOLD_PCT) {
		const span = findCollapsibleSpan(projected as unknown[]);
		if (span) {
			const spanMsgs = (projected as unknown[]).slice(
				span.startIdx,
				span.endIdx + 1,
			);
			const tokenEstimate = estimateSpanTokens(spanMsgs);
			const summary = `[Context collapsed: ${spanMsgs.length} messages, ~${tokenEstimate} tokens — earlier conversation summarized to free context space]`;

			await commitSpan(
				projected as unknown[],
				span.startIdx,
				span.endIdx,
				summary,
			);

			projected = projectView(messages, commits);
			logForDebugging(
				`[contextCollapse] applied collapse at ${Math.round(usagePct * 100)}% usage`,
			);
		}
	}

	const currentTokens = tokenCountWithEstimation(projected as Message[]); // log: cast for tokenCountWithEstimation
	if (spawnArmed && currentTokens - lastSpawnTokens >= SPAWN_INTERVAL_TOKENS) {
		try {
			await recordContextCollapseSnapshot({
				staged: staged.map((s) => ({
					startUuid: s.startUuid,
					endUuid: s.endUuid,
					summary: s.summary,
					risk: s.risk,
					stagedAt: s.stagedAt,
				})),
				armed: spawnArmed,
				lastSpawnTokens: currentTokens,
			});
		} catch {}
		lastSpawnTokens = currentTokens;
	}

	return { messages: projected as T[] };
}

export function recoverFromOverflow<T>(
	messages: T[],
	_querySource?: string,
): { messages: T[]; committed: number } {
	if (!enabled) return { messages, committed: 0 };

	let committed = 0;
	let projected = projectView(messages, commits) as T[];

	const maxAttempts = 3;
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const model = getMainLoopModel() ?? "default";
		const ctxWindow = getContextWindowForModel(model);
		const usedTokens = tokenCountWithEstimation(projected as Message[]); // log: cast for tokenCountWithEstimation

		if (usedTokens < ctxWindow) break;

		const span = findCollapsibleSpan(projected as unknown[]);
		if (!span) break;

		const spanMsgs = (projected as unknown[]).slice(
			span.startIdx,
			span.endIdx + 1,
		);
		const tokenEstimate = estimateSpanTokens(spanMsgs);
		const summary = `[Overflow recovery: ${spanMsgs.length} messages, ~${tokenEstimate} tokens collapsed to free context space]`;

		const firstUuid = getUuid(spanMsgs[0]);
		const lastUuid = getUuid(spanMsgs[spanMsgs.length - 1]);
		if (!firstUuid || !lastUuid) break;

		const collapseId = generateCollapseId();
		const summaryUuid = generateUuid();
		const summaryContent = `<collapsed id="${collapseId}">${summary}</collapsed>`;

		commits.push({
			collapseId,
			summaryUuid,
			summaryContent,
			summary,
			firstArchivedUuid: firstUuid,
			lastArchivedUuid: lastUuid,
			archived: spanMsgs,
		});
		committed++;

		projected = projectView(messages, commits) as T[];
		logForDebugging(
			`[contextCollapse] overflow recovery: collapsed ${spanMsgs.length} messages (attempt ${attempt + 1})`,
		);
	}

	if (committed > 0) notify();
	return { messages: projected, committed };
}

export function isWithheldPromptTooLong(
	message: unknown,
	isPromptTooLongMessage: (message: unknown) => boolean,
	_querySource?: string,
): boolean {
	if (!enabled) return false;
	return isPromptTooLongMessage(message);
}

export {
	commits as _commits,
	projectView as _projectView,
	restoreFromEntries,
	staged as _staged,
};
