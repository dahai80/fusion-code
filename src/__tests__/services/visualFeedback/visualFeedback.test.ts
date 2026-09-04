// Visual-Feedback Protocol (issue #216) — schema 校验 + ingest 单测。

import { describe, expect, it } from "bun:test";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import {
    formatDefectsForAgent,
    ingestVisualFeedback,
    validateReport,
} from "../../../services/visualFeedback/index.js";
import type { VisualFeedbackReport } from "../../../services/visualFeedback/index.js";

const VALID_REPORT: VisualFeedbackReport = {
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

describe("visualFeedback validateReport", () => {
    it("accepts a valid fail report", () => {
        const r = validateReport(VALID_REPORT);
        expect(r.valid).toBe(true);
        expect(r.report?.status).toBe("fail");
        expect(r.report?.failed_steps.length).toBe(2);
    });

    it("accepts a valid pass report with empty steps", () => {
        const pass: VisualFeedbackReport = { ...VALID_REPORT, status: "pass", failed_steps: [] };
        const r = validateReport(pass);
        expect(r.valid).toBe(true);
        expect(r.report?.failed_steps).toEqual([]);
    });

    it("rejects non-object", () => {
        expect(validateReport("nope").valid).toBe(false);
        expect(validateReport(null).valid).toBe(false);
        expect(validateReport(42).valid).toBe(false);
    });

    it("rejects unsupported schema_version", () => {
        const r = validateReport({ ...VALID_REPORT, schema_version: "2.0" });
        expect(r.valid).toBe(false);
        expect(r.error).toContain("unsupported");
    });

    it("rejects empty task_id", () => {
        const r = validateReport({ ...VALID_REPORT, task_id: "" });
        expect(r.valid).toBe(false);
        expect(r.error).toContain("task_id");
    });

    it("rejects invalid status", () => {
        const r = validateReport({ ...VALID_REPORT, status: "maybe" });
        expect(r.valid).toBe(false);
        expect(r.error).toContain("status");
    });

    it("rejects failed_steps not array", () => {
        const r = validateReport({ ...VALID_REPORT, failed_steps: "oops" });
        expect(r.valid).toBe(false);
        expect(r.error).toContain("failed_steps");
    });

    it("rejects defect missing step", () => {
        const bad = {
            ...VALID_REPORT,
            failed_steps: [{ expected: "x", actual: "y", kind: "unknown" }],
        };
        const r = validateReport(bad);
        expect(r.valid).toBe(false);
        expect(r.error).toContain("step");
    });

    it("rejects defect invalid kind", () => {
        const bad = {
            ...VALID_REPORT,
            failed_steps: [
                { step: "s", expected: "x", actual: "y", kind: "typo_kind" },
            ],
        };
        const r = validateReport(bad);
        expect(r.valid).toBe(false);
        expect(r.error).toContain("kind");
    });

    it("tolerates unknown extra fields", () => {
        const r = validateReport({ ...VALID_REPORT, extra: "ignored" });
        expect(r.valid).toBe(true);
    });
});

describe("visualFeedback formatDefectsForAgent", () => {
    it("formats fail report with defects", () => {
        const out = formatDefectsForAgent(VALID_REPORT);
        expect(out).toContain("<visual_feedback>");
        expect(out).toContain("task_id: task-abc-123");
        expect(out).toContain("defect:");
        expect(out).toContain("step: click submit button");
        expect(out).toContain("kind: element_not_clickable");
        expect(out).toContain("</visual_feedback>");
    });

    it("formats pass report with no_failed_steps", () => {
        const pass: VisualFeedbackReport = { ...VALID_REPORT, status: "pass", failed_steps: [] };
        const out = formatDefectsForAgent(pass);
        expect(out).toContain("no_failed_steps");
    });

    it("masks screenshot as length, not raw base64", () => {
        const withShot: VisualFeedbackReport = {
            ...VALID_REPORT,
            failed_steps: [
                {
                    step: "s",
                    expected: "x",
                    actual: "y",
                    kind: "unknown",
                    screenshot_b64: "A".repeat(1000),
                },
            ],
        };
        const out = formatDefectsForAgent(withShot);
        expect(out).toContain("1000 bytes");
        expect(out).not.toContain("A".repeat(100));
    });
});

describe("visualFeedback ingestVisualFeedback", () => {
    const tmpRoot = join(tmpdir(), "fusion-vf-test-" + process.pid);

    it("ingests a valid report file", async () => {
        await mkdir(tmpRoot, { recursive: true });
        const f = join(tmpRoot, "ok.json");
        await writeFile(f, JSON.stringify(VALID_REPORT), "utf-8");
        const r = await ingestVisualFeedback({ filePath: f });
        expect(r.valid).toBe(true);
        expect(r.report?.task_id).toBe("task-abc-123");
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
