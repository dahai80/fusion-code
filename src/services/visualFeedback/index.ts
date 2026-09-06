// Visual-Feedback Protocol (issue #216/#217) — ingest + validate + normalize +
// re-fix plan 生成。
//
// fusion-osagent 的 code-debug loop (F5.2) 生成 VisualFeedbackReport JSON,
// 本模块提供:
//   1. validateReport — schema 校验 + 归一化 (1.1 osagent-native / 1.0 legacy)
//      纯函数, 无副作用, 返回 NormalizedVisualFeedback
//   2. ingestVisualFeedback — 从文件/stdin 读取 + 校验 + 可选触发 auto-fix
//   3. formatDefectsForAgent — 缺陷清单格式化为 auto-fix agent prompt 段
//   4. buildFixPlan — 生成无状态 re-fix 工作流计划 (build/rerun/reverify)
//
// auto-fix 触发策略: 默认仅校验 + 输出结构化摘要 (non-blocking); 当 autoFix=true
// 时落盘报告到 ~/.fusion-code/visual-feedback/ 并输出 CLI 指令供上层编排器
// (fusion-osagent / CI) 启动修复 agent。不在本进程内直接拉起 REPL agent —
// 保持 CLI handler 无状态, 让编排器决定修复流程 (与 trajectory train 同构)。

import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

import { logError } from "../../utils/log.js";
import { getClaudeConfigHomeDir } from "../../utils/envUtils.js";
import type {
    NormalizedVisualFeedback,
    VisualFeedbackDefectV11,
    VisualFeedbackFixPlan,
    VisualFeedbackIngestResult,
} from "./types.js";

export type {
    NormalizedVisualFeedback,
    VisualFeedbackDefect,
    VisualFeedbackDefectV11,
    VisualFeedbackFixPlan,
    VisualFeedbackIngestResult,
    VisualFeedbackReport,
    VisualFeedbackReportV11,
} from "./types.js";

/** 报告落盘目录: ~/.fusion-code/visual-feedback/ */
export function getVisualFeedbackDir(): string {
    return join(getClaudeConfigHomeDir(), "visual-feedback");
}

/** 当前规范协议版本 (osagent-native shape)。 */
export const SCHEMA_VERSION = "1.1";
/** 仍可接受的 legacy 协议版本 (#216)。 */
const LEGACY_SCHEMA_VERSION = "1.0";
const ACCEPTED_VERSIONS = new Set([SCHEMA_VERSION, LEGACY_SCHEMA_VERSION]);

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

/** 校验 + 归一化报告 (issue #216/#217 协议)。纯函数。
 *  接受 1.1 (osagent-native) 与 1.0 (legacy #216), 统一归一为 1.1 语义。 */
export function validateReport(raw: unknown): {
    valid: boolean;
    error?: string;
    report?: NormalizedVisualFeedback;
} {
    if (typeof raw !== "object" || raw === null) {
        return { valid: false, error: "report must be a JSON object" };
    }
    const r = raw as Record<string, unknown>;
    if (typeof r.schema_version !== "string") {
        return { valid: false, error: "schema_version must be a string" };
    }
    if (!ACCEPTED_VERSIONS.has(r.schema_version)) {
        return {
            valid: false,
            error:
                "schema_version " +
                String(r.schema_version) +
                " unsupported (expected " +
                SCHEMA_VERSION +
                " or " +
                LEGACY_SCHEMA_VERSION +
                ")",
        };
    }

    if (r.schema_version === LEGACY_SCHEMA_VERSION) {
        return validateLegacy(r);
    }
    return validateV11(r);
}

/** 校验 1.1 osagent-native 形状并归一。 */
function validateV11(r: Record<string, unknown>): {
    valid: boolean;
    error?: string;
    report?: NormalizedVisualFeedback;
} {
    if (typeof r.ok !== "boolean") {
        return { valid: false, error: "ok must be a boolean" };
    }
    if (typeof r.app !== "string") {
        return { valid: false, error: "app must be a string" };
    }
    if (typeof r.action_query !== "string") {
        return { valid: false, error: "action_query must be a string" };
    }
    if (typeof r.reason !== "string") {
        return { valid: false, error: "reason must be a string" };
    }
    if (typeof r.has_error_frame !== "boolean") {
        return { valid: false, error: "has_error_frame must be a boolean" };
    }
    if (!Array.isArray(r.defects)) {
        return { valid: false, error: "defects must be an array" };
    }
    const defects: VisualFeedbackDefectV11[] = [];
    for (let i = 0; i < r.defects.length; i++) {
        const d = r.defects[i] as Record<string, unknown> | null;
        const prefix = "defects[" + i + "]";
        if (typeof d !== "object" || d === null) {
            return { valid: false, error: prefix + " must be an object" };
        }
        if (
            typeof d.type !== "string" ||
            !VALID_KINDS.has(d.type)
        ) {
            return {
                valid: false,
                error: prefix + ".type has invalid value: " + String(d.type),
            };
        }
        if (typeof d.description !== "string" || !d.description) {
            return {
                valid: false,
                error: prefix + ".description must be a non-empty string",
            };
        }
        defects.push({
            type: d.type as VisualFeedbackDefectV11["type"],
            description: d.description,
            region: typeof d.region === "string" ? d.region : undefined,
            selector: typeof d.selector === "string" ? d.selector : undefined,
            screenshot_b64:
                typeof d.screenshot_b64 === "string"
                    ? d.screenshot_b64
                    : undefined,
        });
    }
    const report: NormalizedVisualFeedback = {
        schema_version: SCHEMA_VERSION,
        ok: r.ok,
        app: r.app,
        action_query: r.action_query,
        reason: r.reason,
        defects,
        has_error_frame: r.has_error_frame,
        error_frame: typeof r.error_frame === "string" ? r.error_frame : undefined,
        task_id: typeof r.task_id === "string" ? r.task_id : undefined,
        timestamp: typeof r.timestamp === "string" ? r.timestamp : undefined,
    };
    return { valid: true, report };
}

/** 校验 1.0 legacy 形状 (#216) 并归一为 1.1 语义。 */
function validateLegacy(r: Record<string, unknown>): {
    valid: boolean;
    error?: string;
    report?: NormalizedVisualFeedback;
} {
    if (typeof r.task_id !== "string" || !r.task_id) {
        return { valid: false, error: "task_id must be a non-empty string" };
    }
    if (typeof r.status !== "string" || (r.status !== "pass" && r.status !== "fail")) {
        return {
            valid: false,
            error: "status must be 'pass' or 'fail', got " + String(r.status),
        };
    }
    if (!Array.isArray(r.failed_steps)) {
        return { valid: false, error: "failed_steps must be an array" };
    }
    const defects: VisualFeedbackDefectV11[] = [];
    for (let i = 0; i < r.failed_steps.length; i++) {
        const s = r.failed_steps[i] as Record<string, unknown> | null;
        const prefix = "failed_steps[" + i + "]";
        if (typeof s !== "object" || s === null) {
            return { valid: false, error: prefix + " must be an object" };
        }
        if (typeof s.step !== "string" || !s.step) {
            return {
                valid: false,
                error: prefix + ".step must be a non-empty string",
            };
        }
        if (typeof s.expected !== "string") {
            return { valid: false, error: prefix + ".expected must be a string" };
        }
        if (typeof s.actual !== "string") {
            return { valid: false, error: prefix + ".actual must be a string" };
        }
        if (typeof s.kind !== "string" || !VALID_KINDS.has(s.kind)) {
            return {
                valid: false,
                error: prefix + ".kind has invalid value: " + String(s.kind),
            };
        }
        defects.push({
            type: s.kind as VisualFeedbackDefectV11["type"],
            description:
                s.step +
                " | expected: " +
                s.expected +
                " | actual: " +
                s.actual,
            selector: typeof s.selector === "string" ? s.selector : undefined,
            screenshot_b64:
                typeof s.screenshot_b64 === "string" ? s.screenshot_b64 : undefined,
        });
    }
    const status = r.status as "pass" | "fail";
    const suggestedFixArea =
        typeof r.suggested_fix_area === "string" ? r.suggested_fix_area : undefined;
    const report: NormalizedVisualFeedback = {
        schema_version: SCHEMA_VERSION,
        ok: status === "pass",
        app: typeof r.target === "string" ? r.target : "",
        action_query:
            defects.length > 0 ? defects[0].description.split(" | ")[0] : "",
        reason: status === "pass" ? "" : defects.map((d) => d.description).join("; "),
        defects,
        has_error_frame:
            typeof r.screenshot_b64 === "string" && !!r.screenshot_b64,
        task_id: r.task_id,
        suggested_fix_area: suggestedFixArea,
        timestamp: typeof r.timestamp === "string" ? r.timestamp : undefined,
    };
    return { valid: true, report };
}

/** 将归一化缺陷清单格式化为 auto-fix agent 可读的 prompt 段。 */
export function formatDefectsForAgent(report: NormalizedVisualFeedback): string {
    const lines: string[] = [];
    lines.push("<visual_feedback>");
    if (report.task_id) lines.push("task_id: " + report.task_id);
    lines.push("ok: " + String(report.ok));
    if (report.app) lines.push("app: " + report.app);
    if (report.action_query) lines.push("action_query: " + report.action_query);
    if (report.reason) lines.push("reason: " + report.reason);
    if (report.suggested_fix_area) {
        lines.push("suggested_fix_area: " + report.suggested_fix_area);
    }
    if (report.has_error_frame && report.error_frame) {
        lines.push("error_frame: " + report.error_frame);
    }
    if (report.defects.length === 0) {
        lines.push("no_defects");
    } else {
        for (const d of report.defects) {
            lines.push("defect:");
            lines.push("  type: " + d.type);
            lines.push("  description: " + d.description);
            if (d.region) lines.push("  region: " + d.region);
            if (d.selector) lines.push("  selector: " + d.selector);
            if (d.screenshot_b64) {
                lines.push("  screenshot: <base64 " + d.screenshot_b64.length + " bytes>");
            }
        }
    }
    lines.push("</visual_feedback>");
    return lines.join("\n");
}

/** 探测项目构建命令 (按常见工程类型)。纯函数, 无 fs 读取 (调用方已知 cwd)。 */
export function detectBuildCmd(cwd: string): string {
    if (existsSync(join(cwd, "package.json"))) {
        if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) {
            return "bun run build";
        }
        if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm build";
        if (existsSync(join(cwd, "yarn.lock"))) return "yarn build";
        return "npm run build";
    }
    if (existsSync(join(cwd, "Cargo.toml"))) return "cargo build";
    if (existsSync(join(cwd, "go.mod"))) return "go build ./...";
    if (existsSync(join(cwd, "Makefile"))) return "make";
    return "echo 'no known build system; skip rebuild'";
}

/** 生成无状态 re-fix 工作流计划。fusion-code 只产出 plan, 编排器执行。 */
export function buildFixPlan(
    report: NormalizedVisualFeedback,
    opts?: { cwd?: string; reportPath?: string },
): VisualFeedbackFixPlan {
    const cwd = opts?.cwd ?? process.cwd();
    const fixPrompt = formatDefectsForAgent(report);
    const rebuildCmd = detectBuildCmd(cwd);
    const rerunCmd = report.app
        ? "fusion-code dev --target " + JSON.stringify(report.app)
        : "fusion-code dev";
    const reverifyCmd =
        "fusion-code visual-feedback reverify" +
        (report.task_id ? " --task " + report.task_id : "");
    return {
        task_id: report.task_id ?? "unknown",
        ok: report.ok,
        fix_prompt: fixPrompt,
        rebuild_cmd: rebuildCmd,
        rerun_cmd: rerunCmd,
        reverify_cmd: reverifyCmd,
        report_path: opts?.reportPath,
    };
}

/**
 * Ingest 一份视觉反馈报告。
 * - filePath: 文件路径 ("-" = stdin)
 * - autoFix: true 时格式化 agent prompt 段并标记 triggered (落盘 + 输出)
 * - autoFixLoop: true 时额外生成 buildFixPlan 写入 ingest result
 */
export async function ingestVisualFeedback(opts: {
    filePath: string;
    autoFix?: boolean;
    autoFixLoop?: boolean;
}): Promise<VisualFeedbackIngestResult> {
    const { filePath, autoFix = false, autoFixLoop = false } = opts;
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
    let fixPlan: VisualFeedbackFixPlan | undefined;
    if (autoFix && !report.ok && report.defects.length > 0) {
        const prompt = formatDefectsForAgent(report);
        const safeTaskId = (report.task_id ?? "unknown").replace(
            /[^a-zA-Z0-9_-]/g,
            "_",
        );
        const destPath = join(getVisualFeedbackDir(), safeTaskId + ".txt");
        try {
            const { mkdir, writeFile } = await import("fs/promises");
            await mkdir(getVisualFeedbackDir(), { recursive: true });
            await writeFile(destPath, prompt, "utf-8");
            autoFixTriggered = true;
            if (autoFixLoop) {
                fixPlan = buildFixPlan(report, {
                    cwd: process.cwd(),
                    reportPath: destPath,
                });
            }
        } catch (err) {
            logError(
                new Error(
                    "visual-feedback auto-fix save failed: " +
                        (err as Error).message,
                ),
            );
        }
    } else if (autoFixLoop) {
        fixPlan = buildFixPlan(report, { cwd: process.cwd() });
    }

    return { valid: true, report, autoFixTriggered, fixPlan };
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
