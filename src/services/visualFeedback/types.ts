// Visual-Feedback Protocol (issue #216/#217) — stable JSON schema for
// osagent-driven UI verification. fusion-code consumes structured error
// reports from fusion-osagent's code-debug loop (F5.2) and emits a re-fix
// workflow plan the orchestrator (osagent) executes.
//
// Stability contract (semver-ish):
//   - additive optional fields: OK (non-breaking)
//   - rename/remove required field: breaking (bump schema_version)
//   - validators tolerate unknown extra fields (osagent raw[] spread is free)
//
// Two accepted shapes, both versioned:
//   - "1.1" (canonical, osagent-native): ok / app / action_query / defects /
//     error_frame / reason / has_error_frame. Matches osagent
//     loops/code_debug.py VisualFeedback.to_json() exactly.
//   - "1.0" (legacy #216): status / failed_steps / screenshot_b64 /
//     suggested_fix_area / target. Kept for backward compat; normalized to
//     1.1 internally.

// ─── shared defect (per-failure detail) ────────────────────────────

/** 1.1 缺陷记录 (osagent defects[] 项)。defects[] is list[dict] on osagent
 *  side; we validate the documented subset and tolerate extra keys. */
export interface VisualFeedbackDefectV11 {
    /** 缺陷类型分类 (#217: type)。 */
    type:
        | "visual_mismatch"
        | "element_not_found"
        | "element_not_clickable"
        | "text_not_visible"
        | "layout_broken"
        | "console_error"
        | "runtime_crash"
        | "unknown";
    /** 缺陷描述 (#217: description, 自然语言)。 */
    description: string;
    /** 失败区域 (#217: region?, 可选 — 文件路径/组件名/坐标框)。 */
    region?: string;
    /** 相关 DOM selector / XPath (可选, 供 fix 定位代码)。 */
    selector?: string;
    /** 该缺陷截图 base64 (PNG, 可选)。 */
    screenshot_b64?: string;
}

/** 1.0 缺陷记录 (legacy #216 failed_steps[] 项)。 */
export interface VisualFeedbackDefect {
    /** 步骤标识 (osagent loop 中的 step id / selector description)。 */
    step: string;
    /** 期望行为描述 (自然语言, 供 auto-fix agent 理解意图)。 */
    expected: string;
    /** 实际观测行为 (自然语言)。 */
    actual: string;
    /** 缺陷类型分类, 便于 auto-fix 路由。 */
    kind:
        | "visual_mismatch"
        | "element_not_found"
        | "element_not_clickable"
        | "text_not_visible"
        | "layout_broken"
        | "console_error"
        | "runtime_crash"
        | "unknown";
    /** 相关 DOM selector / XPath (可选, 供 fix 定位代码)。 */
    selector?: string;
    /** 该步骤截图 base64 (PNG, 可选)。 */
    screenshot_b64?: string;
}

// ─── 1.1 canonical report (osagent-native) ─────────────────────────

/** 1.1 osagent-native 视觉反馈报告。镜像 osagent
 *  loops/code_debug.py VisualFeedback.to_json() + write_report sidecar。 */
export interface VisualFeedbackReportV11 {
    /** 协议版本, 当前 "1.1"。 */
    schema_version: string;
    /** 整体验证结果 (osagent: ok)。 */
    ok: boolean;
    /** 被验证的 app / preview URL (osagent: app)。 */
    app: string;
    /** 验证动作描述 (osagent: action_query, e.g. "click submit button")。 */
    action_query: string;
    /** 失败原因 (osagent: reason, 空串表示 pass)。 */
    reason: string;
    /** 缺陷清单 (osagent: defects, pass 时为空数组)。 */
    defects: VisualFeedbackDefectV11[];
    /** 是否有错误帧截图 (osagent: has_error_frame)。 */
    has_error_frame: boolean;
    /** 错误帧 sidecar 文件路径 (osagent write_report: *.error.png, 可选)。 */
    error_frame?: string;
    /** 任务唯一标识 (可选, osagent 无此字段但协议推荐)。 */
    task_id?: string;
    /** 生成报告的时间戳 (ISO 8601, 可选)。 */
    timestamp?: string;
}

// ─── 1.0 legacy report (#216) ──────────────────────────────────────

/** 1.0 legacy osagent 视觉验证报告根对象 (#216 协议, 保留向后兼容)。 */
export interface VisualFeedbackReport {
    /** 协议版本, 当前 "1.0"。 */
    schema_version: string;
    /** 任务唯一标识, 关联 osagent loop 的一次 code-debug 运行。 */
    task_id: string;
    /** 整体验证结果。 */
    status: "pass" | "fail";
    /** 失败步骤明细 (status=pass 时为空数组)。 */
    failed_steps: VisualFeedbackDefect[];
    /** 全页截图 base64 (可选, status=fail 时通常附)。 */
    screenshot_b64?: string;
    /** osagent 建议的修复区域 (文件路径 / 组件名, 可选提示)。 */
    suggested_fix_area?: string;
    /** 被验证的 preview URL 或 app 路径 (可选, 上下文)。 */
    target?: string;
    /** 生成报告的时间戳 (ISO 8601, 可选)。 */
    timestamp?: string;
}

// ─── normalized canonical form (internal) ──────────────────────────

/** 校验后的规范形式 — 无论输入 1.0 还是 1.1, 统一为 1.1 语义。 */
export interface NormalizedVisualFeedback {
    /** 原始协议版本。 */
    schema_version: string;
    /** 整体验证结果。 */
    ok: boolean;
    /** 被验证的 app / preview URL。 */
    app: string;
    /** 验证动作描述。 */
    action_query: string;
    /** 失败原因 (空串表示 pass)。 */
    reason: string;
    /** 缺陷清单 (已归一为 1.1 defect 形状)。 */
    defects: VisualFeedbackDefectV11[];
    /** 是否有错误帧截图。 */
    has_error_frame: boolean;
    /** 错误帧 sidecar 文件路径 (可选)。 */
    error_frame?: string;
    /** 任务唯一标识 (可选)。 */
    task_id?: string;
    /** osagent 建议的修复区域 (可选)。 */
    suggested_fix_area?: string;
    /** 生成报告的时间戳 (可选)。 */
    timestamp?: string;
}

// ─── re-fix workflow plan (#217 sub-loop) ──────────────────────────

/** 单条 re-fix 工作流指令。fusion-code 保持无状态: 只生成 plan, 由
 *  编排器 (osagent code_debug.CodeDebugLoop) 执行 build/re-run/re-verify。 */
export interface VisualFeedbackFixPlan {
    /** 关联报告的 task/app 标识。 */
    task_id: string;
    /** 当前验证状态 (false = 需修复)。 */
    ok: boolean;
    /** 注入给修复 agent 的 prompt 段 (含缺陷清单 + 上下文)。 */
    fix_prompt: string;
    /** 重建命令 (探测项目类型: bun/npm/pnpm/cargo/go/make 等)。 */
    rebuild_cmd: string;
    /** 重新运行命令 (启动被验证 app/preview)。 */
    rerun_cmd: string;
    /** 重新验证命令 (osagent 再次驱动 verify_and_report)。 */
    reverify_cmd: string;
    /** 报告落盘路径 (供编排器读取 agent prompt 段, 可选)。 */
    report_path?: string;
}

// ─── ingest result ─────────────────────────────────────────────────

/** Ingest 校验结果。 */
export interface VisualFeedbackIngestResult {
    /** 是否通过 schema 校验。 */
    valid: boolean;
    /** 校验失败原因 (valid=false 时填)。 */
    error?: string;
    /** 归一化后的报告 (valid=true 时填)。 */
    report?: NormalizedVisualFeedback;
    /** auto-fix agent 是否已触发 (仅 ok=false 且 --auto-fix 时)。 */
    autoFixTriggered?: boolean;
    /** 生成的 re-fix 工作流计划 (--auto-fix-loop 时填)。 */
    fixPlan?: VisualFeedbackFixPlan;
}
