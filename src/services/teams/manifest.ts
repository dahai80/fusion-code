// Issue #268 (T4a): team manifest loading + validation.
// Manifest format: JSON (fusion-code's choice over TOML — zero deps, the
// kernel only sees TeamDefinition dataclass fields). One manifest per
// project; namespace_key defaults to team:<repo-basename> so N manifests
// across N repos stay isolated (memories + inboxes).
import { readFileSync } from "node:fs";

export interface TeamMemberSpec {
	name: string;
	role: string;
	skills: string[];
	tool_allowlist: string[];
	budget_tokens: number;
	permission_mode: string;
	max_concurrency: number;
}

export interface TeamTaskSpec {
	title: string;
	detail: string;
	assignee: string;
}

export interface TeamManifest {
	name: string;
	namespace_key: string;
	lead_budget_tokens: number;
	playbook: boolean;
	members: TeamMemberSpec[];
	tasks: TeamTaskSpec[];
}

export class ManifestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ManifestError";
	}
}

function strList(value: unknown, field: string): string[] {
	if (value === undefined || value === null) {
		return [];
	}
	if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
		throw new ManifestError(`${field} must be an array of strings`);
	}
	return value as string[];
}

function positiveInt(value: unknown, field: string): number {
	if (value === undefined || value === null) {
		return 0;
	}
	const n = Number(value);
	if (!Number.isInteger(n) || n <= 0) {
		throw new ManifestError(`${field} must be a positive integer`);
	}
	return n;
}

export function parseTeamManifest(
	raw: unknown,
	defaultNamespace: string,
): TeamManifest {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new ManifestError("manifest root must be a JSON object");
	}
	const obj = raw as Record<string, unknown>;
	const name = String(obj.name ?? "").trim();
	if (!name) {
		throw new ManifestError("manifest.name is required");
	}
	const rawMembers = obj.members;
	if (!Array.isArray(rawMembers) || rawMembers.length === 0) {
		throw new ManifestError("manifest.members must be a non-empty array");
	}
	const members: TeamMemberSpec[] = rawMembers.map((m, i) => {
		if (typeof m !== "object" || m === null) {
			throw new ManifestError(`manifest.members[${i}] must be an object`);
		}
		const mem = m as Record<string, unknown>;
		const memberName = String(mem.name ?? "").trim();
		if (!memberName) {
			throw new ManifestError(`manifest.members[${i}].name is required`);
		}
		return {
			name: memberName,
			role: String(mem.role ?? "").trim(),
			skills: strList(mem.skills, `manifest.members[${i}].skills`),
			tool_allowlist: strList(
				mem.tool_allowlist,
				`manifest.members[${i}].tool_allowlist`,
			),
			budget_tokens: positiveInt(
				mem.budget_tokens,
				`manifest.members[${i}].budget_tokens`,
			),
			permission_mode: String(mem.permission_mode ?? "").trim() || "default",
			max_concurrency: positiveInt(
				mem.max_concurrency,
				`manifest.members[${i}].max_concurrency`,
			),
		};
	});
	const seen = new Set<string>();
	for (const m of members) {
		if (seen.has(m.name)) {
			throw new ManifestError(`duplicate member name: ${m.name}`);
		}
		seen.add(m.name);
	}
	const tasks: TeamTaskSpec[] = (Array.isArray(obj.tasks) ? obj.tasks : []).map(
		(t, i) => {
			if (typeof t !== "object" || t === null) {
				throw new ManifestError(`manifest.tasks[${i}] must be an object`);
			}
			const task = t as Record<string, unknown>;
			const title = String(task.title ?? "").trim();
			if (!title) {
				throw new ManifestError(`manifest.tasks[${i}].title is required`);
			}
			return {
				title,
				detail: String(task.detail ?? "").trim(),
				assignee: String(task.assignee ?? "").trim(),
			};
		},
	);
	return {
		name,
		namespace_key: String(obj.namespace_key ?? "").trim() || defaultNamespace,
		lead_budget_tokens: positiveInt(
			obj.lead_budget_tokens,
			"manifest.lead_budget_tokens",
		),
		playbook: obj.playbook === true,
		members,
		tasks,
	};
}

export function loadTeamManifest(path: string, cwd: string): TeamManifest {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (e) {
		throw new ManifestError(`cannot read manifest ${path}: ${String(e)}`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (e) {
		throw new ManifestError(`manifest ${path} is not valid JSON: ${String(e)}`);
	}
	// namespace default: team:<repo basename> — per-repo isolation.
	const repoBase = cwd.split("/").filter(Boolean).pop() ?? "default";
	return parseTeamManifest(parsed, `team:${repoBase}`);
}
