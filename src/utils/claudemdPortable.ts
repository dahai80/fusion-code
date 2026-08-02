/**
 * Portable CLAUDE.md parsing — no CLI dependencies.
 *
 * Accepts cwd as parameter instead of reading bootstrap/state.
 * No hooks, no analytics, no memoize, no feature flags.
 * Designed for use by the project API server and external consumers.
 *
 * FUSION.rules: Enhanced rule file with priority above CLAUDE.md.
 * Supports frontmatter fields: denied_tools (string[]), default_template (string).
 * Load order: global FUSION.rules > project FUSION.rules > CLAUDE.md files.
 */

import { readdir, readFile, stat } from "fs/promises";
import { dirname, join, parse } from "path";
import { logForDebugging } from "./debug.js";
import { parseFrontmatter } from "./frontmatterParser.js";

export type PortableMemoryFileInfo = {
	path: string;
	type: "Managed" | "User" | "Project" | "Local" | "AutoMem" | "FusionRules";
	content: string;
	description: string | null;
	frontmatter: Record<string, unknown>;
};

export type PortableProjectContext = {
	cwd: string;
	files: PortableMemoryFileInfo[];
	combinedContent: string;
};

export type FusionRulesConfig = {
	deniedTools: string[];
	defaultTemplate: string | null;
};

const MAX_FILE_SIZE = 40000;

async function fileExists(filePath: string): Promise<boolean> {
	try {
		const s = await stat(filePath);
		return s.isFile();
	} catch {
		return false;
	}
}

async function dirExists(dirPath: string): Promise<boolean> {
	try {
		const s = await stat(dirPath);
		return s.isDirectory();
	} catch {
		return false;
	}
}

async function readMemoryFile(
	filePath: string,
	type: PortableMemoryFileInfo["type"],
): Promise<PortableMemoryFileInfo | null> {
	try {
		const content = await readFile(filePath, "utf-8");
		if (!content.trim()) return null;
		const { frontmatter, content: body } = parseFrontmatter(content, filePath);
		return {
			path: filePath,
			type,
			content: body.slice(0, MAX_FILE_SIZE),
			description: (frontmatter.description as string) ?? null,
			frontmatter: frontmatter as Record<string, unknown>,
		};
	} catch (e) {
		const code = (e as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "EACCES") return null;
		logForDebugging(
			`claudemdPortable: failed to read ${filePath}: ${code ?? e}`,
		);
		return null;
	}
}

async function readRulesDir(
	rulesDir: string,
	type: PortableMemoryFileInfo["type"],
): Promise<PortableMemoryFileInfo[]> {
	if (!(await dirExists(rulesDir))) return [];
	const results: PortableMemoryFileInfo[] = [];
	try {
		const entries = await readdir(rulesDir, { recursive: true });
		for (const entry of entries) {
			if (typeof entry !== "string" || !entry.endsWith(".md")) continue;
			const filePath = join(rulesDir, entry);
			const info = await readMemoryFile(filePath, type);
			if (info) results.push(info);
		}
	} catch {
		return [];
	}
	return results;
}

function getAncestorDirs(cwd: string): string[] {
	const dirs: string[] = [];
	let current = cwd;
	const root = parse(current).root;
	while (current !== root) {
		dirs.push(current);
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return dirs;
}

export function parseFusionRulesConfig(
	frontmatter: Record<string, unknown>,
): FusionRulesConfig {
	const deniedTools = Array.isArray(frontmatter.denied_tools)
		? (frontmatter.denied_tools as string[]).filter(
				(t) => typeof t === "string",
			)
		: [];
	const defaultTemplate =
		typeof frontmatter.default_template === "string"
			? frontmatter.default_template
			: null;
	return { deniedTools, defaultTemplate };
}

export async function getMemoryFilesPortable(
	cwd: string,
): Promise<PortableMemoryFileInfo[]> {
	const result: PortableMemoryFileInfo[] = [];

	// User-level: ~/.fusion-code/FUSION.rules (higher priority) then ~/.fusion-code/CLAUDE.md + ~/.fusion-code/rules/*.md
	const { homedir } = await import("os");
	const configHome =
		process.env.FUSION_CODE_CONFIG_DIR ?? join(homedir(), ".fusion-code");
	const userFusionRules = join(configHome, "FUSION.rules");
	const userFusionRulesInfo = await readMemoryFile(
		userFusionRules,
		"FusionRules",
	);
	if (userFusionRulesInfo) result.push(userFusionRulesInfo);
	const userClaudeMd = join(configHome, "CLAUDE.md");
	const userInfo = await readMemoryFile(userClaudeMd, "User");
	if (userInfo) result.push(userInfo);
	result.push(...(await readRulesDir(join(configHome, "rules"), "User")));

	// Project-level: walk from root to cwd
	const dirs = getAncestorDirs(cwd).reverse();
	for (const dir of dirs) {
		// FUSION.rules (Project) — higher priority than CLAUDE.md
		const fusionRulesInfo = await readMemoryFile(
			join(dir, "FUSION.rules"),
			"FusionRules",
		);
		if (fusionRulesInfo) result.push(fusionRulesInfo);

		// CLAUDE.md (Project)
		const projectInfo = await readMemoryFile(join(dir, "CLAUDE.md"), "Project");
		if (projectInfo) result.push(projectInfo);

		// .fusion-code/CLAUDE.md (Project)
		const dotClaudeInfo = await readMemoryFile(
			join(dir, ".fusion-code", "CLAUDE.md"),
			"Project",
		);
		if (dotClaudeInfo) result.push(dotClaudeInfo);

		// .fusion-code/rules/*.md (Project)
		result.push(
			...(await readRulesDir(join(dir, ".fusion-code", "rules"), "Project")),
		);

		// CLAUDE.local.md (Local)
		const localInfo = await readMemoryFile(
			join(dir, "CLAUDE.local.md"),
			"Local",
		);
		if (localInfo) result.push(localInfo);
	}

	return result;
}

export async function getFusionRulesConfigPortable(
	cwd: string,
): Promise<FusionRulesConfig> {
	const files = await getMemoryFilesPortable(cwd);
	const fusionRulesFiles = files.filter((f) => f.type === "FusionRules");
	const merged: FusionRulesConfig = { deniedTools: [], defaultTemplate: null };
	for (const f of fusionRulesFiles) {
		const config = parseFusionRulesConfig(f.frontmatter);
		// deniedTools are unioned across files; defaultTemplate is overridden by last non-null value
		merged.deniedTools = [
			...new Set([...merged.deniedTools, ...config.deniedTools]),
		];
		if (config.defaultTemplate) {
			merged.defaultTemplate = config.defaultTemplate;
		}
	}
	logForDebugging(
		`fusionRulesPortable: loaded ${fusionRulesFiles.length} FUSION.rules, deniedTools=${merged.deniedTools.join(",")}, defaultTemplate=${merged.defaultTemplate}`,
	);
	return merged;
}

export async function getProjectContextPortable(
	cwd: string,
): Promise<PortableProjectContext> {
	const files = await getMemoryFilesPortable(cwd);
	const combinedContent = files
		.filter((f) => f.content.trim())
		.map((f) => {
			const desc =
				f.type === "Project"
					? " (project instructions)"
					: f.type === "Local"
						? " (user's private project instructions)"
						: f.type === "AutoMem"
							? " (auto-memory)"
							: f.type === "FusionRules"
								? " (enhanced project rules — highest priority)"
								: " (user's global instructions)";
			return `Contents of ${f.path}${desc}:\n\n${f.content.trim()}`;
		})
		.join("\n\n");

	return { cwd, files, combinedContent };
}
