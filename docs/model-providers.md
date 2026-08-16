# fusion-code 模型 Provider

本文说明 6 个 provider、选择逻辑、自动检测、模型解析优先级与各 provider 的 env 配置示例。

## 6 个 Provider

`src/utils/model/providers.ts` 定义 `APIProvider` 类型：

```typescript
export type APIProvider =
  | 'firstParty'
  | 'bedrock'
  | 'vertex'
  | 'foundry'
  | 'openai'
  | 'fusionMlx'
```

| Provider | 类型 | 说明 |
|----------|------|------|
| `fusionMlx` | 本地 | MLX 推理，127.0.0.1:11432，默认 provider |
| `firstParty` | 云端 | Anthropic API（`FUSION_API_KEY` / `ANTHROPIC_API_KEY`） |
| `openai` | 云端 | OpenAI（`FUSION_CODE_USE_OPENAI=1`） |
| `foundry` | 云端 | Azure Foundry（`FUSION_CODE_USE_FOUNDRY=1`） |
| `bedrock` | 云端 | AWS Bedrock（`FUSION_CODE_USE_BEDROCK=1`） |
| `vertex` | 云端 | GCP Vertex（`FUSION_CODE_USE_VERTEX=1`） |

`fusionMlx` 是 fusion-code 的默认本地 provider，无需任何 API key，零配置即可使用（前提是 fusion-mlx 服务在 11432 端口运行）。

## getAPIProvider() 选择逻辑

`src/utils/model/providers.ts` 中的 `getAPIProvider()` 按以下优先级返回 provider：

```
1. FUSION_MLX_DISABLED=1?
   ├─ FUSION_CODE_USE_FOUNDRY=1 -> foundry
   ├─ FUSION_CODE_USE_OPENAI=1  -> openai
   └─ else                      -> firstParty

2. FUSION_MLX_ENABLED=1 -> fusionMlx

3. FUSION_CODE_USE_FOUNDRY=1 -> foundry
4. FUSION_CODE_USE_OPENAI=1  -> openai

5. 无 FUSION_API_KEY -> fusionMlx（本地零配置默认）

6. else -> firstParty
```

关键设计：

- `FUSION_MLX_DISABLED=1` 是总开关，显式跳过本地路径走云端
- `FUSION_MLX_ENABLED=1` 显式锁定本地，即使有 API key 也走本地
- 无 API key 时自动落到 `fusionMlx`，实现零配置本地启动
- bedrock / vertex 在当前 fork 中已禁用（源码中对应分支为 `if (false)`），保留类型定义供未来恢复

## shouldAutoUseFusionMlx()

自动检测函数，判断是否应使用本地 MLX：

1. 检测 `127.0.0.1:11432` 端口可用性
2. 端口可用时，自动选择一个 code-capable 文本模型
3. 配合 `getMlxModelCapabilities(modelId)` 检测能力：
   - tool calling 支持
   - vision 支持
   - streaming 支持
4. per-model `max_input_tokens` 从 API 获取（不再硬编码 32K）
5. 能力结果缓存，模型热切换时调用 `clearMlxCapabilitiesCache()` 清除

### MLX 模型能力分层（Phase 5 实现）

| 模型规模 | 工具集 | 说明 |
|----------|--------|------|
| ≤3B | 5 core tools | Bash/Read/Write/Edit/Glob |
| 7-9B | 10 tools | core + Grep + 等 |
| 其余 | full set | 全部工具 |

工具描述截断 200 chars，属性描述截断 80 chars，schema 清洗移除 `additionalProperties` / `$schema` / `default` 等干扰字段，节省 context tokens。

### MLX 上下文阈值（Phase 5 实现）

| 参数 | MLX | 云端 |
|------|-----|------|
| auto-compact 阈值 | 60% | ~93% |
| warning buffer | 3K | 20K |
| error buffer | 2K | 20K |
| manual buffer | 500 | 3K |
| 工具结果持久化阈值 | 15K chars | 50K chars |
| per-message budget | 60K | 200K |

所有阈值通过 `isFusionMlxProvider()` 自动切换。

## 模型解析优先级

```
1. session override (/model 命令)
2. --model CLI flag
3. FUSION_MODEL / FUSION_MLX_MODEL env
4. saved settings（~/.fusion-code/ 配置）
```

`/model` 命令在 MLX 模式下会：

1. `prefetchLocalModelOptions` 预取本地模型列表
2. 展示 `ModelPicker` 供选择
3. 模型验证走本地 fast path（无需 API 调用）

## 各 Provider Env 配置示例

### fusionMlx（本地默认）

```bash
# 启动 fusion-mlx 服务
fusion service start mlx

# 无需任何 env，fusion-code 自动检测 11432 端口
./fusion-code

# 或显式启用
FUSION_MLX_ENABLED=1 ./fusion-code

# 指定本地模型
FUSION_MLX_MODEL=qwen2.5-coder-32b ./fusion-code
```

下载模型通过镜像站 https://hf-mirror.com。

### firstParty（Anthropic API）

```bash
FUSION_API_KEY=sk-ant-xxx ./fusion-code

# 或用 ANTHROPIC_API_KEY
ANTHROPIC_API_KEY=sk-ant-xxx ./fusion-code

# 自定义 base URL
FUSION_API_KEY=sk-ant-xxx FUSION_BASE_URL=https://api.anthropic.com ./fusion-code

# 指定模型
FUSION_MODEL=claude-sonnet-4-20250514 ./fusion-code
```

### openai

```bash
FUSION_CODE_USE_OPENAI=1 \
OPENAI_API_KEY=sk-xxx \
./fusion-code
```

### foundry（Azure）

```bash
FUSION_CODE_USE_FOUNDRY=1 \
AZURE_FOUNDRY_API_KEY=xxx \
./fusion-code
```

### bedrock（AWS）

```bash
FUSION_CODE_USE_BEDROCK=1 \
AWS_REGION=us-east-1 \
AWS_ACCESS_KEY_ID=xxx \
AWS_SECRET_ACCESS_KEY=xxx \
./fusion-code
```

注：当前 fork 中 bedrock 分支已禁用，需恢复源码中 `if (false)` 分支才能使用。

### vertex（GCP）

```bash
FUSION_CODE_USE_VERTEX=1 \
CLOUD_ML_REGION=us-east5 \
ANTHROPIC_VERTEX_PROJECT_ID=xxx \
./fusion-code
```

注：当前 fork 中 vertex 分支已禁用，需恢复源码中 `if (false)` 分支才能使用。

## LLM Adapter 接缝 (div-anthropic, SDK 已彻底移除)

fusion-code 已彻底移除对 `@anthropic-ai/sdk` 的运行时与编译期依赖（`package.json` 不再含该依赖）。所有 LLM 调用统一走 provider 中立的 **LLM 接缝 (seam)**，由 `LlmClient`（`src/services/llm/client.ts`）承载。分支 `feat/div-anthropic`。

### 架构

```
claude.ts queryModel()
  └─ anthropic.streamMessages(params, {signal, headers})   ← LlmClient 唯一路径
       └─ streamViaSeam(params, signal, model, headers)     ← 接缝路径
            ├─ httpClient.postMessages()                    ← 裸 HTTP POST /v1/messages
            ├─ parseSseStream() → sseToChunk()              ← SSE → StreamChunk (provider 中立)
            └─ chunkStreamToSdkParts()                      ← StreamChunk → SDK part (喂下方既有 switch, 零改动)
```

`getAnthropicClient()` 返回 `LlmClient`：firstParty + fusionMlx 经 `createSeamClient(model, fetchOverride, defaultHeaders)` 构造；bedrock / vertex / foundry **抛错**引导走 fusion-gateway（云端签名在网关完成）。`streamViaSeam` 返回 `{ stream, requestId, response }`，填充 `streamRequestId`/`streamResponse`，保留与旧 SDK `.withResponse()` 一致的 request_id 追踪与 body 取消能力。

### LlmClient 5 方法（替代 SDK API）

| LlmClient 方法 | 替代的 SDK 调用 | 用途 |
|----------------|----------------|------|
| `streamMessages(params, {signal,headers})` | `anthropic.beta.messages.create({stream:true})` | 主流式（claude.ts 主循环） |
| `createMessage(params, {signal,timeoutMs})` | `anthropic.beta.messages.create(...)` | 非流式（verifyApiKey / 非流式 fallback / sideQuery / tokenEstimation）；注入 `_request_id` |
| `createMessageRaw(params, opts)` | `anthropic.beta.messages.create(...).asResponse()` | 原始 Response（claudeAiLimits 读限流头） |
| `countTokens(params, opts?)` | `anthropic.beta.messages.countTokens(...)` | 计数（tokenEstimation） |
| `listModels({betas,signal}?)` | `anthropic.models.list({betas})` | 模型列表（modelCapabilities） |

### 错误层解耦

错误处理不再 `instanceof` SDK 错误类，改用鸭子类型桥 (`src/services/llm/errors.ts`)，接受接缝 `LlmRequestError`：

| 鸭子守卫 | 替代的 SDK 判定 | 判定依据 |
|----------|----------------|----------|
| `isApiErrorLike(e)` | `instanceof APIError` | `Error` + 有 `status`/`headers`/`requestID` 之一 |
| `isConnectionErrorLike(e)` | `instanceof APIConnectionError` | `LlmRequestError` code=TRANSPORT/TIMEOUT，或 `.name` 含 "Connection" |
| `isTimeoutErrorLike(e)` | `instanceof APIConnectionTimeoutError` | code=TIMEOUT，或 `.name` 含 "Timeout"，或 message 含 "timeout" |
| `isAbortError(e)` | `instanceof APIUserAbortError` | `.name`∈{APIUserAbortError, AbortError}，或 message="Request was aborted." |

`utils/errors.ts` 的 `isAbortError` 用 `.name`/`.message` 而非 `instanceof`，因 minified build 中类名混淆且不设 `.name`。

### 完成状态

- **已完成**：`package.json` 移除 `@anthropic-ai/sdk` + `@anthropic-ai/foundry-sdk`；`client.ts` 不再 `new Anthropic(...)`；全部 8 处 SDK 方法调用点迁移到 LlmClient；编译后二进制 0 处功能性 `@anthropic-ai/sdk` 引用（残留 1 处为 bedrock/vertex/foundry 抛错的用户可见提示串）。
- **typecheck 0 错误；build + build:dev:full 通过；514 测试全过**。
- **遗留（见 fusion-gateway issue）**：bedrock / vertex / foundry 云 provider 直连已移除，需经 fusion-gateway 签名。

## 辅助函数

| 函数 | 文件 | 说明 |
|------|------|------|
| `getAPIProvider()` | `providers.ts` | 返回当前 provider |
| `isFusionMlxProvider()` | `providers.ts` | 是否为 MLX provider |
| `shouldAutoUseFusionMlx()` | `providers.ts` | 是否应自动使用 MLX |
| `isCloudFreeMode()` | `providers.ts` | 是否为无 cloud key 的本地模式 |
| `isFirstPartyAnthropicBaseUrl()` | `providers.ts` | 是否为 Anthropic 官方 base URL |
| `getMlxModelCapabilities(modelId)` | `fusion-mlx-models.ts` / `modelCapabilities.ts` | 检测 MLX 模型能力 |
| `clearMlxCapabilitiesCache()` | `modelCapabilities.ts` | 清除能力缓存（模型热切换） |

## 调试日志

- Provider 选择：`getAPIProvider()` 返回值可通过 `FUSION_LOG=debug` 观察启动日志
- MLX 能力检测：`getMlxModelCapabilities` 结果在 `fusion-mlx-adapter.ts` 启动时打印
- 模型解析：`/model` 命令展示本地模型列表时，`getFusionMlxModels` 请求 `127.0.0.1:11432/v1/models`
- 端口检测失败：检查 `lsof -i :11432` 与 `curl http://127.0.0.1:11432/v1/models`
- provider 误选云端：确认 `FUSION_API_KEY` 未设置，或显式 `FUSION_MLX_ENABLED=1`
