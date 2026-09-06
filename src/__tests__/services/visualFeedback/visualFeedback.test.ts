// Visual-Feedback Protocol (issue #216/#217) — schema 1.1 校验 + 1.0 兼容 +
// normalize + buildFixPlan + ingest 单测。

import { describe, expect, it } from "bun:test";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import {
    buildFixPlan,
    formatDefectsForAgent,
    ingestVisualFeedback,
    validateReport,
} from "../../../services/visualFeedback/index.js";
import type {
    NormalizedVisualFeedback,
    VisualFeedbackReportV11,
} from "../../../services/visualFeedback/index.js";

// ─── 1.1 osagent-native fixtures ────────────────────────────────────

const V11_FAIL: VisualFeedbackReportV11 = {
    schema_version: "1.1",
    ok: false,
    app: "http://localhost:3000/checkout",
    action_query: "click submit button",
    reason: "button not clickable, no toast",
    defects: [
        {
            type: "element_not_clickable",
            description: "submit button not clickable",
            selector: "button[data-testid='submit']",
        },
        {
            type: "visual_mismatch",
            description: "prices left-aligned, no $ prefix",
            region: "src/components/CheckoutForm.tsx",
        },
    ],
    has_error_frame: true,
    error_frame: "/tmp/checkout.error.png",
    task_id: "task-abc-123",
};

const V11_PASS: VisualFeedbackReportV11 = {
    schema_version: "1.1",
    ok: true,
    app: "http://localhost:3000/checkout",
    action_query: "click submit button",
    reason: "",
    defects: [],
    has_error_frame: false,
};

// ─── 1.0 legacy fixture (#216) ──────────────────────────────────────

const V10_REPORT = {
    schema_version: "1.0",
    task_id: "task-abc-123",
    status: "fail",
    failed_steps: [
        {
            step: "click submit button",
            expected: "form submits, success toast appears",
            actual: "button not clickable, no toast",
            kind: "element_not_clickable",
            selector: "button[data-testid='submit']",
        },
        {
            step: "render price column",
            expected: "prices right-aligned with $ prefix",
            actual: "prices left-aligned, no $ prefix",
            kind: "visual_mismatch",
        },
    ],
    suggested_fix_area: "src/components/CheckoutForm.tsx",
    target: "http://localhost:3000/checkout",
};

// ─── validateReport 1.1 ─────────────────────────────────────────────

describe("visualFeedback validateReport 1.1 (osagent-native)", () => {
    it("accepts a valid 1.1 fail report", () => {
        const r = validateReport(V11_FAIL);
        expect(r.valid).toBe(true);
        expect(r.report?.ok).toBe(false);
        expect(r.report?.defects.length).toBe(2);
        expect(r.report?.schema_version).toBe("1.1");
        expect(r.report?.app).toBe("http://localhost:3000/checkout");
        expect(r.report?.error_frame).toBe("/tmp/checkout.error.png");
    });

    it("accepts a valid 1.1 pass report with empty defects", () => {
        const r = validateReport(V11_PASS);
        expect(r.valid).toBe(true);
        expect(r.report?.ok).toBe(true);
        expect(r.report?.defects).toEqual([]);
        expect(r.report?.reason).toBe("");
    });

    it("rejects non-object", () => {
        expect(validateReport("nope").valid).toBe(false);
        expect(validateReport(null).valid).toBe(false);
        expect(validateReport(42).valid).toBe(false);
    });

    it("rejects unsupported schema_version", () => {
        const r = validateReport({ ...V11_FAIL, schema_version: "2.0" });
        expect(r.valid).toBe(false);
        expect(r.error).toContain("unsupported");
    });

    it("rejects missing ok", () => {
        const bad = { ...V11_FAIL } as Record<string, unknown>;
        delete bad.ok;
        const r = validateReport(bad);
        expect(r.valid).toBe(false);
        expect(r.error).toContain("ok");
    });

    it("rejects missing app", () => {
        const bad = { ...V11_FAIL } as Record<string, unknown>;
        delete bad.app;
        const r = validateReport(bad);
        expect(r.valid).toBe(false);
        expect(r.error).toContain("app");
    });

    it("rejects defects not array", () => {
        const r = validateReport({ ...V11_FAIL, defects: "oops" });
        expect(r.valid).toBe(false);
        expect(r.error).toContain("defects");
    });

    it("rejects defect missing type", () => {
        const bad = {
            ...V11_FAIL,
            defects: [{ description: "x" }],
        };
        const r = validateReport(bad);
        expect(r.valid).toBe(false);
        expect(r.error).toContain("type");
    });

    it("rejects defect invalid type value", () => {
        const bad = {
            ...V11_FAIL,
            defects: [{ type: "typo_kind", description: "x" }],
        };
        const r = validateReport(bad);
        expect(r.valid).toBe(false);
        expect(r.error).toContain("type");
    });

    it("rejects defect missing description", () => {
        const bad = {
            ...V11_FAIL,
            defects: [{ type: "unknown" }],
        };
        const r = validateReport(bad);
        expect(r.valid).toBe(false);
        expect(r.error).toContain("description");
    });

    it("rejects missing has_error_frame", () => {
        const bad = { ...V11_FAIL } as Record<string, unknown>;
        delete bad.has_error_frame;
        const r = validateReport(bad);
        expect(r.valid).toBe(false);
        expect(r.error).toContain("has_error_frame");
    });

    it("tolerates unknown extra fields", () => {
        const r = validateReport({ ...V11_FAIL, extra: "ignored" });
        expect(r.valid).toBe(true);
    });
});

// ─── validateReport 1.0 legacy compat ───────────────────────────────

describe("visualFeedback validateReport 1.0 (legacy #216 compat)", () => {
    it("accepts a valid 1.0 fail report and normalizes to 1.1", () => {
        const r = validateReport(V10_REPORT);
        expect(r.valid).toBe(true);
        expect(r.report?.schema_version).toBe("1.1");
        expect(r.report?.ok).toBe(false);
        expect(r.report?.task_id).toBe("task-abc-123");
        expect(r.report?.defects.length).toBe(2);
        expect(r.report?.defects[0].type).toBe("element_not_clickable");
        expect(r.report?.defects[0].selector).toBe("button[data-testid='submit']");
        expect(r.report?.app).toBe("http://localhost:3000/checkout");
        expect(r.report?.suggested_fix_area).toBe("src/components/CheckoutForm.tsx");
    });

    it("accepts a valid 1.0 pass report", () => {
        const pass = {
            ...V10_REPORT,
            status: "pass",
            failed_steps: [],
        };
        const r = validateReport(pass);
        expect(r.valid).toBe(true);
        expect(r.report?.ok).toBe(true);
        expect(r.report?.defects).toEqual([]);
    });

    it("rejects 1.0 empty task_id", () => {
        const r = validateReport({ ...V10_REPORT, task_id: "" });
        expect(r.valid).toBe(false);
        expect(r.error).toContain("task_id");
    });

    it("rejects 1.0 invalid status", () => {
        const r = validateReport({ ...V10_REPORT, status: "maybe" });
        expect(r.valid).toBe(false);
        expect(r.error).toContain("status");
    });

    it("rejects 1.0 failed_steps not array", () => {
        const r = validateReport({ ...V10_REPORT, failed_steps: "oops" });
        expect(r.valid).toBe(false);
        expect(r.error).toContain("failed_steps");
    });

    it("rejects 1.0 defect missing step", () => {
        const bad = {
            ...V10_REPORT,
            failed_steps: [{ expected: "x", actual: "y", kind: "unknown" }],
        };
        const r = validateReport(bad);
        expect(r.valid).toBe(false);
        expect(r.error).toContain("step");
    });

    it("rejects 1.0 defect invalid kind", () => {
        const bad = {
            ...V10_REPORT,
            failed_steps: [
                { step: "s", expected: "x", actual: "y", kind: "typo_kind" },
            ],
        };
        const r = validateReport(bad);
        expect(r.valid).toBe(false);
        expect(r.error).toContain("kind");
    });
});

// ─── formatDefectsForAgent ──────────────────────────────────────────

describe("visualFeedback formatDefectsForAgent", () => {
    it("formats 1.1 fail report with defects", () => {
        const norm = validateReport(V11_FAIL).report!;
        const out = formatDefectsForAgent(norm);
        expect(out).toContain("<visual_feedback>");
        expect(out).toContain("task_id: task-abc-123");
        expect(out).toContain("ok: false");
        expect(out).toContain("defect:");
        expect(out).toContain("type: element_not_clickable");
        expect(out).toContain("error_frame: /tmp/checkout.error.png");
        expect(out).toContain("</visual_feedback>");
    });

    it("formats pass report with no_defects", () => {
        const norm = validateReport(V11_PASS).report!;
        const out = formatDefectsForAgent(norm);
        expect(out).toContain("no_defects");
    });

    it("masks screenshot as length, not raw base64", () => {
        const withShot = {
            ...V11_FAIL,
            defects: [
                {
                    type: "unknown",
                    description: "s",
                    screenshot_b64: "A".repeat(1000),
                },
            ],
        };
        const norm = validateReport(withShot).report!;
        const out = formatDefectsForAgent(norm);
        expect(out).toContain("1000 bytes");
        expect(out).not.toContain("A".repeat(100));
    });
});

// ─── buildFixPlan ───────────────────────────────────────────────────

describe("visualFeedback buildFixPlan", () => {
    it("builds a re-fix plan from a fail report", () => {
        const norm = validateReport(V11_FAIL).report!;
        const plan = buildFixPlan(norm, { cwd: process.cwd() });
        expect(plan.ok).toBe(false);
        expect(plan.task_id).toBe("task-abc-123");
        expect(plan.fix_prompt).toContain("<visual_feedback>");
        expect(plan.rebuild_cmd).toBeTruthy();
        expect(plan.rerun_cmd).toContain("fusion-code dev");
        expect(plan.reverify_cmd).toContain("visual-feedback reverify");
        expect(plan.reverify_cmd).toContain("task-abc-123");
    });

    it("rerun_cmd includes app target", () => {
        const norm = validateReport(V11_FAIL).report!;
        const plan = buildFixPlan(norm);
        expect(plan.rerun_cmd).toContain("localhost:3000");
    });

    it("detects bun build in a bun project", () => {
        const norm = validateReport(V11_FAIL).report!;
        const plan = buildFixPlan(norm, { cwd: process.cwd() });
        // fusion-code itself is a bun project
        expect(plan.rebuild_cmd).toContain("build");
    });
});

// ─── ingestVisualFeedback ───────────────────────────────────────────

describe("visualFeedback ingestVisualFeedback", () => {
    const tmpRoot = join(tmpdir(), "fusion-vf-test-" + process.pid);

    it("ingests a valid 1.1 report file", async () => {
        await mkdir(tmpRoot, { recursive: true });
        const f = join(tmpRoot, "ok.json");
        await writeFile(f, JSON.stringify(V11_FAIL), "utf-8");
        const r = await ingestVisualFeedback({ filePath: f });
        expect(r.valid).toBe(true);
        expect(r.report?.task_id).toBe("task-abc-123");
        expect(r.report?.defects.length).toBe(2);
        await rm(tmpRoot, { recursive: true, force: true });
    });

    it("ingests a valid 1.0 legacy report file", async () => {
        await mkdir(tmpRoot, { recursive: true });
        const f = join(tmpRoot, "legacy.json");
        await writeFile(f, JSON.stringify(V10_REPORT), "utf-8");
        const r = await ingestVisualFeedback({ filePath: f });
        expect(r.valid).toBe(true);
        expect(r.report?.ok).toBe(false);
        expect(r.report?.defects.length).toBe(2);
        await rm(tmpRoot, { recursive: true, force: true });
    });

    it("autoFixLoop generates fixPlan on fail report", async () => {
        await mkdir(tmpRoot, { recursive: true });
        const f = join(tmpRoot, "loop.json");
        await writeFile(f, JSON.stringify(V11_FAIL), "utf-8");
        const r = await ingestVisualFeedback({
            filePath: f,
            autoFix: true,
            autoFixLoop: true,
        });
        expect(r.valid).toBe(true);
        expect(r.autoFixTriggered).toBe(true);
        expect(r.fixPlan).toBeDefined();
        expect(r.fixPlan?.rebuild_cmd).toBeTruthy();
        await rm(tmpRoot, { recursive: true, force: true });
    });

    it("rejects unreadable file", async () => {
        const r = await ingestVisualFeedback({ filePath: "/nonexistent/nope.json" });
        expect(r.valid).toBe(false);
        expect(r.error).toContain("read failed");
    });

    it("rejects invalid JSON", async () => {
        await mkdir(tmpRoot, { recursive: true });
        const f = join(tmpRoot, "bad.json");
        await writeFile(f, "{not json", "utf-8");
        const r = await ingestVisualFeedback({ filePath: f });
        expect(r.valid).toBe(false);
        expect(r.error).toContain("invalid JSON");
        await rm(tmpRoot, { recursive: true, force: true });
    });
});
