// 错误分类单测 — 覆盖 status / message / Abort / 重试判定

import { describe, expect, test } from "bun:test";
import {
    classifyError,
    isRetryable,
    LlmRequestError,
} from "../../services/llm/errors.js";

describe("classifyError by status", () => {
    test("401 maps to AUTH", () => {
        expect(classifyError(new Error("boom"), 401).code).toBe("AUTH");
    });
    test("403 maps to AUTH", () => {
        expect(classifyError(new Error("denied"), 403).code).toBe("AUTH");
    });
    test("429 maps to RATE_LIMIT", () => {
        expect(classifyError(new Error("slow"), 429).code).toBe("RATE_LIMIT");
    });
    test("529 maps to RATE_LIMIT", () => {
        expect(classifyError(new Error("overloaded"), 529).code).toBe("RATE_LIMIT");
    });
    test("400 maps to INVALID_REQUEST", () => {
        expect(classifyError(new Error("bad"), 400).code).toBe("INVALID_REQUEST");
    });
    test("500 maps to SERVER", () => {
        expect(classifyError(new Error("oops"), 500).code).toBe("SERVER");
    });
    test("503 maps to SERVER", () => {
        expect(classifyError(new Error("unavailable"), 503).code).toBe("SERVER");
    });
});

describe("classifyError by message fallback", () => {
    test("timeout keyword", () => {
        expect(classifyError(new Error("request timed out")).code).toBe("TIMEOUT");
    });
    test("abort keyword", () => {
        expect(classifyError(new Error("operation was aborted")).code).toBe("ABORTED");
    });
    test("rate limit keyword", () => {
        expect(classifyError(new Error("rate limit exceeded")).code).toBe("RATE_LIMIT");
    });
    test("auth keyword", () => {
        expect(classifyError(new Error("invalid api key")).code).toBe("AUTH");
    });
    test("unknown server-ish defaults to TRANSPORT", () => {
        expect(classifyError(new Error("ECONNREFUSED some host")).code).toBe("TRANSPORT");
    });
});

describe("classifyError AbortError priority", () => {
    test("AbortError overrides status", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        expect(classifyError(err, 500).code).toBe("ABORTED");
    });
});

describe("isRetryable", () => {
    test("RATE_LIMIT retryable", () => {
        expect(isRetryable(classifyError(new Error("x"), 429))).toBe(true);
    });
    test("SERVER retryable", () => {
        expect(isRetryable(classifyError(new Error("x"), 500))).toBe(true);
    });
    test("TRANSPORT retryable", () => {
        expect(isRetryable(classifyError(new Error("ECONNRESET")))).toBe(true);
    });
    test("AUTH not retryable", () => {
        expect(isRetryable(classifyError(new Error("x"), 401))).toBe(false);
    });
    test("INVALID_REQUEST not retryable", () => {
        expect(isRetryable(classifyError(new Error("x"), 400))).toBe(false);
    });
    test("ABORTED not retryable", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        expect(isRetryable(classifyError(err))).toBe(false);
    });
});

describe("LlmRequestError", () => {
    test("carries failure with status and message", () => {
        try {
            throw new LlmRequestError(classifyError(new Error("nope"), 429, "req-1"));
        } catch (e) {
            expect(e).toBeInstanceOf(LlmRequestError);
            const lr = e as LlmRequestError;
            expect(lr.failure.code).toBe("RATE_LIMIT");
            expect(lr.failure.status).toBe(429);
            expect(lr.failure.requestId).toBe("req-1");
            expect(lr.message).toContain("nope");
        }
    });
});
