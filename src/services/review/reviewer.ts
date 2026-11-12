import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Evolution plan P2.2: first-class reviewer session layer. Presets are the
// headless form of the /review and /security-review prompts (they stay REPL
// commands; this is the same review work runnable on a working diff without
// a REPL). Emits findings with file:line + severity + concrete fix, persisted
// as a JSON findings file under <configDir>/reviews/.
//
// fusion-security hook (C5): the security-review preset consumes SAST
// results from the fusion-security service (port 11454) when reachable —
// best-effort, fail-open with a 2s timeout, never a hard dependency.

export type ReviewFinding = {
	file: string;
	line: number | null;
	severity: "critical" | "high" | "medium" | "low" | "info";
	title: string;
	fix: string;
};

export type ReviewerPreset = {
	name: string;
	description: string;
	buildPrompt: (diff: string, extraContext: string) => string;
};

const FINDINGS_FORMAT = `
Output your findings as a single JSON array in a \`\`\`json fenced block, one
object per finding with exactly these fields:
- "file": repo-relative path
- "line": line number (integer) or null
- "severity": "critical" | "high" | "medium" | "low" | "info"
- "title": one-line finding summary
- "fix": concrete fix instruction
No findings → empty array []. Do not wrap the JSON in any other text.
`;

function reviewPrompt(diff: string, extraContext: string): string {
	return `You are an expert code reviewer. Review the working diff below for:
code correctness, project conventions, performance implications, test
coverage, and security considerations. Findings must reference concrete
file:line locations and give a specific, actionable fix.
${extraContext}
WORKING DIFF:
\`\`\`diff
${diff}
\`\`\`
${FINDINGS_FORMAT}`;
}

function securityPrompt(diff: string, extraContext: string): string {
	return `You are a senior security engineer conducting a focused security
review of the changes below. Hunt for injection, unsafe subprocess use,
credential handling, path traversal, unsafe deserialization, and
authorization gaps. Every finding needs file:line + a concrete fix.
${extraContext}
WORKING DIFF:
\`\`\`diff
${diff}
\`\`\`
${FINDINGS_FORMAT}`;
}

function depsAuditPrompt(diff: string, extraContext: string): string {
	return `You are auditing dependency changes below (package manifests and
lockfile diffs). Flag: known-vulnerable or deprecated packages, unpinned
versions, registry/provider risk, unnecessary new transitive weight, and
license concerns. Every finding needs file:line + a concrete fix.
${extraContext}
WORKING DIFF:
\`\`\`diff
${diff}
\`\`\`
${FINDINGS_FORMAT}`;
}

export const REVIEWER_PRESETS: Record<string, ReviewerPreset> = {
	review: {
		name: "review",
		description: "Code review of the working diff",
		buildPrompt: reviewPrompt,
	},
	"security-review": {
		name: "security-review",
		description: "Security-focused review of the working diff",
		buildPrompt: securityPrompt,
	},
	"deps-audit": {
		name: "deps-audit",
		description: "Dependency audit of manifest/lockfile changes",
		buildPrompt: depsAuditPrompt,
	},
};

export function isReviewerPreset(name: string): boolean {
	return name in REVIEWER_PRESETS;
}

function configDir(): string {
	return process.env.FUSION_CODE_CONFIG_DIR ?? join(homedir(), ".fusion-code");
}

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
	const proc = spawnSync("git", args, { cwd, encoding: "utf8" });
	return { ok: proc.status === 0, out: `${proc.stdout ?? ""}${proc.stderr ?? ""}` };
}

// Best-effort SAST context from the fusion-security service (fail-open).
export async function fetchSecurityContext(repoPath: string): Promise<string> {
	const base = process.env.FUSION_SECURITY_URL ?? "http://127.0.0.1:11454";
	try {
		const res = await fetch(`${base}/api/sast?repo=${encodeURIComponent(repoPath)}`, {
			signal: AbortSignal.timeout(2000),
		});
		if (!res.ok) return "";
		const body = (await res.json()) as { findings?: unknown };
		if (!body.findings) return "";
		return `\nSAST RESULTS (fusion-security service):\n${JSON.stringify(body.findings).slice(0, 4000)}\n`;
	} catch {
		return "";
	}
}

// Binary resolution shared with the task handler — the reviewer runs the
// same fusion binary headless. FUSION_CODE_TASK_FUSION_BIN is the test seam.
export function fusionCommandForReview(extra: string[]): string[] {
	const stub = process.env.FUSION_CODE_TASK_FUSION_BIN;
	if (stub) return [stub, ...extra];
	const script = process.argv[1] ?? "";
	if (script.endsWith(".tsx") || script.endsWith(".ts")) {
		return [process.execPath, "run", script, ...extra];
	}
	return [process.execPath, ...extra];
}

export type ReviewerRunResult = {
	id: string;
	preset: string;
	findingsPath: string;
	findings: ReviewFinding[];
	resultText: string;
	error: string | null;
};

function parseFindings(resultText: string): ReviewFinding[] {
	const match = resultText.match(/```json\s*([\s\S]*?)```/);
	if (!match) return [];
	try {
		const parsed = JSON.parse(match[1]!) as Array<Record<string, unknown>>;
		if (!Array.isArray(parsed)) return [];
		return parsed.map((f) => ({
			file: String(f.file ?? ""),
			line: typeof f.line === "number" ? f.line : null,
			severity: (["critical", "high", "medium", "low", "info"] as const).includes(
				f.severity as "info",
			)
				? (f.severity as ReviewFinding["severity"])
				: "info",
			title: String(f.title ?? ""),
			fix: String(f.fix ?? ""),
		}));
	} catch {
		return [];
	}
}

export async function runReviewer(opts: {
	preset: string;
	cwd: string;
	withSecurityContext?: boolean;
}): Promise<ReviewerRunResult> {
	const preset = REVIEWER_PRESETS[opts.preset];
	if (!preset) throw new Error(`unknown reviewer preset: ${opts.preset}`);
	const id = randomUUID().slice(0, 8);

	const diff = git(opts.cwd, ["diff", "HEAD"]);
	if (!diff.ok) {
		throw new Error(`git diff failed: ${diff.out.trim().slice(0, 300)}`);
	}
	if (!diff.out.trim()) {
		throw new Error("no working diff to review");
	}
	let extraContext = "";
	if (opts.withSecurityContext && opts.preset === "security-review") {
		extraContext = await fetchSecurityContext(opts.cwd);
	}

	const prompt = preset.buildPrompt(diff.out.slice(0, 120_000), extraContext);
	const proc = Bun.spawn(fusionCommandForReview([
		"-p",
		prompt,
		"--output-format",
		"stream-json",
	]), {
		cwd: opts.cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
	]);
	let resultText = "";
	for (const line of stdout.split("\n")) {
		if (!line.trim().startsWith("{")) continue;
		try {
			const parsed = JSON.parse(line) as Record<string, unknown>;
			if (parsed.type === "result" && typeof parsed.result === "string") {
				resultText = parsed.result;
			}
		} catch {
			// stream noise — skip
		}
	}
	const error = exitCode !== 0 && !resultText
		? `headless reviewer exited ${exitCode}`
		: null;
	const findings = parseFindings(resultText);
	const reviewsDir = join(configDir(), "reviews");
	mkdirSync(reviewsDir, { recursive: true });
	const findingsPath = join(reviewsDir, `${id}.json`);
	writeFileSync(
		findingsPath,
		JSON.stringify(
			{ id, preset: preset.name, cwd: opts.cwd, at: new Date().toISOString(), findings },
			null,
			4,
		),
	);
	return { id, preset: preset.name, findingsPath, findings, resultText, error };
}

export function findingsFileExists(path: string): boolean {
	return existsSync(path);
}
