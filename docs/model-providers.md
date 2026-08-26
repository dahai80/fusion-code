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

#### 第三方代理（LiteLLM 等）

第三方代理（baseUrl 非 `api.anthropic.com`，如 LiteLLM）下，`FUSION_API_KEY` 与 `ANTHROPIC_API_KEY` 均可作为 key，`FUSION_API_KEY` 优先。接缝层（去 SDK 后）在第三方代理场景补回了旧 SDK 构造函数对 `ANTHROPIC_API_KEY` 的环境变量回退读取——仅设 `ANTHROPIC_API_KEY`（非 `sk-ant-`）+ 代理 baseUrl 即可工作，无需 `FUSION_API_KEY`。

```bash
# LiteLLM 代理：仅 ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL
ANTHROPIC_API_KEY=sk-adco-xxx \
ANTHROPIC_BASE_URL=http://litellm.proxy:4000 \
FUSION_MLX_DISABLED=1 \
./fusion-code --model glm5.2 -p "hi"
```

> 注意 `FUSION_BASE_URL` 优先级高于 `ANTHROPIC_BASE_URL`（接缝 `resolveFirstPartyBaseUrl` 读取顺序 `FUSION_BASE_URL || ANTHROPIC_BASE_URL`）。若 `FUSION_BASE_URL` 残留 `http://127.0.0.1` 会覆盖代理 URL，导致连接失败——第三方代理场景请用 `ANTHROPIC_BASE_URL` 或清空 `FUSION_BASE_URL`。

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

- **已完成**：`package.json` 移除 `@anthropic-ai/sdk` + `@anthropic-ai/foundry-sdk` + `@anthropic-ai/claude-agent-sdk`；`client.ts` 不再 `new Anthropic(...)`；全部 8 处 SDK 方法调用点迁移到 LlmClient；编译后二进制 0 处功能性 `@anthropic-ai/sdk` 引用（残留 1 处为 bedrock/vertex/foundry 抛错的用户可见提示串）。
- **D3 三包评估完成**（issue #65, PR #68）：`@anthropic-ai/claude-agent-sdk` **彻底移除**（print.ts:132 纯 `import type`，本地 `PermissionMode` 6 模式等价覆盖；附带切断 claude-agent-sdk 顶层 deps 含 `@anthropic-ai/sdk` 的传递拉取，连 8 平台原生子包一并移除）；`@anthropic-ai/sandbox-runtime` **保留**（OS 级沙箱执行，无原生等价）；`@anthropic-ai/mcpb` **保留**（Bundle manifest 解包独有，`@modelcontextprotocol/sdk` 无覆盖，已懒加载）。最终 `package.json` 仅余此两运行时必需包。
- **typecheck 0 错误；build + build:dev:full 通过；514 测试全过**。
- **遗留（见 fusion-gateway issue）**：bedrock / vertex / foundry 云 provider 直连已移除，需经 fusion-gateway 签名。

### P0.1 Capability Seam 三角色 — 现状（enhance-0819.md:449）

enhance-0819.md P0.1 要 "consumer (claude.ts) 0 具体 provider import；换 MLX→firstParty 仅改 provider 注册，consumer 不动"。审计现状：

- **Service Definition 已落地** = `LlmClient` 接口（`src/services/llm/client.ts:69`），5 方法 `streamMessages`/`createMessage`/`createMessageRaw`/`countTokens`/`listModels`，即 spec 的 `LlmCapability`。
- **Provider factory 已落地** = `getAnthropicClient()`（`src/services/api/client.ts:54`）返回 `LlmClient`（非具体 client）；`createSeamClient(model, fetchOverride, defaultHeaders)` 构 firstParty + fusionMlx。bedrock/vertex/foundry 抛错引导 gateway。
- **Consumer 模型调用路径已中立** = `claude.ts` 两处 `getAnthropicClient({...})` 调用点（:549 verify、:854 主调用）均消费 `LlmClient` 接口（`anthropic.createMessage` / streaming），不 import 具体 provider。SDK 已移除（div-anthropic）。
- **更深的适配器层** = `LlmAdapter`/`registry.ts`（`getLlmAdapter` 按 `APIProvider` 静态分发，`LLM_ADAPTER_SEAM` feature flag gate，默认 off 回退 seam）。中立 `StreamChunk` 类型（`types.ts`）。

**已满足 spec 的核心高杠杆点**（换 provider 不动模型调用循环）。spec 的 "大重构" 风险项（"需保 514 测试不回归，分步：先接口共存[done]，后去具体 import[remaining]"）剩余 tail：

- **Consumer 残留 provider 条件分支**（9 处，`claude.ts`）：`isFusionMlxProvider()`(:524 verifyApiKey 短路)、`shouldIncludeFirstPartyOnlyBetas()`(:303/476/1420/1664 betas 条件)、`getAPIProvider()==="firstParty"`(:1439/1677/1681/1814 header/betas 条件)、`isFirstPartyAnthropicBaseUrl()`(:1814)。这些在 **betas / auth verify / header** 逻辑，非模型调用路径（call path 已中立）。完整清除 = 把 provider-aware 逻辑下沉到 capability-fact/adapter 层，spec 自标 "大重构"。
- **能力事实未集中**：`supportsStreaming`/`supportsVision`/`maxInputTokens` 散在 `fusion-mlx-models.ts`（MLX-only）+ `modelCapabilities.ts`；无 `LLM_SETTINGS_NAMESPACE` 命名空间注册。spec step "能力事实集中" + "命名空间" 未做。

**决策**：核心 seam 已由 div-anthropic 交付，满足 "换 provider 不动循环" 的高杠杆目标。剩余 tail 为 provider-conditional 清除 + 能力事实集中 = spec 自标 "大重构"（高回归面，触及活模型路径的 betas/auth/header），无具体故障驱动，违反 simplicity-first。**defer 为显式决策**，非 backlog；若需做，按 spec "分步" 先抽 capability-fact 单点，再逐个下沉 provider 条件分支，每步保 469 测试不回归。

### P0.2 事件溯源会话日志 + surfaceOp — 现状（enhance-0819.md:472）

enhance-0819.md P0.2 要新建 `src/services/session/events.ts`：`SessionEvent` 信封 `{seq, time, ignorable, surfaceOp, sourceEventSeqs}` + `surfaceOp: 'append' | {op:'replace', start, end}` + `SessionEventMap` + `deriveMessages()` 单投影（替 `mutableMessages` 直接维护）+ `SESSION_FORMAT_VERSION`。审计现状：**net-new 基础设施**，无任何已落地符号。

**审计 — 已存在的非正式事件日志（磁盘侧）**：
- 会话持久化 = append-only JSONL：`recordTranscript`(`sessionStorage.ts:1486`) → `insertMessageChain`(`:1071`, 逐 msg `appendEntry`) → `enqueueWrite`(`:635`) → 批量 `fsAppendFile`。每条 `TranscriptMessage`(`types/logs.ts:221`) 带 `parentUuid`/`logicalParentUuid`/`isSidechain`/`gitBranch`/`sessionId`/`version` 链式结构。`Entry` 判别联合（`:297`，含 `TranscriptMessage|SummaryMessage|CustomTitleMessage|TaskSummaryMessage|TagMessage|...`）= 非类型化事件日志。
- 压缩边界标记 = `SystemCompactBoundaryMessage`（`messages.ts:4568` `createCompactBoundaryMessage`，`compactMetadata:{trigger,preTokens,userContext,messagesSummarized}`），压缩产物 `CompactResult.{boundaryMarker, messagesToKeep}`（`compact.ts:483`），顺序 `boundaryMarker, summaryMessages, messagesToKeep, ...`（`:511`）= 非正式 `surfaceOp:replace`。`tengu_compact*`/`tengu_partial_compact*` analytics 事件（`compact.ts:987` 等多处）= 分析事件，非会话日志事件。
- 磁盘裁剪（PR #114）：`trimCurrentSessionTranscript` pre-compact 段永留盘 + compact_boundary 标记 + 崩溃安全 checkpoint — 压缩前完整历史**磁盘保留**，溯源不丢。

**审计 — `mutableMessages` 变更面（spec 自标 "大改" surface）**：
- 定义：`QueryEngine.ts:188` 字段 / `:204` init / `:1236` config shape / `:346` 外部 mutator 回调（print 模式写回缝）/ `print.ts:1153` print 模式本地副本。
- **16 处直接变更**（push/splice/length=0）：QueryEngine 12 处（`:431` user turn seed、`:790/794/807/866` assistant/tool/synthetic append 4 处、`:947` length=0 snip reset、`:948` snip replace、`:952` post-snip push、`:964` splice mutableBoundary prefix prune）+ queryHelpers 2 处（`:338/359` CCR resume）+ print.ts 2 处（`:1238` breadcrumbs、`:4429` bridge history replay）。`recap`/`summary` 只读。
- `normalizeMessages`/`normalizeMessagesCache`（PR #112）：`messages.ts:731` 4 重载 → `normalizeMessagesCore`(`:755`, 单调 `isNewChain` flag 的 per-msg transform)；`normalizeMessagesCache.ts` 引用身份键增量缓存 O(n)→O(tail)。**最接近 `deriveMessages()` 的现有层**，但是 per-message 规范化 transform，非 log→history 投影；`deriveMessages` 会坐在它之上，不替换它。

**已部分满足 spec 的 3 动机**：
1. "审计全模型可见输入事件流" — 磁盘 JSONL 已捕获全流（非类型化 `Entry` 联合，非 typed `SessionEvent`）。
2. "压缩丢溯源" — PR #114 pre-compact 段永留盘，磁盘保留完整历史；内存 splice 丢前缀是设计行为（释放 context）。
3. "轨迹飞轮临时重构" — collector(`collector.ts:21`) 读 `RawEvent {type?, message?, cwd?}` ad-hoc 重建，**但可用**（22 场景已验证，D1 飞轮已落地 PR #56）。

**决策**：net-new typed 内存层（`SessionEvent`/`surfaceOp`/`deriveMessages` 替换 16 处变更点）= spec 自标 "大改消息管理" 大重构。spec 自定的落地顺序（"先写事件 旁路，后 deriveMessages 替换，后压缩迁移"）印证：step 1（旁路写事件）廉价但产出的 foundation **无消费者**；`deriveMessages`（step 3）必须精确镜像 16 处各异的行为才能过不变量断言 = 重新实现消息管理逻辑 = "大改" 本身。3 动机已部分由磁盘日志服务，无具体故障驱动，违反 simplicity-first。**defer 为显式决策**，非 backlog。

**若需做（spec 的分步路径）**：1. 先 `src/services/session/events.ts` 定义 `SessionEvent`+`SessionEventMap`+`SESSION_FORMAT_VERSION` 类型（纯类型，0 运行时）；2. 在 `QueryEngine` 旁路 emit 事件（不改 `mutableMessages`，双写对照）；3. 写 `deriveMessages()` 投影 + dev 断言 "任何达模型请求的可从日志重构"，逐步对齐 16 处变更点行为；4. 验 `replay 事件流 == 模型历史`；5. 替换 `mutableMessages` 直接维护 → `deriveMessages` 单源；6. 压缩改 emit `compaction/start|end` + `surfaceOp:replace`（替 `:947-964` splice/push）；7. 审计日志 + 轨迹 collector 改读 typed 事件流。每步保现有测试不回归。

## Executor seam (Layer B 自研手接入)

审计（`audit/fusion-code-vs-executor-0825.md`）确立分层：`src/services/llm/` = Layer A（脑，SDK runtime，`@anthropic-ai/sdk` 已移除全自研）；`fusion-executor` = Layer B（手，built-in tools + sandbox，Rust + PyO3，stateless `&self`）。集成 = fusion-code 路由 tool 执行到 executor。PRD 3 阶段（`architecture/fusion-executor-prd.md`）：Phase1 ExecutorDriver 接口 / Phase2 diagnostics 切片 / Phase3 git snapshot + atomic rollback。

### Phase 1 落地（PR #135）

5 新文件 + 2 改，surgical，default-off，禁用 byte-identical。

- `src/services/executor/types.ts` — TS 类型镜像 executor Rust models（snake_case serde verbatim）：`ExecutionRequest` / `ExecutionResult` / `Diagnostics` / `ExecutorStreamChunk`。常量 `EXECUTOR_EXIT_OK=0` / `EXECUTOR_EXIT_TIMEOUT=-124` / `EXECUTOR_EXIT_BLOCKED=-1`。
- `src/services/executor/ExecutorClient.ts` — UDS NDJSON-RPC client（**非** LSP Content-Length framing）。spawn `fusion-executor --serve --sock <path>`（persistent UDS server），spawn-gate 防 ENOENT，`net.createConnection` + 行缓冲 NDJSON（每帧 `serde_json::to_string(resp) + "\n"`）。方法 `health` / `execute` / `executeStream`（多 result 帧共享一 id：chunk...done）/ `stop`。crash handling `isStopping` flag + onCrash。
- `src/services/executor/ExecutorInstance.ts` — state machine `stopped→starting→running→stopping→error`，`MAX_CRASH_RECOVERY=3`，lazy-require client。
- `src/services/executor/manager.ts` — module-scope singleton + generation counter + race-safe `initPromise`（镜像 `lsp/manager.ts`）。`isExecutorEnabled()` gate `isEnvTruthy(FUSION_CODE_EXECUTOR_ENABLED)`，未设 → init no-op（byte-identical）。`registerCleanup` 进程退出停子进程。`getExecutorClient()` 未就绪/失败 → undefined（fail-open）。
- `src/services/executor/executorDriver.ts` — BashTool 委托面。`callBashViaExecutor` async generator：构 `ExecutionRequest`，`executeStream` chunk → progress 协议（回调→队列桥，burst 合并不丢 fullOutput），终态 `ExecutionResult` → `ExecResult`（`code=exit_code`，`interrupted=timed_out`，stdout/stderr 直传）。`isExecutorRouteable` gate 排除 `run_in_background`（issue #1 无 background API）+ `_simulatedSedEdit`。无 client → 返回 null（fail-open）。测试注入缝 `_setExecutorClientForTesting`。
- `src/tools/BashTool/BashTool.tsx` — `call` 顶 lazy-require gate（`isEnvTruthy` 守卫，禁用路径不 require）。`isExecutorRouteable` → `callBashViaExecutor`，否则现有 `runShellCommand`。generator 终态 null → `logExecutorFallback` + 落回 `runShellCommand`。
- `src/main.tsx` — `initializeExecutorManager()`（LSP init 之后，同 trust gate）。

### Wire & 协议

- **wire = NDJSON**（非 vscode-jsonrpc Content-Length）：executor fe-ipc 每帧 `serde_json::to_string(resp) + "\n"`。raw `net.Socket` + 行缓冲。
- **execute_stream**：多 result 帧共享一 request id。chunk `{type:"chunk",data}` ... done `{type:"done",result:ExecutionResult}`。
- **exit codes**：0=ok，-124=timeout，-1=blocked/internal。

### Gate & fail-open

- gate：`isEnvTruthy(process.env.FUSION_CODE_EXECUTOR_ENABLED)`（1/true/yes/on）。默认 off → BashTool 走 `runShellCommand`，零差异。
- fail-open：executor 二进制缺失 / init 失败 / crash → `getExecutorClient()` undefined → `callBashViaExecutor` 返 null → BashTool 落回 in-process `runShellCommand`，log warning。
- background 命令保留 fusion-code `spawnShellTask` 自有路径（executor issue #1 无 background 支持）。

### Phase 2/3 落地（PR #139，上游阻塞解除）

executor v0.2.0 上游 12 issues 全 CLOSED。本 PR = fusion-code 侧 wiring，surgical，default-off，fail-open，禁用 byte-identical。

**Phase 2（diagnostics 切片，降 Token）**：executor `execute_stream` 服务端自动填 `ExecutionResult.diagnostics`（slicer：优先 stderr 非空 else stdout，tail 30 行，regex TS→Python→Node→Bun→Rust→Go→Swift，返 `{error_type?, file_path?, line_number?, code_snippet?, raw_trace?}`）。Phase 1 的 `mapResult` 丢弃它；本 PR 保留并透传 `ExecResult.diagnostics`。失败路径用切片替全量 bash 输出（PRD 降 Token 目标），成功路径不改（exit 0 不触失败分支，surgical）。无独立 `diagnostics()` RPC（服务端 in-band 自动填）。

**Phase 3（git snapshot + atomic rollback）**：`auto_rollback` = 单次调用自洽（call 开头建快照，`exit_code!=0` + 文件毁损 diff>0 时回滚，设 `auto_rolled_back=true`），caller 无法注入外部 snapshot_id。`buildRequest` 传 `cwd`（snapshot 需；非 repo 返 null 安全），`enable_rollback_snapshot:true` 硬编码。`auto_rollback_policy` **opt-in 独立 env gate** `FUSION_CODE_EXECUTOR_AUTO_ROLLBACK`（default off）——auto-rollback 在 `exit!=0` + 文件 diff 时回滚会撤销模型合法编辑，破坏 edit-test-fail 编码循环，故不随 executor enable 自动开。回滚后前置 `<note>Working tree auto-reverted via git snapshot...</note>` 告知模型。`max_consecutive_failures` 死字段（Rust 不读），caller owns failure-count loop。

- `src/utils/ShellCommand.ts` — `ExecResult` +3 可选字段（`diagnostics`/`autoRolledBack`/`snapshotId`）。内联 `Diagnostics` 结构类型（不引 `executor/types` → 保 utils < services 依赖方向，解循环依赖）。顶层 camelCase 匹 ExecResult 约定，嵌套 diagnostics 保 snake_case 匹 wire（透传不改）。
- `src/services/executor/executorDriver.ts` — `mapResult` 保留 diagnostics/snapshot/rollback；`buildRequest` 传 `cwd` + opt-in `auto_rollback_policy`；两条 `logForDebugging`（diagnostics + rollback state，新路径默认日志）。
- `src/tools/BashTool/BashTool.tsx` — 失败路径 `formatDiagnosticsForModel` 切片替全量 + 回滚 `<note>` 前置。无切片（in-process / executor 无切片）→ 全量不变 byte-identical。
- `src/tools/BashTool/bashDiagnostics.ts`（新）— 纯 helper（`formatDiagnosticsForModel`），提取出单测，不依赖 BashTool 模块图。
- `src/__tests__/tools/BashTool/bashDiagnostics.test.ts`（新）— 8 测。
- `src/__tests__/services/executor/executorDriver.test.ts` — +8 测（mapResult passthrough：diagnostics/snapshot_id/auto_rolled_back；buildRequest：cwd、auto_rollback policy on/off、enable_rollback_snapshot 回归）。

**default-off byte-identical**：`FUSION_CODE_EXECUTOR_ENABLED` 未设 → `isExecutorRouteable` false → executorDriver 不触；in-process path 不设 diagnostics/autoRolledBack/snapshotId → `formatDiagnosticsForModel` 返全量 → `ShellError('', fullOutput)` 同今日。

### Scope-creep（显式 defer）

- 手动 turn-boundary snapshot/rollback（PRD line 160 retry-3x）— **已由 PR #139 in-band per-command auto-rollback 满足**，不另做。PRD line 160 原意 = "调用 executor 前建快照，失败触发 rollback()"，PR #139 `buildRequest` 传 `auto_rollback_policy`（opt-in `FUSION_CODE_EXECUTOR_AUTO_ROLLBACK`），executor 在 call-start 建快照、`exit!=0` + 文件毁损 diff>0 时回滚、设 `auto_rolled_back=true`、模型见 `<note>`，正是该语义。文件毁损 diff 守卫比 PRD 原始 "retry 3x then rollback"（盲目回滚）更安全——仅当文件被*损坏*时回滚，不撤销 edit-test-fail 循环中的合法编辑。client-orchestrated whole-turn revert 变体（显式 `executor.snapshot_create`/`executor.rollback` RPC + turn lifecycle wiring）**架构上劣于** in-band 方案：(a) whole-turn revert 丢失模型好的编辑（per-command file-damage guard 不丢）；(b) 需在 query.ts 新增 failure counter + terminal-reason 上抛 REPL（REPL.tsx:3841 `for await` 丢弃 query 返回值，无捕获路径）；(c) PRD retry-3x 是 Python HealingSession 伪码（固定计数器），fusion-code loop 是 model-driven（模型自己重试），固定计数器不映射；(d) 暴露无 caller 的显式 RPC = 投机死码（违反 simplicity）。故 defer 为显式决策，非 backlog。
- 进程内输出切片（非 executor 路径）— 需 TS 移植 Rust slicer 或 out-of-band diagnostics RPC，defer。

### 测试

- `manager.test.ts` — env gate（truthy/falsy/unset）、disabled byte-identical（init no-op）、enabled-but-binary-missing fail-open、singleton + generation counter。
- `executorDriver.test.ts` — `isExecutorRouteable`（5 cases）、fail-open null、result mapping（normal/timeout/blocked）、streaming chunk→progress（fullOutput 累积）、reject null、no-chunks 0 frames。+8 Phase 2/3 测（mapResult passthrough + buildRequest cwd/policy）。注入缝避免 `mock.module` 跨文件污染。
- `bashDiagnostics.test.ts` — undefined→全量不变、切片替全量、auto_rolled_back `<note>` 前置（有/无 snapshotId）、无 note（false/undefined）、部分字段缺失、omit line_number 后缀。


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
