// 适配器注册表单测 — seam 关闭 (默认) 回退 SDK; 仅验证可空契约
//
// 注: LLM_ADAPTER_SEAM 是 build-time feature 宏, 测试运行时 (未 --feature 构建) 为 false,
// 故 getLlmAdapter 必返回 null。on-path 行为由集成测试 (构建带 flag 的二进制) 覆盖。

import { describe, expect, test } from "bun:test";
import { getLlmAdapter, isLlmAdapterActive } from "../../services/llm/index.js";

describe("getLlmAdapter (seam off by default)", () => {
    test("returns null when feature flag disabled (firstParty)", () => {
        process.env.FUSION_API_KEY = "test-key";
        expect(getLlmAdapter("firstParty", "claude-test")).toBeNull();
        delete process.env.FUSION_API_KEY;
    });

    test("returns null for fusionMlx when seam off", () => {
        expect(getLlmAdapter("fusionMlx", "mlx-test")).toBeNull();
    });

    test("returns null for bedrock/vertex/foundry/openai", () => {
        for (const p of ["bedrock", "vertex", "foundry", "openai"] as const) {
            expect(getLlmAdapter(p, "m")).toBeNull();
        }
    });

    test("isLlmAdapterActive false when seam off", () => {
        process.env.FUSION_API_KEY = "test-key";
        expect(isLlmAdapterActive("claude-test")).toBe(false);
        delete process.env.FUSION_API_KEY;
    });
});
