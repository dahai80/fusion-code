// Visual-Feedback Protocol CLI handler (issue #216/#217)
//
// Subcommands:
//   fusion-code visual-feedback ingest <file|-> [--auto-fix] [--auto-fix-loop]
//   fusion-code visual-feedback fix-plan <file|-> [--cwd <dir>]
//   fusion-code visual-feedback reverify [--task <id>]
//   fusion-code visual-feedback schema
//
// ingest: reads the VisualFeedbackReport JSON produced by osagent, validates the schema,
//         optionally with --auto-fix writes the agent prompt section to disk for the orchestrator to start fixing;
//         --auto-fix-loop additionally outputs buildFixPlan JSON for the orchestrator to run the re-fix sub-loop.
// fix-plan: validate only + output the VisualFeedbackFixPlan JSON (not written to disk), for CI orchestration.
// reverify: placeholder command — prints the re-verify flow hint the orchestrator should invoke (actually driven by osagent).
// schema: outputs the 1.1 JSON schema text (for protocol alignment on the osagent side).

import {
	buildFixPlan,
	formatDefectsForAgent,
	ingestVisualFeedback,
} from "../../services/visualFeedback/index.js";

interface ParsedFlags {
	autoFix: boolean;
	autoFixLoop: boolean;
	cwd?: string;
	task?: string;
	positional: string[];
}

function parseFlags(args: string[]): ParsedFlags {
	const out: ParsedFlags = {
		autoFix: false,
		autoFixLoop: false,
		positional: [],
	};
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--auto-fix") out.autoFix = true;
		else if (a === "--auto-fix-loop") out.autoFixLoop = true;
		else if (a === "--cwd") out.cwd = args[++i];
		else if (a === "--task") out.task = args[++i];
		else if (a) out.positional.push(a);
	}
	return out;
}

function usage(): void {
	console.log("Usage:");
	console.log(
		"  fusion-code visual-feedback ingest <file|-> [--auto-fix] [--auto-fix-loop]",
	);
	console.log("  fusion-code visual-feedback fix-plan <file|-> [--cwd <dir>]");
	console.log("  fusion-code visual-feedback reverify [--task <id>]");
	console.log("  fusion-code visual-feedback schema");
}

const SCHEMA_DOC = `{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "VisualFeedbackReport",
  "description": "Visual-Feedback Protocol v1.1 (osagent-native, issue #217). v1.0 (issue #216) accepted as legacy alias.",
  "type": "object",
  "required": ["schema_version", "ok", "app", "action_query", "reason", "defects", "has_error_frame"],
  "properties": {
    "schema_version": { "type": "string", "enum": ["1.1", "1.0"] },
    "ok": { "type": "boolean" },
    "app": { "type": "string", "description": "verified app / preview URL" },
    "action_query": { "type": "string", "description": "verification action, e.g. click submit button" },
    "reason": { "type": "string", "description": "failure reason; empty string when ok=true" },
    "defects": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["type", "description"],
        "properties": {
          "type": { "type": "string", "enum": ["visual_mismatch","element_not_found","element_not_clickable","text_not_visible","layout_broken","console_error","runtime_crash","unknown"] },
          "description": { "type": "string" },
          "region": { "type": "string" },
          "selector": { "type": "string" },
          "screenshot_b64": { "type": "string" }
        }
      }
    },
    "has_error_frame": { "type": "boolean" },
    "error_frame": { "type": "string", "description": "sidecar *.error.png file path" },
    "task_id": { "type": "string" },
    "timestamp": { "type": "string" }
  },
  "legacy_v1.0_alias": {
    "description": "v1.0 fields (status/failed_steps/screenshot_b64/suggested_fix_area/target) accepted and normalized to v1.1 semantics.",
    "status": "string enum pass|fail (maps to ok)",
    "failed_steps": "array of {step,expected,actual,kind,selector?,screenshot_b64?} (maps to defects)",
    "target": "string (maps to app)",
    "suggested_fix_area": "string (preserved)"
  }
}`;

export async function visualFeedbackMain(args: string[]): Promise<void> {
	const sub = args[0]?.toLowerCase();
	const flags = parseFlags(args.slice(1));

	if (sub === "schema") {
		console.log(SCHEMA_DOC);
		return;
	}

	if (sub === "reverify") {
		console.log(
			"reverify is orchestration-driven: fusion-osagent code_debug.CodeDebugLoop " +
				"re-runs verify_and_report after rebuild+rerun.",
		);
		console.log(
			"suggested sequence: " +
				(flags.task ? `task=${flags.task} ` : "") +
				"build -> rerun app -> osagent verify_and_report -> emit new report",
		);
		return;
	}

	if (sub === "fix-plan") {
		const file = flags.positional[0];
		if (!file) {
			console.error("Error: fix-plan requires <file|-> argument");
			usage();
			process.exitCode = 1;
			return;
		}
		const result = await ingestVisualFeedback({ filePath: file });
		if (!result.valid || !result.report) {
			console.error(`Error: ${result.error ?? "invalid report"}`);
			process.exitCode = 1;
			return;
		}
		const plan = buildFixPlan(result.report, {
			cwd: flags.cwd ?? process.cwd(),
		});
		console.log(JSON.stringify(plan, null, 2));
		return;
	}

	if (sub === "ingest") {
		const file = flags.positional[0];
		if (!file) {
			console.error("Error: ingest requires <file|-> argument");
			usage();
			process.exitCode = 1;
			return;
		}
		const result = await ingestVisualFeedback({
			filePath: file,
			autoFix: flags.autoFix,
			autoFixLoop: flags.autoFixLoop,
		});
		if (!result.valid || !result.report) {
			console.error(`Error: ${result.error ?? "invalid report"}`);
			process.exitCode = 1;
			return;
		}
		const report = result.report;
		console.log(
			"ingest ok: task=" +
				(report.task_id ?? "unknown") +
				" ok=" +
				String(report.ok) +
				" defects=" +
				report.defects.length,
		);
		if (result.autoFixTriggered) {
			console.log("auto-fix prompt saved to ~/.fusion-code/visual-feedback/");
		}
		if (!report.ok && report.defects.length > 0) {
			console.log("\n--- agent prompt preview ---");
			console.log(formatDefectsForAgent(report));
		}
		if (result.fixPlan) {
			console.log("\n--- re-fix plan ---");
			console.log(JSON.stringify(result.fixPlan, null, 2));
		}
		return;
	}

	usage();
}
