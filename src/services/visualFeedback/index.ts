// Visual-Feedback Protocol (issue #216) — ingest + validate + auto-fix 触发。
//
// fusion-osagent 的 code-debug loop (F5.2) 生成 VisualFeedbackReport JSON,
// 本模块提供:
//   1. validateVisualFeedbackReport — schema 校验 (纯函数, 无副作用)
//   2. ingestVisualFeedback — 从文件/stdin 读取 + 校验 + 可选触发 auto-fix
//   3. formatDefectsForAgent — 将缺陷清单格式化为 auto-fix agent 可读的 prompt 段
//
// auto-fix 触发策略: 默认仅校验 + 输出结构化摘要 (non-blocking); 当 autoFix=true
// 时落盘报告到 ~/.fusion-code/visual-feedback/ 并输出 CLI 指令供上层编排器
// (fusion-osagent / CI) 启动修复 agent。不在本进程内直接拉起 REPL agent —
// 保持 CLI handler 无状态, 让编排器决定修复流程 (与 trajectory train 同构)。

import { readFile } from "fs/promises";
import { join } from "path";

import { logError } from "../../utils/log.js";
import { getClaudeConfigHomeDir } from "../../utils/envUtils.js";
import type {
    VisualFeedbackDefect,
    VisualFeedbackIngestResult,
    VisualFeedbackReport,
} from "./types.js";

export type {
    VisualFeedbackDefect,
    VisualFeedbackIngestResult,
    VisualFeedbackReport,
} from "./types.js";

/** 报告落盘目录: ~/.fusion-code/visual-feedback/ */
export function getVisualFeedbackDir(): string {
    return join(getClaudeConfigHomeDir(), "visual-feedback");
}

const SCHEMA_VERSION = "1.0";
const VALID_STATUSES = new Set(["pass", "fail"]);
const VALID_KINDS = new Set([
    "visual_mismatch",
    "element_not_found",
    "element_not_clickable",
    "text_not_visible",
    "layout_broken",
    "console_error",
    "runtime_crash",
    "unknown",
]);

/** 校验报告 schema (issue #216 协议)。纯函数。 */
export function validateReport(raw: unknown): {
    valid: boolean;
    error?: string;
    report?: VisualFeedbackReport;
} {
    if (typeof raw !== "object" || raw === null) {
        return { valid: false, error: "report must be a JSON object" };
    }
    const r = raw as Record<string, unknown>;
    if (typeof r.schema_version !== "string") {
        return { valid: false, error: "schema_version must be a string" };
    }
    if (r.schema_version !== SCHEMA_VERSION) {
        return {
            valid: false,
            error:
                "schema_version " +
                String(r.schema_version) +
                " unsupported (expected " +
                SCHEMA_VERSION +
                ")",
        };
    }
    if (typeof r.task_id !== "string" || !r.task_id) {
        return { valid: false, error: "task_id must be a non-empty string" };
    }
    if (typeof r.status !== "string" || !VALID_STATUSES.has(r.status)) {
        return {
            valid: false,
            error: "status must be 'pass' or 'fail', got " + String(r.status),
        };
    }
    if (!Array.isArray(r.failed_steps)) {
        return { valid: false, error: "failed_steps must be an array" };
    }
    for (let i = 0; i < r.failed_steps.length; i++) {
        const step = r.failed_steps[i] as Record<string, unknown>;
        const prefix = "failed_steps[" + i + "]";
        if (typeof step?.step !== "string" || !step.step) {
            return {
                valid: false,
                error: prefix + ".step must be a non-empty string",
            };
        }
        if (typeof step.expected !== "string") {
            return {
                valid: false,
                error: prefix + ".expected must be a string",
            };
        }
        if (typeof step.actual !== "string") {
            return { valid: false, error: prefix + ".actual must be a string" };
        }
        if (
            typeof step.kind !== "string" ||
            !VALID_KINDS.has(step.kind)
        ) {
            return {
                valid: false,
                error: prefix + ".kind has invalid value: " + String(step.kind),
            };
        }
    }
    const report: VisualFeedbackReport = {
        schema_version: r.schema_version,
        task_id: r.task_id,
        status: r.status as "pass" | "fail",
        failed_steps: r.failed_steps as VisualFeedbackDefect[],
        screenshot_b64: typeof r.screenshot_b64 === "string" ? r.screenshot_b64 : undefined,
        suggested_fix_area: typeof r.suggested_fix_area === "string" ? r.suggested_fix_area : undefined,
        target: typeof r.target === "string" ? r.target : undefined,
        timestamp: typeof r.timestamp === "string" ? r.timestamp : undefined,
    };
    return { valid: true, report };
}

/** 将缺陷清单格式化为 auto-fix agent 可读的 prompt 段。 */
export function formatDefectsForAgent(report: VisualFeedbackReport): string {
    const lines: string[] = [];
    lines.push("<visual_feedback>");
    lines.push("task_id: " + report.task_id);
    lines.push("status: " + report.status);
    if (report.target) lines.push("target: " + report.target);
    if (report.suggested_fix_area) {
        lines.push("suggested_fix_area: " + report.suggested_fix_area);
    }
    if (report.failed_steps.length === 0) {
        lines.push("no_failed_steps");
    } else {
        for (const d of report.failed_steps) {
            lines.push("defect:");
            lines.push("  step: " + d.step);
            lines.push("  kind: " + d.kind);
            lines.push("  expected: " + d.expected);
            lines.push("  actual: " + d.actual);
            if (d.selector) lines.push("  selector: " + d.selector);
            if (d.screenshot_b64) {
                lines.push("  screenshot: <base64 " + d.screenshot_b64.length + " bytes>");
            }
        }
    }
    lines.push("</visual_feedback>");
    return lines.join("\n");
}

/**
 * Ingest 一份视觉反馈报告。
 * - source: 文件路径 ("-" = stdin, 当前实现按文件读取; stdin 由 handler 预读传入)
 * - autoFix: true 时格式化 agent prompt 段并标记 triggered (落盘 + 输出)
 */
export async function ingestVisualFeedback(opts: {
    filePath: string;
    autoFix?: boolean;
}): Promise<VisualFeedbackIngestResult> {
    const { filePath, autoFix = false } = opts;
    let raw: string;
    try {
        if (filePath === "-") {
            raw = await readStdin();
        } else {
            raw = await readFile(filePath, "utf-8");
        }
    } catch (err) {
        logError(new Error("visual-feedback read failed: " + (err as Error).message));
        return {
            valid: false,
            error: "read failed: " + (err as Error).message,
        };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        logError(new Error("visual-feedback JSON parse failed: " + (err as Error).message));
        return {
            valid: false,
            error: "invalid JSON: " + (err as Error).message,
        };
    }

    const v = validateReport(parsed);
    if (!v.valid || !v.report) {
        return { valid: false, error: v.error };
    }

    const report = v.report;

    let autoFixTriggered = false;
    if (autoFix && report.status === "fail" && report.failed_steps.length > 0) {
        const prompt = formatDefectsForAgent(report);
        const destPath = join(
            getVisualFeedbackDir(),
            report.task_id.replace(/[^a-zA-Z0-9_-]/g, "_") + ".txt",
        );
        try {
            const { mkdir, writeFile } = await import("fs/promises");
            await mkdir(getVisualFeedbackDir(), { recursive: true });
            await writeFile(destPath, prompt, "utf-8");
            autoFixTriggered = true;
        } catch (err) {
            logError(
                new Error(
                    "visual-feedback auto-fix save failed: " +
                        (err as Error).message,
                ),
            );
        }
    }

    return { valid: true, report, autoFixTriggered };
}

async function readStdin(): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = "";
        process.stdin.setEncoding("utf-8");
        process.stdin.on("data", (chunk) => (data += chunk));
        process.stdin.on("end", () => resolve(data));
        process.stdin.on("error", reject);
    });
}
