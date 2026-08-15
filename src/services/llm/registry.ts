// LLM 接缝 — 适配器注册表
//
// 按 APIProvider 静态分发到对应 LlmAdapter (非 Cordis 运行时注册)。
// 仅在 LLM_ADAPTER_SEAM feature 开启时返回适配器; 关闭 (默认) 返回 null,
// 调用方 (claude.ts, Phase 4) 据此回退到现有 SDK 路径, 实现 instant rollback。

import { AnthropicWireAdapter } from "./adapter.js";
import { createMlxAdapter } from "./mlxAdapter.js";
import { feature } from "bun:bundle";
import type { LlmAdapter } from "./types.js";
import type { APIProvider } from "../../utils/model/providers.js";
import {
    getAPIProvider,
    isFirstPartyAnthropicBaseUrl,
} from "../../utils/model/providers.js";
import { getAnthropicApiKey } from "../../utils/auth.js";

// firstParty 直连 Anthropic 的 base URL (与 claude.ts:540 一致: 优先 FUSION/ANTHROPIC env)。
function resolveFirstPartyBaseUrl(): string {
    return (
        process.env.FUSION_BASE_URL ||
        process.env.ANTHROPIC_BASE_URL ||
        "https://api.anthropic.com"
    );
}

// 按 provider + model 解析适配器。seam 关闭时返回 null (走 SDK)。
// feature() 必须直接用在 if 里 (Bun DCE 宏约束), 不可提取为辅助函数。
export function getLlmAdapter(
    provider?: APIProvider,
    model?: string,
): LlmAdapter | null {
    if (!feature("LLM_ADAPTER_SEAM")) {
        return null;
    }
    const p = provider ?? getAPIProvider(model);
    switch (p) {
        case "fusionMlx":
            // MLX: 用 fetch override, 响应已转成 Anthropic SSE, 复用解析
            return createMlxAdapter(model ?? "");
        case "firstParty":
            return new AnthropicWireAdapter({
                baseUrl: resolveFirstPartyBaseUrl(),
                apiKey: getAnthropicApiKey() ?? undefined,
                firstParty: isFirstPartyAnthropicBaseUrl(),
            });
        case "bedrock":
        case "vertex":
        case "foundry":
        case "openai":
            // 这些 provider 暂仍走 SDK (Phase 4/5 逐步迁移); seam 期返回 null 回退 SDK
            return null;
        default:
            return null;
    }
}

// 便捷封装: 直接按当前 provider 判定是否启用接缝适配器。
export function isLlmAdapterActive(model?: string): boolean {
    return getLlmAdapter(undefined, model) !== null;
}

// 重新导出类型, 方便调用方单点 import。
export type { LlmAdapter } from "./types.js";
export type { APIProvider } from "../../utils/model/providers.js";
