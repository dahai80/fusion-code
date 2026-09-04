// Visual-Feedback Protocol CLI 处理器 (issue #216)
//
// 子命令:
//   fusion-code visual-feedback ingest <file|-> [--auto-fix]
//   fusion-code visual-feedback schema
//
// ingest: 读取 osagent 生成的 VisualFeedbackReport JSON, 校验 schema,
//         可选 --auto-fix 落盘 agent prompt 段供编排器启动修复。
// schema: 输出 JSON schema 文本 (供 osagent 侧对齐协议)。

import { ingestVisualFeedback } from "../../services/visualFeedback/index.js";
import { formatDefectsForAgent } from "../../services/visualFeedback/index.js";

interface ParsedFlags {
    autoFix: boolean;
    positional: string[];
}

function parseFlags(args: string[]): ParsedFlags {
    const out: ParsedFlags = { autoFix: false, positional: [] };
    for (const a of args) {
        if (a === "--auto-fix") out.autoFix = true;
        else if (a) out.positional.push(a);
    }
    return out;
}

function usage(): void {
    console.log("Usage:");
    console.log("  fusion-code visual-feedback ingest <file|-> [--auto-fix]");
    console.log("  fusion-code visual-feedback schema");
}

const SCHEMA_DOC = `{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "VisualFeedbackReport",
  "type": "object",
  "required": ["schema_version", "task_id", "status", "failed_steps"],
  "properties": {
    "schema_version": { "type": "string", "const": "1.0" },
    "task_id": { "type": "string", "minLength": 1 },
    "status": { "type": "string", "enum": ["pass", "fail"] },
    "failed_steps": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["step", "expected", "actual", "kind"],
        "properties": {
          "step": { "type": "string" },
          "expected": { "type": "string" },
          "actual": { "type": "string" },
          "kind": { "type": "string", "enum": ["visual_mismatch","element_not_found","element_not_clickable","text_not_visible","layout_broken","console_error","runtime_crash","unknown"] },
          "selector": { "type": "string" },
          "screenshot_b64": { "type": "string" }
        }
      }
    },
    "screenshot_b64": { "type": "string" },
    "suggested_fix_area": { "type": "string" },
    "target": { "type": "string" },
    "timestamp": { "type": "string" }
  }
}`;

export async function visualFeedbackMain(args: string[]): Promise<void> {
    const sub = args[0]?.toLowerCase();
    const flags = parseFlags(args.slice(1));

    if (sub === "schema") {
        console.log(SCHEMA_DOC);
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
        });
        if (!result.valid) {
            console.error("Error: " + (result.error ?? "invalid report"));
            process.exitCode = 1;
            return;
        }
        const report = result.report!;
        console.log(
            "ingest ok: task=" +
                report.task_id +
                " status=" +
                report.status +
                " defects=" +
                report.failed_steps.length,
        );
        if (result.autoFixTriggered) {
            console.log("auto-fix prompt saved to ~/.fusion-code/visual-feedback/");
        }
        if (report.status === "fail" && report.failed_steps.length > 0) {
            console.log("\n--- agent prompt preview ---");
            console.log(formatDefectsForAgent(report));
        }
        return;
    }

    usage();
}
