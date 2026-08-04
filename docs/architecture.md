# fusion-code 高层架构

fusion-code 是基于 Anthropic Claude Code 的 fork（`@fusion-mlx/fusion-code`，0.2.0 即将发布），深度集成 fusion-mlx 本地 MLX 推理。仓库地址 github.com/dahai80/fusion-code。

本文描述从启动到模型调用的完整链路，以及核心子系统划分。

## 启动链路

```
src/entrypoints/cli.tsx
  ├─ 设置 FUSION_CODE_CONFIG_DIR=~/.fusion-code
  ├─ FUSION_* -> ANTHROPIC_* env 映射（SDK 兼容）
  ├─ fast-path 分发
  │    ├─ --version / -v          零依赖输出
  │    ├─ --dump-system-prompt     渲染 system prompt 后退出
  │    ├─ bridge/daemon/ps 模式    子命令直接派发
  │    └─ bg 模式                  后台会话
  └─ 兜底 -> src/main.js -> cliMain() -> src/screens/REPL.tsx
```

`cli.tsx` 在文件顶部即完成 env 映射，规则为：仅当 `ANTHROPIC_*` 未设置时，用 `FUSION_*` 回填。映射项见 `FUSION_* env 映射表`（development.md）。

fast-path 的意义是避免加载完整 REPL 依赖树，`--version` 可做到零 import。

## REPL 主界面

`src/screens/REPL.tsx` 是 React/Ink 终端 UI：

- 每个会话对应一个 `QueryEngine` 实例
- `submitMessage()` 启动一个新 turn
- 处理 keybindings、voice input、task list、compaction、tool permission、session 管理

## LLM 查询流水线

`src/QueryEngine.ts` 协调消息流、工具调用与模型调用，持有 session 状态：

| 字段 | 类型 | 说明 |
|------|------|------|
| `mutableMessages` | `Message[]` | 当前会话可变消息列表 |
| `abortController` | `AbortController` | 当前 turn 的取消句柄 |
| `totalUsage` | `NonNullableUsage` | 累计 token 用量 |

一次 turn 的流程：

1. `submitMessage(userInput)` 追加 user message
2. 构建请求（system prompt + tools + messages）
3. 调用 `services/api/` 中对应 provider 的 client
4. 流式接收 assistant message，解析 `tool_use` block
5. 执行 tool，追加 `tool_result`
6. 循环直到 `stop_reason=end_turn`

## 命令与工具注册

### commands.ts

`src/commands.ts` 注册约 40+ slash 命令，实现位于 `src/commands/`。feature-gated 命令在 flag 关闭时被 DCE 移除。

### tools.ts

`src/tools.ts` 注册 30+ agent 工具，实现位于 `src/tools/`。同样受 feature flag DCE 控制。

### tasks.ts

`src/tasks.ts` 注册后台任务类型，feature-gated。

## 核心子系统

### services/api - API 客户端

| 文件 | 职责 |
|------|------|
| `claude.ts` | 主 Anthropic API 客户端（云端 firstParty 路径） |
| `fusion-mlx-adapter.ts` | 本地 MLX 适配器，拦截 `/v1/messages` 转发到 127.0.0.1:11432 |
| `fusion-mlx-stream.ts` | MLX 流式响应转 Anthropic SSE 格式 |
| `fusion-mlx-tool-validator.ts` | 工具调用 JSON 校验与修复 |
| `fusion-mlx-types.ts` | MLX 类型定义 |
| `codex-fetch-adapter.ts` | OpenAI Codex 适配（feature-gated） |
| `withRetry.ts` | API 重试策略 |
| `errors.ts` | 错误分类与处理 |

### services/compact - 上下文压缩

| 文件 | 职责 |
|------|------|
| `autoCompact.ts` | 自动压缩，MLX 阈值 60%（云端 ~93%） |
| `reactiveCompact.ts` | `prompt-too-long` 错误后的反应式压缩（phase 8 补齐） |
| `microCompact.ts` | 微压缩，针对单条超长消息 |
| `cachedMicrocompact.ts` | 缓存型微压缩状态 |
| `compact.ts` | 压缩主逻辑 |
| `postCompactCleanup.ts` | 压缩后清理：清缓存 + `closeFilesNotIn(activeFilePaths)` 关闭非活跃 LSP 文件 |
| `prompt.ts` | 压缩 prompt 模板 |
| `sessionMemoryCompact.ts` | 会话记忆压缩 |

`postCompactCleanup` 的 LSP 集成：通过 `getLspServerManager()?.closeFilesNotIn(activeFilePaths)` fire-and-forget 关闭压缩后不再活跃的文件，释放 LSP server 内存。该调用在 autoCompact、reactiveCompact、manual `/compact` 三条路径都会触发，`querySource` 为 `agent:*` 的子代理压缩会跳过 main-thread 模块级状态重置，避免污染主线程。

### services/mcp - Model Context Protocol

- `MCPConnectionManager.tsx` - 连接管理
- `client.ts` - MCP 客户端（118KB，功能完整）
- `auth.ts` - MCP OAuth
- `config.ts` - MCP server 配置
- `useManageMCPConnections.ts` - React hook
- `InProcessTransport.ts` / `SdkControlTransport.ts` - 传输层
- `elicitationHandler.ts` - elicitation 流程
- `channelAllowlist.ts` / `channelPermissions.ts` - channel 权限

### services/lsp - Language Server Protocol

| 文件 | 职责 |
|------|------|
| `LSPClient.ts` | LSP 客户端 |
| `LSPServerManager.ts` | 多 server 管理 |
| `LSPServerInstance.ts` | 单 server 实例 |
| `LSPDiagnosticRegistry.ts` | 诊断信息注册表 |
| `manager.ts` | 统一入口 `getLspServerManager()` |
| `config.ts` | 配置 |
| `passiveFeedback.ts` | 被动反馈 |

### services/oauth

Anthropic 与 OpenAI 的 OAuth 流程。

## Provider 系统

`src/utils/model/providers.ts` 定义 `APIProvider` 类型与选择逻辑。

### 6 个 provider

| Provider | 说明 |
|----------|------|
| `fusionMlx` | 本地 MLX 推理（127.0.0.1:11432），默认 |
| `firstParty` | Anthropic API（`FUSION_API_KEY` / `ANTHROPIC_API_KEY`） |
| `openai` | OpenAI（`FUSION_CODE_USE_OPENAI=1`） |
| `foundry` | Azure Foundry（`FUSION_CODE_USE_FOUNDRY=1`） |
| `bedrock` | AWS Bedrock（`FUSION_CODE_USE_BEDROCK=1`） |
| `vertex` | GCP Vertex（`FUSION_CODE_USE_VERTEX=1`） |

### getAPIProvider() 选择优先级

1. `FUSION_MLX_DISABLED=1` -> 跳过本地，走云端
2. `FUSION_MLX_ENABLED=1` -> `fusionMlx`
3. `FUSION_CODE_USE_FOUNDRY=1` -> `foundry`
4. `FUSION_CODE_USE_OPENAI=1` -> `openai`
5. 无 `FUSION_API_KEY` -> 默认 `fusionMlx`（本地零配置）
6. 否则 -> `firstParty`

### shouldAutoUseFusionMlx()

检测 11432 端口可用性，自动选择一个 code-capable 文本模型。本地模型能力检测见 `getMlxModelCapabilities(modelId)`：tool calling / vision / streaming 能力 + per-model `max_input_tokens`（不再硬编码 32K）。

### 模型解析优先级

```
session override (/model)
  > --model flag
  > FUSION_MODEL / FUSION_MLX_MODEL env
  > saved settings
```

详细配置示例见 model-providers.md。

## Build 系统

`scripts/build.ts` 使用 Bun 原生 bundler（`bun build --compile`）。

### feature flag DCE 机制

- Feature flags 通过 `--feature=NAME` 传入
- 代码中用 `feature('X')` 调用（来自 `bun:bundle`）
- flag 关闭时，`feature('X')` 被替换为 `false`，Bundler 进行死代码消除
- flag 开启时，`feature('X')` 被替换为 `true`，对应代码进入 bundle

### 构建时宏

| 宏 | 值 |
|----|----|
| `MACRO.VERSION` | `pkg.version`（dev 构建带时间戳+sha） |
| `MACRO.BUILD_TIME` | ISO 时间戳 |
| `MACRO.PACKAGE_URL` | `@fusion-mlx/fusion-code` |
| `MACRO.VERSION_CHANGELOG` | dev: git log -20; 正式: github URL |
| `process.env.USER_TYPE` | `"external"` |
| `process.env.CLAUDE_CODE_FORCE_FULL_LOGO` | `"true"` |
| `process.env.CLAUDE_CODE_EXPERIMENTAL_BUILD` | dev 构建时 `"true"` |

### 排除的原生模块

`@ant/*`、`audio-capture-napi`、`image-processor-napi`、`modifiers-napi`、`url-handler-napi` 不打入 bundle，运行时按需加载。

详细构建命令与 feature flag 用法见 development.md 与 feature-flags.md。

## 调试日志

- 启动加 `FUSION_LOG=debug` 可开启 SDK 级日志（映射到 `ANTHROPIC_LOG`）
- MLX 适配器日志在 `fusion-mlx-adapter.ts` / `fusion-mlx-stream.ts`，默认带 console 输出
- 压缩日志在 `services/compact/*.ts`，关键路径均有日志
- 查看构建详情：`bun run ./scripts/build.ts --dev --feature=XXX` 观察模块数与退出码
