// LLM 接缝 — Fusion-MLX 适配器
//
// fusion-mlx 网关 (127.0.0.1:11432) 原生用 OpenAI /v1/chat/completions 格式,
// 但 createFusionMlxFetch 是一个 fetch override: 拦截对 /v1/messages 的请求,
// 内部做 Anthropic->OpenAI 翻译, 并把 OpenAI 流式响应 (transformMLXStreamToAnthropic
// + encodeStreamToAnthropicSSE) 转回 Anthropic SSE 事件。
//
// 因此 MLX 路径在接缝层直接复用 AnthropicWireAdapter 的 SSE->StreamChunk 解析:
// 只需把 postMessages 的 fetch 换成 createFusionMlxFetch (它内部已处理 base_url 与鉴权),
// baseUrl 设为占位 (override 按 url.includes("/v1/messages") 拦截, 不实际连接该地址)。

import type { LlmAdapter } from "./types.js";
import { AnthropicWireAdapter } from "./adapter.js";
import { createFusionMlxFetch } from "../api/fusion-mlx-adapter.js";

// 占位 baseUrl: postMessages 会拼成 <baseUrl>/v1/messages, override 按 url.includes
// ("/v1/messages") 拦截, 真正的 MLX base_url 由 createFusionMlxFetch 内部决定。
const MLX_PLACEHOLDER_BASE = "http://fusion-mlx.local";

export function createMlxAdapter(model: string): LlmAdapter {
    const mlxFetch = createFusionMlxFetch(model);
    return new AnthropicWireAdapter({
        baseUrl: MLX_PLACEHOLDER_BASE,
        // MLX override 内部处理鉴权 (settings.json / 环境变量), 此处不传 apiKey
        firstParty: false,
        fetchFn: mlxFetch,
    });
}
