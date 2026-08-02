import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { basename, isAbsolute, join } from "path";
import { logForDebugging } from "../../utils/debug.js";

type SessionPack = {
	metadata: {
		version: number;
		exported_at: string;
		source_cwd: string;
	};
	session?: {
		file: string;
		content: string;
	};
	memory: Array<{
		file: string;
		content: string;
	}>;
	templates: Array<{
		file: string;
		content: string;
	}>;
	rules: Array<{
		file: string;
		content: string;
	}>;
};

function getConfigHome(): string {
	return process.env.FUSION_CODE_CONFIG_DIR ?? join(homedir(), ".fusion-code");
}

export async function execute(
	args: string,
	getCwd: () => string,
): Promise<string> {
	const parts = args.trim().split(/\s+/);
	const subcommand = parts[0] || "help";
	const rest = parts.slice(1).join(" ");

	switch (subcommand) {
		case "create":
			return handleCreate(rest, getCwd());
		case "load":
			return handleLoad(rest, getCwd());
		case "help":
		default:
			return usage();
	}
}

function usage(): string {
	return [
		"/session-pack — Full session asset packaging",
		"",
		"Usage:",
		"  /session-pack create [output_dir]  Pack session + memory + templates + rules",
		"  /session-pack load <pack_file>     Import a session pack",
		"",
		"Pack format: JSON with session, memory, templates, and rules",
	].join("\n");
}

async function handleCreate(outputDir: string, cwd: string): Promise<string> {
	const pack: SessionPack = {
		metadata: {
			version: 1,
			exported_at: new Date().toISOString(),
			source_cwd: basename(cwd),
		},
		session: undefined,
		memory: [],
		templates: [],
		rules: [],
	};

	// Collect memory files
	const configHome = getConfigHome();
	const memoryDir = join(
		configHome,
		"projects",
		cwd.replace(/\//g, "-"),
		"memory",
	);
	try {
		const files = await readdir(memoryDir);
		for (const f of files) {
			if (!f.endsWith(".md")) continue;
			try {
				const content = await readFile(join(memoryDir, f), "utf-8");
				pack.memory.push({ file: f, content });
			} catch {
				logForDebugging(`session-pack: skipped memory ${f}`);
			}
		}
	} catch {
		logForDebugging("session-pack: no memory dir");
	}

	// Collect templates (global)
	const templateDir = join(configHome, "templates");
	try {
		const files = await readdir(templateDir);
		for (const f of files) {
			if (!f.endsWith(".json")) continue;
			try {
				const content = await readFile(join(templateDir, f), "utf-8");
				pack.templates.push({ file: f, content });
			} catch {
				logForDebugging(`session-pack: skipped template ${f}`);
			}
		}
	} catch {
		logForDebugging("session-pack: no templates dir");
	}

	// Collect project templates
	const projTemplateDir = join(cwd, ".fusion", "templates");
	try {
		const files = await readdir(projTemplateDir);
		for (const f of files) {
			if (!f.endsWith(".json")) continue;
			try {
				const content = await readFile(join(projTemplateDir, f), "utf-8");
				pack.templates.push({ file: `project/${f}`, content });
			} catch {
				logForDebugging(`session-pack: skipped project template ${f}`);
			}
		}
	} catch {
		logForDebugging("session-pack: no project templates dir");
	}

	// Collect rules (FUSION.rules + CLAUDE.md)
	const ruleFiles = ["FUSION.rules", "CLAUDE.md"];
	for (const rf of ruleFiles) {
		// Global
		try {
			const content = await readFile(join(configHome, rf), "utf-8");
			pack.rules.push({ file: `global/${rf}`, content });
		} catch {
			// not found
		}
		// Project
		try {
			const content = await readFile(join(cwd, rf), "utf-8");
			pack.rules.push({ file: `project/${rf}`, content });
		} catch {
			// not found
		}
	}

	// Write pack
	const outDir = outputDir || cwd;
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const packFile = join(
		outDir,
		`session-pack-${basename(cwd)}-${timestamp}.json`,
	);
	await mkdir(outDir, { recursive: true });
	await writeFile(packFile, JSON.stringify(pack, null, 2), "utf-8");

	const summary = [
		`✅ Session pack created: ${packFile}`,
		`   Memory files: ${pack.memory.length}`,
		`   Templates: ${pack.templates.length}`,
		`   Rules: ${pack.rules.length}`,
	].join("\n");

	logForDebugging(`session-pack: created ${packFile}`);
	return summary;
}

async function handleLoad(packFile: string, cwd: string): Promise<string> {
	if (!packFile) return "Usage: /session-pack load <pack_file>";

	let raw: string;
	try {
		raw = await readFile(packFile, "utf-8");
	} catch {
		return `File not found: ${packFile}`;
	}

	let pack: SessionPack;
	try {
		pack = JSON.parse(raw) as SessionPack;
	} catch {
		return "Invalid pack file: not valid JSON";
	}

	const configHome = getConfigHome();
	let imported = 0;

	// Restore memory
	if (pack.memory.length > 0) {
		const memoryDir = join(
			configHome,
			"projects",
			cwd.replace(/\//g, "-"),
			"memory",
		);
		await mkdir(memoryDir, { recursive: true });
		for (const m of pack.memory) {
			const safeName = basename(m.file);
			if (safeName !== m.file || isAbsolute(m.file)) {
				logForDebugging(`session-pack: skipping unsafe memory path: ${m.file}`);
				continue;
			}
			await writeFile(join(memoryDir, safeName), m.content, "utf-8");
			imported++;
		}
	}

	// Restore templates
	if (pack.templates.length > 0) {
		for (const t of pack.templates) {
			const dir = t.file.startsWith("project/")
				? join(cwd, ".fusion", "templates")
				: join(configHome, "templates");
			await mkdir(dir, { recursive: true });
			await writeFile(join(dir, basename(t.file)), t.content, "utf-8");
			imported++;
		}
	}

	// Restore rules
	if (pack.rules.length > 0) {
		for (const r of pack.rules) {
			const dir = r.file.startsWith("global/") ? configHome : cwd;
			await writeFile(join(dir, basename(r.file)), r.content, "utf-8");
			imported++;
		}
	}

	logForDebugging(`session-pack: loaded ${imported} items from ${packFile}`);
	return `✅ Session pack loaded: ${imported} items imported\n   Memory: ${pack.memory.length}, Templates: ${pack.templates.length}, Rules: ${pack.rules.length}`;
}
