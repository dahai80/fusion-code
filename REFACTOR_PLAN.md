# Fusion-Code 重构计划

## 现状诊断

### 核心问题

Fusion-code 是从 Claude Code 源码映射（sourcemap 暴露）+ free-code fork 衍生的项目，当前代码量 52 万行（1962 文件），但存在以下致命问题：

**1. 云端残留造成启动/运行障碍**
- 337 处 `process.env.USER_TYPE === 'ant'` 条件分支（Anthropic 内部专用）
- 540 处 `isClaudeAISubscriber/getClaudeAIOauthTokens/anthropic.com` 引用
- 2391 处 telemetry/analytics 代码（GrowthBook、StatSig、Sentry、OpenTelemetry）
- OAuth 流程、API key 验证、订阅检查等云端流程在本地模式下仍会执行
- 启动时 `checkAndRefreshOAuthTokenIfNeeded()` 被调用，无 API key 时阻塞

**2. System Prompt 过长且不匹配本地模型**
- System prompt 约 900 行，含大量 Claude 专用指令（cyber_risk、guardrails、ant override 等）
- 本地 MLX 模型上下文窗口有限（7B-32B 模型通常 8K-32K tokens），prompt 就占了大部分
- `CYBER_RISK_INSTRUCTION`、`getAntModelOverrideSection()` 等对本地模型是噪声
- 工具描述庞大（30+ 工具每个都有详细 schema），远超小模型承载能力

**3. MLX 适配层是"补丁式"实现**
- `createFusionMlxFetch()` 拦截 Anthropic SDK 的 `/v1/messages` 请求，转换格式后代理到 MLX
- 工具调用通过 `response_format` + JSON Schema 约束输出，但小模型对复杂 schema 的遵从度差
- 流式转换 `transformMLXStreamToAnthropic` 存在 tool call 解析 bug（arguments 双重发送）
- `convertAnthropicBodyToMLX` 重复了 `anthropicToMlxMessages` 的逻辑
- `max_tokens` 硬编码限制为 4096，不合理

**4. 巨型文件难以维护**
- `main.tsx` (4733行)、`REPL.tsx` (5009行)、`query.ts` (1729行) 承载过多职责
- `print.ts` (5594行) 是非交互模式代码，本地 vibe coding 基本不用
- `claude.ts` (3425行) 是 Anthropic API 客户端，大量云端逻辑

**5. 本地模型工具调用能力不足**
- 小模型（7B-32B）对 Anthropic 格式 tool_use 的理解能力有限
- 当前方案用 `response_format` + oneOf schema 约束，但 outline/xgrammar 对复杂 schema 支持不稳定
- 没有 fallback 机制：tool call 解析失败时直接报错，不能优雅降级

## 重构策略：分阶段、可运行

核心原则：**每一步都能 `bun run build && ./cli` 正常启动**，不搞大爆炸重写。

---

### Phase 1: 清理云端残留（预计 1-2 天）

**目标**：移除所有云端死代码，让 fusion-mlx 成为唯一默认后端

**步骤**：
1. **移除 Anthropic 内部代码**
   - 删除所有 `process.env.USER_TYPE === 'ant'` 分支（保留 else 分支）
   - 删除 `isUndercover()` 相关代码
   - 删除 `CYBER_RISK_INSTRUCTION` 引用
   - 删除 `getAntModelOverrideSection()`

2. **移除 telemetry/analytics 存根**
   - 将 `logEvent()` / `logAntError()` 替换为空函数
   - 移除 GrowthBook/StatSig 初始化代码
   - 保留 `getFeatureValue_CACHED_MAY_BE_STALE` 的本地 fallback（feature flags 仍需要）
   - 移除 OpenTelemetry 相关依赖

3. **简化启动流程**
   - `getAnthropicClient()` 中 fusion-mlx 路径提前，跳过 OAuth/API key 检查
   - 删除 `checkAndRefreshOAuthTokenIfNeeded()` 在 MLX 模式下的调用
   - 删除 `isClaudeAISubscriber()` / `getClaudeAIOAuthTokens()` 在 MLX 模式下的逻辑

4. **精简依赖**
   - 从 package.json 移除 `@opentelemetry/*`、`@growthbook/*` 等
   - 移除 `@azure/identity`（Foundry 专用）
   - 保留 `@anthropic-ai/sdk`（MLX 适配器仍需要其类型）

**验证**：`bun run build && ./cli` 能启动，自动连接 fusion-mlx

---

### Phase 2: 优化 System Prompt（预计 1 天）

**目标**：将 system prompt 从 ~8000 tokens 压缩到 ~2000 tokens

**步骤**：
1. **重写 `src/constants/prompts.ts`**
   - 删除所有 Claude 专用的 prompt 段落（cyber risk、ant override、guardrails）
   - 合并重复的 instruction 段落
   - 简化工具描述：只保留工具名+1行说明+参数列表，删除冗长的使用指南
   - 环境信息只保留必要的（cwd、平台、shell）

2. **实现动态 prompt 裁剪**
   - 根据当前模型的 `max_input_tokens` 自动裁剪 prompt
   - 7B 模型：只保留核心指令 + 最少工具
   - 32B 模型：保留完整指令 + 所有必要工具
   - 新增 `getPromptSizeForModel(modelId)` 工具函数

3. **工具子集选择**
   - 新增 `getToolSubsetForModel(modelId, allTools)` 函数
   - 小模型只启用：Bash、Read、Write、Edit、Glob、Grep（6 个核心工具）
   - 大模型可启用：+ AskUser、LSP、WebFetch 等

**验证**：启动后 system prompt 不超过目标模型的 25% 上下文窗口

---

### Phase 3: 修复 MLX 适配层（预计 1-2 天）

**目标**：工具调用稳定可靠，流式输出无 bug

**步骤**：
1. **修复流式 tool call 解析 bug**
   - `processChunk()` 中 `currentToolCall.arguments` 在 close 时被重复发送
   - 重构流状态机，确保 content_block_start/delta/stop 严格成对

2. **统一格式转换**
   - 合并 `anthropicToMlxMessages()` 和 `convertAnthropicBodyToMLX()` 为一个函数
   - 合并 `anthropicToMlxTools()` 和 `cleanToolList()`

3. **实现工具调用降级**
   - 当模型返回的 tool_call 解析失败时，不直接报错
   - 策略 1：尝试从纯文本中提取 JSON 工具调用（正则匹配）
   - 策略 2：如果无法提取，将模型响应当纯文本展示，提示用户重新表达需求
   - 新增 `gracefulToolCallParse()` 函数

4. **修复 max_tokens 逻辑**
   - 移除 `createFusionMlxFetch` 中的硬编码 `Math.min(body.max_tokens || 2048, 4096)`
   - 根据模型配置动态计算：`max_output_tokens = min(model.maxOutputTokens, remaining_context)`

5. **添加重试和超时策略**
   - MLX 首次推理有 warm-up 延迟，超时应更长
   - 连接失败时自动重试 1 次
   - 新增 `FUSION_MLX_WARMUP_TIMEOUT_MS` 环境变量

**验证**：用 Qwen2.5-Coder-7B 完成一个文件编辑任务，工具调用 100% 成功

---

### Phase 4: 简化核心流程（预计 2-3 天）

**目标**：砍掉对本地 vibe coding 无用的模块，减少维护负担

**步骤**：
1. **删除非交互模式**（`src/cli/print.ts` - 5594行）
   - 本地 vibe coding 只用 REPL 交互模式
   - 保留 `-p` 单次提问模式，但大幅简化

2. **删除云端专属功能**
   - Bridge 模式（`src/bridge/`）- IDE 远程控制
   - Daemon 模式（`src/main.tsx` 中的 daemon 分支）
   - 后台会话（`src/tasks/` 中的 RemoteAgentTask）
   - 插件市场（`src/utils/plugins/marketplaceManager.ts`）
   - Codex 适配器（`src/services/api/codex-fetch-adapter.ts`）
   - Foundry 适配器（`@anthropic-ai/foundry-sdk`）
   - Bedrock/Vertex 适配

3. **精简命令集**
   - 从 40+ 命令精简到核心 15 个：help, clear, compact, config, cost, diff, doctor, init, login, logout, memory, model, resume, session, status
   - 删除：autofix-pr, backfill-sessions, btw, good-claude, issue, feedback, commit-push-pr, mobile, onboarding, pr_comments, release-notes, rename, share, skills, teleport, security-review, bughunter, workflows, remote-setup

4. **精简工具集**
   - 核心 10 个：Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion, LSP, WebFetch, WebSearch
   - 有条件启用：Agent（大模型）、NotebookEdit（检测 .ipynb 时）、TaskCreate/List/Update（大模型）
   - 删除：SendMessage, TeamCreate/Delete, BriefTool, CronCreate/Delete/List, SleepTool, MonitorTool, TungstenTool, EnterWorktree/ExitWorktree, REPLTool, VerifyPlanExecution

5. **拆分 main.tsx**
   - 提取启动逻辑到 `src/bootstrap/startup.ts`
   - 提取非交互模式到 `src/modes/nonInteractive.ts`
   - main.tsx 只保留 REPL 入口调度

**验证**：代码量减少 30%+，所有核心功能正常

---

### Phase 5: 增强本地模型体验（预计 2-3 天）

**目标**：让本地 MLX 模型的 vibe coding 体验接近 Claude Code

**步骤**：
1. **模型预热和切换**
   - 启动时自动检测 fusion-mlx 上的可用模型
   - 实现 `fusion-mlx start --model <recommended>` 自动拉起
   - `/model` 命令展示本地可用模型列表
   - 支持大小模型协作：复杂任务自动路由到 32B 模型

2. **智能上下文管理**
   - 本地模型上下文窗口有限，需要更激进的 compact
   - 实现"渐进式工具结果压缩"：大文件内容自动摘要
   - 对话超过 80% 上下文窗口时主动触发 compact

3. **工具调用优化**
   - 为小模型简化工具 schema：减少嵌套、移除 optional 字段
   - 实现"两步工具调用"：先让模型说意图，再由代码构造精确参数
   - 添加工具调用模板：常见操作（读文件、编辑代码）有预定义格式

4. **fusion-mlx 深度集成**
   - 自动检测模型能力（tool calling 支持度、vision 支持度）
   - 根据模型能力动态调整工具集和 prompt
   - 实现 MLX 模型热切换（不重启 fusion-code）

**验证**：用 7B 模型完成一个完整的 bug 修复流程，用 32B 模型完成一个功能开发流程

---

## 风险和缓解

| 风险 | 缓解 |
|------|------|
| 删除云端代码后某些共享依赖断裂 | Phase 1 每删一个模块就 build 一次 |
| 小模型工具调用不稳定 | Phase 3 降级机制 + Phase 5 两步调用 |
| system prompt 裁剪过度导致能力下降 | 保留核心指令不变，只删 Claude 专用噪声 |
| 重构期间功能回退 | 每个 Phase 有独立验证点 |
| fusion-mlx 服务不稳定 | 添加健康检查和自动重启机制 |

## 成功标准

1. `./cli` 一键启动，自动连接本地 fusion-mlx，无需任何 API key
2. 7B 模型能完成简单的文件编辑和代码查看任务（工具调用成功率 > 90%）
3. 32B 模型能完成完整的功能开发流程（接近 Claude Code 基本体验）
4. 代码量 < 35 万行（当前 52 万行），核心模块单文件 < 1000 行
5. 启动时间 < 2 秒（当前因云端检查需要 5+ 秒）
