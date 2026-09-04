// Visual-Feedback Protocol (issue #216) — stable JSON schema for osagent-driven
// UI verification. fusion-code consumes structured error reports from
// fusion-osagent's code-debug loop (F5.2) and triggers the auto-fix agent.
//
// Schema mirrors fusion-osagent loops/code_debug.py report shape so both sides
// agree. Backward-compat: unknown extra fields tolerated (validated subset).

/** 单个失败步骤的视觉验证缺陷记录。 */
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

/** osagent 视觉验证报告根对象 (issue #216 协议)。 */
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

/** Ingest 校验结果。 */
export interface VisualFeedbackIngestResult {
    /** 是否通过 schema 校验。 */
    valid: boolean;
    /** 校验失败原因 (valid=false 时填)。 */
    error?: string;
    /** 解析后的报告 (valid=true 时填)。 */
    report?: VisualFeedbackReport;
    /** auto-fix agent 是否已触发 (仅 status=fail 且 --auto-fix 时)。 */
    autoFixTriggered?: boolean;
}
