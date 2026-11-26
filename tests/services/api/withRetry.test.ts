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
