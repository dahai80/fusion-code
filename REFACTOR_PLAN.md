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

### Phase 3: 修复 MLX 适配层 ✅ COMPLETED

**目标**：工具调用稳定可靠，流式输出无 bug

**步骤**：
1. ✅ **修复流式 tool call 解析 bug**
   - 移除 `processChunk()` 中 close 时重复发送 `currentToolCall.arguments` 的问题
   - 重构流状态机，确保 content_block_start/delta/stop 严格成对
   - 修复 processChunk 提前关闭 textBlock 导致文本嵌入工具调用提取被跳过的 bug

2. ✅ **统一格式转换**
   - 合并 `anthropicToMlxMessages()` 和 `convertAnthropicBodyToMLX()` 为一个函数
   - 合并 `anthropicToMlxTools()` 内部调用 `cleanToolList()`

3. ✅ **实现工具调用降级**
   - 新增 `extractToolCallsFromText()` — 从纯文本提取 JSON 工具调用（3种模式：XML/代码块/裸JSON）
   - 新增 `tryParseToolCallJson()` — 解析和校验工具调用 JSON
   - 新增 `repairToolCallJson()` — 修复常见 JSON 错误（围栏/括号/逗号/引号）
   - 流式和非流式路径都支持文本嵌入工具调用提取
   - 提取后自动覆盖 stop_reason 为 `tool_use`

4. ✅ **修复 max_tokens 逻辑**
   - 移除 `createFusionMlxFetch` 中的硬编码 `Math.min(body.max_tokens || 2048, 4096)`
   - 默认值改为 8192，无人工上限

5. ✅ **添加重试和超时策略**
   - 新增 `mlxFetchWithRetry()` — 连接失败自动重试 1 次（3s 延迟）
   - 检测 ECONNREFUSED/ECONNRESET/fetch failed/socket hang up/AbortError
   - 新增超时常量：WARMUP=60s, STREAM=300s, QUERY=120s

**验证**：✅ Qwen2.5-Coder-32B 成功调用 Read 工具，stop_reason=tool_use，工具执行被触发

---

### Phase 4: 简化核心流程 ✅ COMPLETED

**目标**：砍掉对本地 vibe coding 无用的模块，减少维护负担

**步骤**：
1. ✅ **删除云端专属命令**（Batch 1）
   - 删除 40+ cloud-only 命令目录
   - 清理 src/commands.ts 中的引用

2. ✅ **删除云端专属工具**（Batch 2）
   - 删除 16 个 cloud-only 工具目录
   - 清理 src/tools.ts 中的引用

3. ✅ **删除云端专属模块**（Batch 3）
   - 删除 bridge/ 目录（31 文件），替换为 13 个 stub
   - 删除 codex-fetch-adapter、RemoteAgentTask、marketplaceManager
   - 修复所有跨模块引用

4. ✅ **删除云端专属 feature flags**（Batch 4）
   - 从 fullExperimentalFeatures 移除 17 个 cloud-only flags
   - 移除 process.env.CCR_FORCE_BUNDLE define
   - 三种构建配置均通过

**验证**：代码量减少 30%+，所有核心功能正常

---

### Phase 5: 增强本地模型体验 ✅ COMPLETED

**目标**：让本地 MLX 模型的 vibe coding 体验接近 Claude Code

**完成内容**：

1. **模型预热和切换** ✅
   - 启动时自动检测 fusion-mlx 上的可用模型（`checkFusionMlxHealth` + `getFusionMlxModels`）
   - `/model` 命令展示本地可用模型列表（`prefetchLocalModelOptions` → `ModelPicker`）
   - 模型验证走本地 fast path（无需 API 调用）

2. **智能上下文管理** ✅
   - MLX auto-compact 阈值降至 60%（vs 云端 ~93%），更早压缩
   - MLX warning/error/manual buffer 缩小（3K/2K/500 vs 20K/20K/3K）
   - 工具结果持久化阈值降至 15K chars（vs 50K），per-message budget 降至 60K（vs 200K）
   - 所有阈值通过 `isFusionMlxProvider()` 自动切换

3. **工具调用优化** ✅
   - MLX 工具过滤器默认启用：≤3B→5 core tools, 7-9B→10 tools, 其余→full set
   - 工具描述截断 200 chars，属性描述截断 80 chars（节省 context tokens）
   - Schema 清洗移除 additionalProperties/$schema/default 等干扰字段

4. **fusion-mlx 深度集成** ✅
   - `getMlxModelCapabilities(modelId)`: 检测 tool calling/vision/streaming 能力
   - per-model context window 从 API 获取（`max_input_tokens`），不再硬编码 32K
   - 能力缓存 + `clearMlxCapabilitiesCache()` 支持模型热切换

---


### Phase 6: Prompt 质量跃迁 — 行为协议 ✅ COMPLETED

**目标**：从"语言教程"转向"行为协议"，缩小与 Claude Code 170K prompt 的定性差距

**核心洞察**：Claude Code 的 170K prompt 不是编程教程（模型本身就会写代码），而是精确的行为控制规则——"遇到 X 做 Y，如果 Z 则回退到 A"。语言教程是模型已知的通用知识，行为协议才是真正缺少的。

**完成内容**：

1. **行为协议层** (`src/constants/behavioral-protocols.ts`, 315 行, 8 个协议, 52 条决策规则) ✅
   - 工具调用决策协议：哪种工具、何时使用、并行/串行、失败处理
   - 文件编辑协议：先读后写、原子编辑、多文件变更、编辑后验证
   - 任务执行协议：理解→范围→执行→验证，检查点模式
   - 错误恢复协议：4 级分类（可修复/替代方案/阻塞/不可恢复）
   - 上下文预算协议：token 感知、读取策略、压缩存活
   - 多轮对话协议：连续性、压缩处理、意图检测、范围管理
   - 歧义消解协议：何时询问/何时假设、假设文档化、冲突解决
   - 输出格式协议：按复杂度分级、包含/排除规则、本地模型特殊处理

2. **场景协议层** (`src/constants/scenario-protocols.ts`, 323 行, 10 个场景) ✅
   - Bug 修复 / 功能实现 / 重构 / 代码审查 / 调试
   - 依赖变更 / 数据库变更 / API 变更 / 安全变更 / 性能变更

3. **MLX prompt 层级重组** ✅
   - 行为协议前置到 Standard (7B+)——小模型更需要"用哪个工具"的规则
   - 场景协议在 Extended (14B+)——中等模型能执行多步骤场景流程
   - 语言/领域教程保持在 Full (32B+)——只有大模型才有余力遵循
   - 总 sections：44 → 62

**关键转变**：
| 维度 | Phase 5 | Phase 6 |
|------|---------|---------|
| Standard (7B+) | 通用规则 | +5 行为协议 |
| Extended (14B+) | 语言教程 | +10 场景协议 |
| Full (32B+) | 全部堆砌 | 领域协议 + 语言教程降级 |
| 决策规则数 | ~15 条 | 52+ 条 |
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
