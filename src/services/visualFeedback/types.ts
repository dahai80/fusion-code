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

/** 1.1 defect record (osagent defects[] item). defects[] is list[dict] on
 *  osagent side; we validate the documented subset and tolerate extra keys. */
export interface VisualFeedbackDefectV11 {
	/** Defect type classification (#217: type). */
	type:
		| "visual_mismatch"
		| "element_not_found"
		| "element_not_clickable"
		| "text_not_visible"
		| "layout_broken"
		| "console_error"
		| "runtime_crash"
		| "unknown";
	/** Defect description (#217: description, natural language). */
	description: string;
	/** Failed region (#217: region?, optional — file path / component name / coordinate box). */
	region?: string;
	/** Related DOM selector / XPath (optional, helps the fix locate code). */
	selector?: string;
	/** Screenshot of this defect as base64 (PNG, optional). */
	screenshot_b64?: string;
}

/** 1.0 defect record (legacy #216 failed_steps[] item). */
export interface VisualFeedbackDefect {
	/** Step identifier (step id / selector description within the osagent loop). */
	step: string;
	/** Expected behavior description (natural language, for the auto-fix agent to understand intent). */
	expected: string;
	/** Actually observed behavior (natural language). */
	actual: string;
	/** Defect type classification, easing auto-fix routing. */
	kind:
		| "visual_mismatch"
		| "element_not_found"
		| "element_not_clickable"
		| "text_not_visible"
		| "layout_broken"
		| "console_error"
		| "runtime_crash"
		| "unknown";
	/** Related DOM selector / XPath (optional, helps the fix locate code). */
	selector?: string;
	/** Screenshot of this step as base64 (PNG, optional). */
	screenshot_b64?: string;
}

// ─── 1.1 canonical report (osagent-native) ─────────────────────────

/** 1.1 osagent-native visual feedback report. Mirrors osagent
 *  loops/code_debug.py VisualFeedback.to_json() + write_report sidecar. */
export interface VisualFeedbackReportV11 {
	/** Protocol version, currently "1.1". */
	schema_version: string;
	/** Overall verification result (osagent: ok). */
	ok: boolean;
	/** The app / preview URL being verified (osagent: app). */
	app: string;
	/** Verification action description (osagent: action_query, e.g. "click submit button"). */
	action_query: string;
	/** Failure reason (osagent: reason, empty string means pass). */
	reason: string;
	/** Defect list (osagent: defects, empty array on pass). */
	defects: VisualFeedbackDefectV11[];
	/** Whether an error-frame screenshot exists (osagent: has_error_frame). */
	has_error_frame: boolean;
	/** Error-frame sidecar file path (osagent write_report: *.error.png, optional). */
	error_frame?: string;
	/** Unique task identifier (optional; osagent lacks this field but the protocol recommends it). */
	task_id?: string;
	/** Timestamp the report was generated (ISO 8601, optional). */
	timestamp?: string;
}

// ─── 1.0 legacy report (#216) ──────────────────────────────────────

/** 1.0 legacy osagent visual-verification report root object (#216 protocol, kept for backward compat). */
export interface VisualFeedbackReport {
	/** Protocol version, currently "1.0". */
	schema_version: string;
	/** Unique task identifier, tied to one code-debug run of the osagent loop. */
	task_id: string;
	/** Overall verification result. */
	status: "pass" | "fail";
	/** Failed-step details (empty array when status=pass). */
	failed_steps: VisualFeedbackDefect[];
	/** Full-page screenshot as base64 (optional, usually attached when status=fail). */
	screenshot_b64?: string;
	/** osagent's suggested fix area (file path / component name, optional hint). */
	suggested_fix_area?: string;
	/** The preview URL or app path being verified (optional, context). */
	target?: string;
	/** Timestamp the report was generated (ISO 8601, optional). */
	timestamp?: string;
}

// ─── normalized canonical form (internal) ──────────────────────────

/** Validated canonical form — whether the input is 1.0 or 1.1, normalized to 1.1 semantics. */
export interface NormalizedVisualFeedback {
	/** Original protocol version. */
	schema_version: string;
	/** Overall verification result. */
	ok: boolean;
	/** The app / preview URL being verified. */
	app: string;
	/** Verification action description. */
	action_query: string;
	/** Failure reason (empty string means pass). */
	reason: string;
	/** Defect list (already normalized to the 1.1 defect shape). */
	defects: VisualFeedbackDefectV11[];
	/** Whether an error-frame screenshot exists. */
	has_error_frame: boolean;
	/** Error-frame sidecar file path (optional). */
	error_frame?: string;
	/** Unique task identifier (optional). */
	task_id?: string;
	/** osagent's suggested fix area (optional). */
	suggested_fix_area?: string;
	/** Timestamp the report was generated (optional). */
	timestamp?: string;
}

// ─── re-fix workflow plan (#217 sub-loop) ──────────────────────────

/** A single re-fix workflow instruction. fusion-code stays stateless: it
 *  only generates the plan; the orchestrator (osagent
 *  code_debug.CodeDebugLoop) executes build/re-run/re-verify. */
export interface VisualFeedbackFixPlan {
	/** The task/app identifier of the associated report. */
	task_id: string;
	/** Current verification status (false = needs fixing). */
	ok: boolean;
	/** Prompt section injected into the fix agent (defect list + context). */
	fix_prompt: string;
	/** Rebuild command (probes project type: bun/npm/pnpm/cargo/go/make etc.). */
	rebuild_cmd: string;
	/** Re-run command (launches the app/preview being verified). */
	rerun_cmd: string;
	/** Re-verify command (osagent drives verify_and_report again). */
	reverify_cmd: string;
	/** Report file path on disk (for the orchestrator to read the agent prompt section, optional). */
	report_path?: string;
}

// ─── ingest result ─────────────────────────────────────────────────

/** Ingest validation result. */
export interface VisualFeedbackIngestResult {
	/** Whether schema validation passed. */
	valid: boolean;
	/** Validation failure reason (filled when valid=false). */
	error?: string;
	/** The normalized report (filled when valid=true). */
	report?: NormalizedVisualFeedback;
	/** Whether the auto-fix agent was triggered (only when ok=false and --auto-fix). */
	autoFixTriggered?: boolean;
	/** The generated re-fix workflow plan (filled with --auto-fix-loop). */
	fixPlan?: VisualFeedbackFixPlan;
}
