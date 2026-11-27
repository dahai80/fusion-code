import { afterEach, describe, expect, it } from "bun:test";
import { getMax529Retries } from "../../../src/services/api/withRetry";

describe("getMax529Retries", () => {
    const KEY = "FUSION_CODE_MAX_529_RETRIES";

    afterEach(() => {
        delete process.env[KEY];
    });

    it("defaults to 3 when env unset", () => {
        delete process.env[KEY];
        expect(getMax529Retries()).toBe(3);
    });

    it("parses a valid override", () => {
        process.env[KEY] = "10";
        expect(getMax529Retries()).toBe(10);
    });

    it("falls back to default on 0 (budget below 1 rejected)", () => {
        process.env[KEY] = "0";
        expect(getMax529Retries()).toBe(3);
    });

    it("falls back to default on non-numeric value", () => {
        process.env[KEY] = "abc";
        expect(getMax529Retries()).toBe(3);
    });

    it("falls back to default on negative value", () => {
        process.env[KEY] = "-2";
        expect(getMax529Retries()).toBe(3);
    });
});

describe("shouldRetry: status-less transport timeout", () => {
    const { shouldRetry } = require("../../../src/services/api/withRetry");

    it("retries a status-less timeout Error (observed session-killer)", () => {
        const err = new Error("The operation timed out.");
        expect(shouldRetry(err as any)).toBe(true);
    });

    it("retries a status-less LlmRequestError TIMEOUT via connection path", () => {
        const { LlmRequestError } = require("../../../src/services/llm/errors");
        const err = new LlmRequestError({
            code: "TIMEOUT",
            message: "The operation timed out.",
            retryable: false,
        });
        expect(shouldRetry(err as any)).toBe(true);
    });

    it("does not retry a status-less non-timeout Error", () => {
        expect(shouldRetry(new Error("something else") as any)).toBe(false);
    });

    it("keeps status-carrying 400 non-retryable even with timeout wording", () => {
        const err = new Error("invalid timeout parameter");
        (err as any).status = 400;
        expect(shouldRetry(err as any)).toBe(false);
    });
});
