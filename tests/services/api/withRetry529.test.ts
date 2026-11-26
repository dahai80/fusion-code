import { describe, expect, mock, test } from "bun:test";

// Backoff sleeps are stubbed so a 10-strike test finishes instantly.
// mock.module must land before withRetry is imported.
mock.module("../../../src/utils/sleep.js", () => ({
    sleep: async () => {},
}));

const { withRetry, BASE_DELAY_MS } = await import(
    "../../../src/services/api/withRetry.js"
);
const { REPEATED_529_ERROR_MESSAGE } = await import(
    "../../../src/services/api/errors.js"
);

// Real 529s reach the retry path via the message-content check (the SDK
// sometimes drops the 529 status during streaming) — mirror that shape.
// Must be an Error instance: isApiErrorLike requires instanceof Error.
const FIVE29 = Object.assign(
    new Error('api_error: {"type":"overloaded_error"}'),
    { status: 529 },
);

function makeOps(failTimes: number) {
    let calls = 0;
    const operation = async () => {
        calls++;
        if (calls <= failTimes) {
            throw FIVE29;
        }
        return "ok";
    };
    return { operation, getCalls: () => calls };
}

const baseOptions = {
    model: "test-model",
    querySource: "repl_main_thread" as const,
};

describe("withRetry 529 budget", () => {
    test("default budget is 3: hard-fails with REPEATED_529 after 3 strikes (external user)", async () => {
        const prevUserType = process.env.USER_TYPE;
        delete process.env.FUSION_CODE_MAX_529_RETRIES;
        process.env.USER_TYPE = "external";
        try {
            const { operation, getCalls } = makeOps(999);
            const gen = withRetry(
                async () => ({} as any),
                operation,
                baseOptions as any,
            );
            let err: any;
            try {
                for (;;) {
                    const n = gen.next();
                    if ((await n).done) break;
                }
            } catch (e) {
                err = e;
            }
            expect(err).toBeDefined();
            expect(String(err.message ?? err)).toContain(
                REPEATED_529_ERROR_MESSAGE,
            );
            expect(getCalls()).toBe(3);
        } finally {
            if (prevUserType === undefined)
                delete process.env.USER_TYPE;
            else process.env.USER_TYPE = prevUserType;
        }
    });

    test("FUSION_CODE_MAX_529_RETRIES=10 lets 5 short 529 cascades ride out", async () => {
        const prevUserType = process.env.USER_TYPE;
        const prevBudget = process.env.FUSION_CODE_MAX_529_RETRIES;
        process.env.USER_TYPE = "external";
        process.env.FUSION_CODE_MAX_529_RETRIES = "10";
        try {
            const { operation, getCalls } = makeOps(5);
            const gen = withRetry(
                async () => ({} as any),
                operation,
                baseOptions as any,
            );
            let result: any;
            for (;;) {
                const n = gen.next();
                const v = await n;
                if (v.done) {
                    result = v.value;
                    break;
                }
            }
            expect(result).toBe("ok");
            expect(getCalls()).toBe(6);
        } finally {
            if (prevUserType === undefined) delete process.env.USER_TYPE;
            else process.env.USER_TYPE = prevUserType;
            if (prevBudget === undefined)
                delete process.env.FUSION_CODE_MAX_529_RETRIES;
            else process.env.FUSION_CODE_MAX_529_RETRIES = prevBudget;
        }
    });

    test("budget is clamped to DEFAULT_MAX_RETRIES (10)", async () => {
        const prevUserType = process.env.USER_TYPE;
        const prevBudget = process.env.FUSION_CODE_MAX_529_RETRIES;
        process.env.USER_TYPE = "external";
        process.env.FUSION_CODE_MAX_529_RETRIES = "999";
        try {
            const { operation, getCalls } = makeOps(999);
            const gen = withRetry(
                async () => ({} as any),
                operation,
                baseOptions as any,
            );
            let err: any;
            try {
                for (;;) {
                    const n = await gen.next();
                    if (n.done) break;
                }
            } catch (e) {
                err = e;
            }
            expect(getCalls()).toBeLessThanOrEqual(11);
            expect(err).toBeDefined();
        } finally {
            if (prevUserType === undefined) delete process.env.USER_TYPE;
            else process.env.USER_TYPE = prevUserType;
            if (prevBudget === undefined)
                delete process.env.FUSION_CODE_MAX_529_RETRIES;
            else process.env.FUSION_CODE_MAX_529_RETRIES = prevBudget;
        }
    });
});
