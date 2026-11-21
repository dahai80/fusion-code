// D1 trajectory flywheel — three-format export (issue #51)
//
// Consumes collected trajectories and emits training-ready standard formats
// (consumed by fusion-trainer):
//   SFT  — ShareGPT messages-JSONL, only is_error=false successful trajectories
//   DPO  — preference pairs {prompt, chosen, rejected}, failure as rejected / success as chosen
//   GRPO — {prompt, completion, reward}, reward = is_error ? 0 : 1

import { promises as fs } from "node:fs";
import path from "node:path";
import { loadCollectedTrajectory, readManifest } from "./collector.js";
import type {
	CollectedTrajectory,
	DPOPair,
	ExportOptions,
	GRPOSample,
	SFTSample,
	TrajectoryStep,
} from "./types.js";

const log = (...args: unknown[]) => console.error("[trajectory]", ...args);

// Closing tags built by splitting, avoiding bare closing-tag sequences in
// the source
const CLOSE_THINKING = "<" + "/thinking>";
const CLOSE_TOOL_CALL = "<" + "/tool_call>";
const CLOSE_TOOL_RESULT = "<" + "/tool_result>";

// Render a single trajectory step as conversation text
function stepToText(step: TrajectoryStep): string {
	const parts: string[] = [];
	if (step.thinking) parts.push(`<thinking>${step.thinking}${CLOSE_THINKING}`);
	if (step.toolCalls?.length) {
		for (const tc of step.toolCalls) {
			parts.push(
				'<tool_call name="' +
					tc.name +
					'">' +
					JSON.stringify(tc.input) +
					CLOSE_TOOL_CALL,
			);
		}
	}
	if (step.toolResults?.length) {
		for (const tr of step.toolResults) {
			parts.push(
				'<tool_result error="' +
					tr.isError +
					'">' +
					tr.content +
					CLOSE_TOOL_RESULT,
			);
		}
	}
	if (step.text) parts.push(step.text);
	return parts.join("\n");
}

// Extract the first user prompt (skipping user steps that are pure
// tool_result)
function extractPrompt(traj: CollectedTrajectory): string {
	for (const s of traj.steps) {
		if (s.role === "user" && s.text && !s.toolResults?.length) {
			return s.text;
		}
	}
	const firstUser = traj.steps.find((s) => s.role === "user");
	return firstUser?.text ?? "";
}

// Extract the assistant's final answer text (the last assistant step
// containing text)
function extractFinalAnswer(traj: CollectedTrajectory): string {
	for (let i = traj.steps.length - 1; i >= 0; i--) {
		const s = traj.steps[i];
		if (s.role === "assistant" && s.text) return s.text;
	}
	return "";
}

// Render the full assistant trajectory (thought/tool_call/tool_response/final)
function renderAssistantTurn(traj: CollectedTrajectory): string {
	const parts: string[] = [];
	for (const s of traj.steps) {
		if (s.role !== "assistant") continue;
		const t = stepToText(s);
		if (t) parts.push(t);
	}
	return parts.join("\n");
}

// SFT: only positive trajectories, output ShareGPT messages
export function toSFTSample(traj: CollectedTrajectory): SFTSample | null {
	if (traj.label !== "positive") return null;
	const prompt = extractPrompt(traj);
	const answer = renderAssistantTurn(traj);
	if (!prompt || !answer) return null;
	return {
		messages: [
			{ role: "system", content: "You are a helpful coding assistant." },
			{ role: "user", content: prompt },
			{ role: "assistant", content: answer },
		],
		source: traj.source,
	};
}

// GRPO: one sample per trajectory, reward = is_error ? 0 : 1
export function toGRPOSample(traj: CollectedTrajectory): GRPOSample | null {
	const prompt = extractPrompt(traj);
	const completion = renderAssistantTurn(traj);
	if (!prompt || !completion) return null;
	return {
		prompt,
		completion,
		reward: traj.label === "positive" ? 1 : 0,
		source: traj.source,
	};
}

// DPO: pair up self-correction candidates (failure rendered as rejected /
// the final successful answer as chosen)
export function buildDPOPairs(trajectories: CollectedTrajectory[]): DPOPair[] {
	const pairs: DPOPair[] = [];
	for (const traj of trajectories) {
		if (traj.label !== "self_correction") continue;
		const prompt = extractPrompt(traj);
		const finalAnswer = extractFinalAnswer(traj);
		if (!prompt || !finalAnswer) continue;
		const rejected = renderAssistantTurn(traj);
		pairs.push({
			prompt,
			chosen: finalAnswer,
			rejected,
			source: traj.source,
		});
	}
	return pairs;
}

// Find the first candidate directory containing manifest.json, return
// {storeDir, manifest}; null if none does
async function resolveStore(candidates: string[]): Promise<{
	storeDir: string;
	manifest: NonNullable<Awaited<ReturnType<typeof readManifest>>>;
} | null> {
	for (const dir of candidates) {
		if (!dir) continue;
		const m = await readManifest(dir);
		if (m) return { storeDir: dir, manifest: m };
	}
	return null;
}

// Load all collected trajectories (or filter by sessionId)
// storeDir = collection store directory (where manifest.json + raw/ live)
export async function loadAll(
	storeDir: string,
	sessionId?: string,
): Promise<CollectedTrajectory[]> {
	const manifest = await readManifest(storeDir);
	if (!manifest) {
		log(`no manifest at ${storeDir}, run collect first`);
		return [];
	}
	const out: CollectedTrajectory[] = [];
	for (const entry of manifest.sessions) {
		if (sessionId && entry.sessionId !== sessionId) continue;
		const safeName = entry.sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
		const rawFile = path.join(
			storeDir,
			"raw",
			`${entry.product}-${safeName}.jsonl`,
		);
		try {
			out.push(await loadCollectedTrajectory(rawFile, entry));
		} catch (e) {
			log(`skip missing raw ${rawFile}: ${(e as Error).message}`);
		}
	}
	return out;
}

async function writeJsonl(filePath: string, records: unknown[]): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	const lines = records.map((r) => JSON.stringify(r)).join("\n");
	await fs.writeFile(filePath, lines + (lines ? "\n" : ""), "utf8");
}

// Main entry
// Store-resolution priority: storeDir > sourceDir > destDir (first one
// containing a manifest wins)
export async function exportTrajectories(
	options: ExportOptions,
): Promise<{ count: number; format: string; destFile: string }> {
	const { sourceDir, destDir, format, sessionId, storeDir } = options;
	const resolved = await resolveStore([storeDir, sourceDir, destDir]);
	if (!resolved) {
		log(
			"no manifest found in any of storeDir/sourceDir/destDir " +
				"(storeDir=" +
				(storeDir ?? "-") +
				", sourceDir=" +
				sourceDir +
				", destDir=" +
				destDir +
				"), run collect first",
		);
	}
	const store = resolved?.storeDir ?? sourceDir ?? destDir;
	log(`export format=${format} store=${store} dest=${destDir}`);
	const trajectories = await loadAll(store, sessionId);
	log(`loaded ${trajectories.length} trajectories`);

	let records: unknown[] = [];
	let outFile: string;
	if (format === "sft") {
		records = trajectories
			.map(toSFTSample)
			.filter((s): s is SFTSample => s !== null);
		outFile = path.join(destDir, "sft.jsonl");
	} else if (format === "dpo") {
		records = buildDPOPairs(trajectories);
		outFile = path.join(destDir, "dpo.jsonl");
	} else {
		records = trajectories
			.map(toGRPOSample)
			.filter((s): s is GRPOSample => s !== null);
		outFile = path.join(destDir, "grpo.jsonl");
	}

	await writeJsonl(outFile, records);
	log(`exported ${records.length} ${format} samples -> ${outFile}`);
	return { count: records.length, format, destFile: outFile };
}
