import {
	getBuiltinTemplate,
	getBuiltinTemplates,
} from "../../services/workflowTemplates/builtinTemplates.js";
import {
	deleteTemplate,
	exportTemplate,
	importTemplate,
	listTemplates,
	loadTemplate,
	saveTemplate,
	type WorkflowTemplate,
} from "../../services/workflowTemplates/templateManager.js";
import { logForDebugging } from "../../utils/debug.js";

function parseArgs(args: string): {
	subcommand: string;
	rest: string;
} {
	const parts = args.trim().split(/\s+/);
	const subcommand = parts[0] || "list";
	const rest = parts.slice(1).join(" ");
	return { subcommand, rest };
}

export async function execute(args: string, cwd?: string): Promise<string> {
	const { subcommand, rest } = parseArgs(args);

	switch (subcommand) {
		case "list":
		case "ls":
			return handleList(cwd);
		case "show":
		case "get":
			return handleShow(rest, cwd);
		case "save":
			return handleSave(rest, cwd);
		case "delete":
		case "rm":
			return handleDelete(rest, cwd);
		case "export":
			return handleExport(rest, cwd);
		case "import":
			return handleImport(rest, cwd);
		case "builtin":
			return handleBuiltin();
		case "help":
		default:
			return usage();
	}
}

function usage(): string {
	return [
		"/template — Workflow template management",
		"",
		"Usage:",
		"  /template list              List saved templates",
		"  /template builtin           List built-in templates",
		"  /template show <name>       Show template details",
		"  /template save <name>       Save current workflow as template",
		"  /template delete <name>     Delete a template",
		"  /template export <name>     Export template as JSON",
		"  /template import <json>     Import template from JSON",
	].join("\n");
}

async function handleList(cwd?: string): Promise<string> {
	const templates = await listTemplates(cwd);
	const builtins = getBuiltinTemplates();
	const lines: string[] = ["📋 Workflow Templates", ""];

	if (builtins.length > 0) {
		lines.push("Built-in:");
		for (const t of builtins) {
			lines.push(`  • ${t.name} — ${t.description} (${t.steps.length} steps)`);
		}
		lines.push("");
	}

	if (templates.length > 0) {
		lines.push("Saved:");
		for (const t of templates) {
			const scope = t.created_at ? "" : " [builtin]";
			lines.push(
				`  • ${t.name} — ${t.description} (${t.steps.length} steps)${scope}`,
			);
		}
	} else {
		lines.push("No saved templates. Use /template builtin to see built-ins.");
	}

	return lines.join("\n");
}

async function handleShow(name: string, cwd?: string): Promise<string> {
	if (!name) return "Usage: /template show <name>";

	const builtin = getBuiltinTemplate(name);
	const saved = await loadTemplate(name, cwd);
	const t = saved ?? builtin;

	if (!t)
		return `Template "${name}" not found. Use /template list to see available templates.`;

	const lines: string[] = [
		`📄 Template: ${t.name}`,
		`   Category: ${t.category}`,
		`   Description: ${t.description}`,
		"",
		"Steps:",
	];
	for (let i = 0; i < t.steps.length; i++) {
		const s = t.steps[i];
		const tools = s.tools ? ` [${s.tools.join(", ")}]` : "";
		lines.push(`  ${i + 1}. ${s.title}${tools}`);
		lines.push(`     ${s.prompt}`);
	}

	logForDebugging(`template: show ${name}`);
	return lines.join("\n");
}

async function handleSave(rest: string, cwd?: string): Promise<string> {
	const parts = rest.split(/\s+/);
	const name = parts[0];
	if (!name) return "Usage: /template save <name> [description]";

	const description = parts.slice(1).join(" ") || `Custom template: ${name}`;
	const template: WorkflowTemplate = {
		name,
		description,
		category: "custom",
		steps: [
			{
				title: "Step 1",
				prompt: `Execute workflow: ${name}`,
			},
		],
	};

	const filePath = await saveTemplate(template, "global", cwd);
	logForDebugging(`template: saved ${name}`);
	return `✅ Template "${name}" saved to ${filePath}`;
}

async function handleDelete(name: string, cwd?: string): Promise<string> {
	if (!name) return "Usage: /template delete <name>";

	const deleted = await deleteTemplate(name, cwd);
	if (deleted) {
		logForDebugging(`template: deleted ${name}`);
		return `✅ Template "${name}" deleted`;
	}
	return `Template "${name}" not found.`;
}

async function handleExport(name: string, cwd?: string): Promise<string> {
	if (!name) return "Usage: /template export <name>";

	const builtin = getBuiltinTemplate(name);
	const saved = await loadTemplate(name, cwd);
	const t = saved ?? builtin;

	if (!t) return `Template "${name}" not found.`;

	const json = JSON.stringify(t, null, 2);
	logForDebugging(`template: exported ${name}`);
	return json;
}

async function handleImport(jsonStr: string, cwd?: string): Promise<string> {
	if (!jsonStr) return "Usage: /template import <json-string>";

	try {
		const filePath = await importTemplate(jsonStr, "global", cwd);
		logForDebugging(`template: imported to ${filePath}`);
		return `✅ Template imported to ${filePath}`;
	} catch (e) {
		return `Import failed: ${(e as Error).message}`;
	}
}

function handleBuiltin(): string {
	const builtins = getBuiltinTemplates();
	const lines: string[] = ["📋 Built-in Templates", ""];

	for (const t of builtins) {
		lines.push(`  • ${t.name} — ${t.description}`);
		lines.push(`    Category: ${t.category}, Steps: ${t.steps.length}`);
	}

	return lines.join("\n");
}
