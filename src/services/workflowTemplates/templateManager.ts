import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { logForDebugging } from "../../utils/debug.js";

export type WorkflowTemplate = {
	name: string;
	description: string;
	category: string;
	steps: TemplateStep[];
	created_at?: string;
	updated_at?: string;
};

export type TemplateStep = {
	title: string;
	prompt: string;
	tools?: string[];
};

const GLOBAL_TEMPLATE_DIR = () => {
	const configHome =
		process.env.FUSION_CODE_CONFIG_DIR ?? join(homedir(), ".fusion-code");
	return join(configHome, "templates");
};

const PROJECT_TEMPLATE_DIR = (cwd: string) => join(cwd, ".fusion", "templates");

async function ensureDir(dir: string): Promise<void> {
	await mkdir(dir, { recursive: true });
}

function templateFileName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json";
}

export async function listTemplates(cwd?: string): Promise<WorkflowTemplate[]> {
	const templates: WorkflowTemplate[] = [];
	const seen = new Set<string>();

	const globalDir = GLOBAL_TEMPLATE_DIR();
	try {
		const files = await readdir(globalDir);
		for (const f of files) {
			if (!f.endsWith(".json")) continue;
			try {
				const content = await readFile(join(globalDir, f), "utf-8");
				const t = JSON.parse(content) as WorkflowTemplate;
				if (!seen.has(t.name)) {
					seen.add(t.name);
					templates.push(t);
				}
			} catch {
				logForDebugging(`templateManager: failed to parse ${f}`);
			}
		}
	} catch {
		// global dir not found — ok
	}

	if (cwd) {
		const projectDir = PROJECT_TEMPLATE_DIR(cwd);
		try {
			const files = await readdir(projectDir);
			for (const f of files) {
				if (!f.endsWith(".json")) continue;
				try {
					const content = await readFile(join(projectDir, f), "utf-8");
					const t = JSON.parse(content) as WorkflowTemplate;
					if (!seen.has(t.name)) {
						seen.add(t.name);
						templates.push(t);
					}
				} catch {
					logForDebugging(`templateManager: failed to parse project ${f}`);
				}
			}
		} catch {
			// project dir not found — ok
		}
	}

	return templates;
}

export async function loadTemplate(
	name: string,
	cwd?: string,
): Promise<WorkflowTemplate | null> {
	const fileName = templateFileName(name);

	if (cwd) {
		try {
			const content = await readFile(
				join(PROJECT_TEMPLATE_DIR(cwd), fileName),
				"utf-8",
			);
			return JSON.parse(content) as WorkflowTemplate;
		} catch {
			// not in project
		}
	}

	try {
		const content = await readFile(
			join(GLOBAL_TEMPLATE_DIR(), fileName),
			"utf-8",
		);
		return JSON.parse(content) as WorkflowTemplate;
	} catch {
		return null;
	}
}

export async function saveTemplate(
	template: WorkflowTemplate,
	scope: "global" | "project" = "global",
	cwd?: string,
): Promise<string> {
	const dir =
		scope === "project" && cwd
			? PROJECT_TEMPLATE_DIR(cwd)
			: GLOBAL_TEMPLATE_DIR();
	await ensureDir(dir);
	const fileName = templateFileName(template.name);
	const now = new Date().toISOString();
	template.updated_at = now;
	if (!template.created_at) template.created_at = now;
	const filePath = join(dir, fileName);
	await writeFile(filePath, JSON.stringify(template, null, 2), "utf-8");
	logForDebugging(`templateManager: saved ${template.name} to ${filePath}`);
	return filePath;
}

export async function deleteTemplate(
	name: string,
	cwd?: string,
): Promise<boolean> {
	const fileName = templateFileName(name);
	let deleted = false;

	if (cwd) {
		try {
			await rm(join(PROJECT_TEMPLATE_DIR(cwd), fileName));
			deleted = true;
		} catch {
			// not in project
		}
	}

	try {
		await rm(join(GLOBAL_TEMPLATE_DIR(), fileName));
		deleted = true;
	} catch {
		// not in global
	}

	logForDebugging(`templateManager: delete ${name} result=${deleted}`);
	return deleted;
}

export async function exportTemplate(
	name: string,
	cwd?: string,
): Promise<string | null> {
	const t = await loadTemplate(name, cwd);
	if (!t) return null;
	return JSON.stringify(t, null, 2);
}

export async function importTemplate(
	jsonStr: string,
	scope: "global" | "project" = "global",
	cwd?: string,
): Promise<string> {
	const t = JSON.parse(jsonStr) as WorkflowTemplate;
	if (!t.name) throw new Error("Template must have a name");
	if (!t.steps || !Array.isArray(t.steps) || t.steps.length === 0)
		throw new Error("Template must have at least one step");
	const filePath = await saveTemplate(t, scope, cwd);
	logForDebugging(`templateManager: imported ${t.name}`);
	return filePath;
}
