# Fusion-Code vs Claude Code 深度对比审计

> 生成日期: 2026-07-22
> 目标: 逐层对比 Claude Code 的6层架构优势，识别 fusion-code 中的欠缺项，制定补齐计划

---

## 一、专家意见补充分析

专家团指出三个核心差距维度：

### 1. Harness（模型外套）差距
| 维度 | Claude Code | Fusion-Code | 差距 |
|------|-------------|-------------|------|
| 17万行编程专用 Prompt | 完整 system prompt 模板库 | MLX 用精简 prompt，缺项目规范自动注入 | ❌ 关键 |
| 长上下文压缩引擎 | 5级 compact + prompt cache 分区 | compact 有，MLX prompt cache 缺 | ⚠️ 中 |
| 工具调用严格协议 | 格式校验 + 重试 + 升级 | 格式提取有，缺重试和升级 | ❌ 关键 |
| 项目规范自动注入 | 自动读 package.json/eslintrc/tsconfig/.gitignore → context | 依赖 /init 手动，无自动注入 | ❌ 关键 |

### 2. 专家指出的 "Trae 病根" 在 Fusion-Code 中的映射
- ❌ **Prompt 模板短、通用化** → MLX `getMlxSystemPrompt()` 只返回 ~30 行指令，远少于 Claude Code 的 10+ 动态分区
- ❌ **上下文管理简单，多轮后截断** → MLX 有 compact，但缺少项目规范自动注入，上下文质量低
- ⚠️ **工具调用格式松散** → 有 6 种提取模式，但缺 validateToolCall 集成、重试指导和 MLX max_tokens 升级（现已补齐）

### 3. 工具调用能力（Tool Call Capability）对比

> 专家团第三维度：对比 Claude Code vs Trae 的工具调用四子维度，映射到 Fusion-Code

#### 3.1 严格工具调用协议 + 格式校验

| 维度 | Claude Code | Fusion-Code | 状态 |
|------|-------------|-------------|------|
| 工具调用提取 | 结构化 `tool_use` block（SDK 原生） | 6 模式提取（XML/函数调用/代码块/裸JSON/OAI/Qwen-XML） | ✅ 比云更强 |
| JSON 格式校验 | SDK 内置 Zod safeParse | `validateToolCall()` + `repairToolCallJson()` 双层修复 | ✅ 已补齐 |
| Schema 清洗 | 完整 schema 直传 | `cleanToolList()` 截断描述 + 移除复杂嵌套 | ✅ MLX 适配 |
| 校验集成到管线 | Zod → validateInput → permission → execute | `validateToolCall` 现已集成到 stream/non-stream 路径 | ✅ 已补齐 |

#### 3.2 强制校验 + 重试 + 熔断

| 维度 | Claude Code | Fusion-Code | 状态 |
|------|-------------|-------------|------|
| Zod safeParse 校验 | ✅ 失败返回 `InputValidationError` | ✅ 同样实现 | ✅ 对齐 |
| parse 失败重试指导 | 错误消息引导模型修正 | `_parse_error` 检测 → 重试指导消息 | ✅ 已补齐 |
| max_tokens 升级 | `tengu_otk_slot_v1` GrowthBook 门控 | MLX provider 自动绕过门控 | ✅ 已补齐 |
| 非流式升级 | N/A（云模型自动处理） | `MLX_MAX_TOKENS_ESCALATION_FACTOR=2` 自动翻倍 | ✅ 已有 |
| Structured output 重试 | 5 次重试上限 | `MAX_STRUCTURED_OUTPUT_RETRIES=5` | ✅ 对齐 |
| 连接失败重试 | SDK 内置 | `MAX_RETRIES=1` + 指数退避 | ⚠️ 仅1次 |

#### 3.3 链式工具调用稳定性（read → analyze → edit → test → edit）

| 维度 | Claude Code | Fusion-Code | 状态 |
|------|-------------|-------------|------|
| 多轮工具链 | 完整，maxTurns 保护 | ✅ 同样实现 | ✅ 对齐 |
| 工具结果持久化 | 完整 | `toolResultStorage.ts` + MLX 阈值截断 | ✅ 对齐 |
| Reactive compact | 413 时自动压缩重试 | `reactiveCompact.ts` + `feature('REACTIVE_COMPACT')` | ✅ 已有 |
| 中断恢复 | session 持久化 | ✅ session 存储 | ✅ 对齐 |
| 工具调用摘要 | `generateToolUseSummary()` | ✅ 已实现 | ✅ 对齐 |

#### 3.4 技能生态（230+ skills for test/review/deploy）

| 维度 | Claude Code | Fusion-Code | 状态 |
|------|-------------|-------------|------|
| 内置技能 | ~20+ slash commands | 40+ slash commands | ✅ 更丰富 |
| Workflow 编排 | `Workflow` 工具（agent/parallel/pipeline） | ❌ 已移除（cloud-only） | ❌ 缺失 |
| Cron/Loop | 4 个 Cron 工具 + ScheduleWakeup | 基础设施有，工具未注册 | ❌ 缺失 |
| ReportFindings | 结构化审查报告 | ❌ 完全缺失 | ❌ 缺失 |
| DesignSync | 设计系统同步 | ✅ 已实现 | ✅ 对齐 |
| Agent 子代理 | fork/resume 完整 | ✅ `AgentTool` 完整实现 | ✅ 对齐 |

**工具调用能力总结**: 核心管线（提取→校验→修复→重试→执行）现已补齐 3 个关键缺失：
1. `validateToolCall` 集成到 MLX stream/non-stream 路径
2. `_parse_error` 重试指导反馈给模型
3. MLX provider 绕过 GrowthBook 门控自动升级 max_tokens

### 4. 推理参数与 Prompt 工程（Inference Params & Prompt Engineering）

> 专家团第四维度：对比 Claude Code 对 GLM-5.1 的深度适配 vs Trae 的通用参数

#### 4.1 推理参数专项调优

| 维度 | Claude Code | Fusion-Code | 状态 |
|------|-------------|-------------|------|
| temperature | per-model 调优（编程场景低温度） | `getModelInferenceParams()` per-model 配置 | ✅ 已补齐 |
| top_p | 模型特定 | per-model（Qwen3=0.9, 默认=0.95） | ✅ 已补齐 |
| repetition_penalty | 不传（云模型自带） | per-model（Qwen3=1.05, Llama3=1.1） | ✅ 已补齐 |
| enable_thinking | N/A（云模型内置 extended thinking） | 27B+ 自动启用，≤14B 禁用 | ✅ 已补齐 |
| 环境变量覆盖 | N/A | `FUSION_MLX_TEMPERATURE/TOP_P/ENABLE_THINKING` | ✅ 已补齐 |
| 小模型 fallback | N/A | temperature=0.3, top_p=0.95 | ✅ 合理 |

#### 4.2 思维链（CoT）强制机制

| 维度 | Claude Code | Fusion-Code | 状态 |
|------|-------------|-------------|------|
| 云模型 CoT | extended thinking（budget_tokens 控制） | N/A（云模型走 SDK 路径） | ✅ 不适用 |
| 27B+ 模型 CoT | N/A | `enable_thinking=true` → reasoning_content → thinking_delta | ✅ 已补齐 |
| 小模型 CoT | N/A | `getThinkFirstProtocol()` 结构化4步协议 | ✅ 已补齐 |
| 思考内容隔离 | thinking block 独立 | reasoning_content 不计入 textBuffer | ✅ 已补齐 |

#### 4.3 编程专用 System Prompt

| 维度 | Claude Code | Fusion-Code | 状态 |
|------|-------------|-------------|------|
| Prompt 深度 | 10K+ token（10+ 动态分区） | 4 tier 按模型大小递增（mini/standard/extended/full） | ✅ 适配方案 |
| 27B+ Prompt | N/A | full tier: 含架构/安全/测试/调试/多语言/工作流 协议 | ✅ 丰富 |
| 小模型 Prompt | N/A | mini tier: 精简核心规则 + think_first 协议 | ✅ 合理 |
| 项目规范注入 | 自动读 package.json/tsconfig/eslintrc | `getCompactProjectContext()` 已有 | ⚠️ 精简版 |
| Prompt cache | per-section cache breakpoint | 无分区 cache | ❌ 缺失（需上游支持） |

**推理参数与 Prompt 工程总结**: Qwen3-27B 作为编程主力模型的专项优化已完成：
1. `getModelInferenceParams()` — Qwen3-27B: temperature=0.2, top_p=0.9, repetition_penalty=1.05
2. `enable_thinking=true` — 27B+ 自动启用思考模式，`reasoning_content` → `thinking_delta` 流式输出
3. `getThinkFirstProtocol()` — 小模型结构化 CoT 强制，大模型用原生思考模式
4. 环境变量覆盖支持 — `FUSION_MLX_TEMPERATURE/TOP_P/ENABLE_THINKING/REPETITION_PENALTY`

### 5. 四大维度落地核实（2026-07-22 二次审计）

> 对专家团四大维度建议逐项代码核实，识别遗漏并补齐

#### 5.1 fusion-mlx 专用 Harness

| 子项 | 状态 | 证据 |
|------|------|------|
| 编程专用系统 Prompt（10K+） | ✅ 已落地 | `buildMlxSystemPrompt()` full tier 60+ section，4 tier 按模型递增 |
| 严格工具调用协议 | ✅ 已落地 | `validateToolCall()` + `repairToolCallJson()` 集成到 stream/non-stream |
| 重试机制 | ✅ 已落地 | `mlxFetchWithRetry()` + max_tokens 升级重试 + 3档超时 |
| **熔断器** | ✅ **本次补齐** | `CircuitBreaker` 类：5次连续失败→OPEN，30s 冷却→HALF_OPEN，2次探针成功→CLOSED |

#### 5.2 长上下文智能管理

| 子项 | 状态 | 证据 |
|------|------|------|
| 分层（全量/摘要/丢弃） | ✅ 已落地 | 16 文件 compact 服务：autoCompact + microCompact + reactiveCompact |
| 自动摘要+关键锚定 | ✅ 已落地 | 9节结构摘要 + `[CRITICAL]`/`[IMPORTANT]` 锚点 + 5+ 上下文预算协议 |
| **前缀缓存** | ⚠️ **本次部分补齐** | 系统Prompt重排：静态内容（协议/标准）→ `DYNAMIC_BOUNDARY` → 动态内容（memory/project）；fusion-mlx 上游尚不支持 cache_control API，已提 issue |

#### 5.3 工程化工具链

| 子项 | 状态 | 证据 |
|------|------|------|
| 内置工具（文件/shell/测试/git/lint） | ✅ 已落地 | 22+ 工具 + MLX 3级过滤（CORE/MEDIUM/FULL） |
| 链式调用（需求→改→测→反馈→再改） | ✅ 已落地 | `query.ts` while(true) 迭代工具循环 |
| MLX 工具优化 | ✅ 已落地 | Schema 清洗 + 描述截断 + tier 分层 + 工具集过滤 |

#### 5.4 Qwen3-27B 参数+Prompt 调优

| 子项 | 状态 | 证据 |
|------|------|------|
| 温度/top-p/生成长度调优 | ✅ 已落地 | `getModelInferenceParams()` + env var 覆盖 |
| **env var 覆盖丢 repetition_penalty** | ✅ **本次修复** | env var 路径改为基于 model defaults 覆盖，新增 `FUSION_MLX_REPETITION_PENALTY` |
| 强制思维链 | ✅ 已落地 | enable_thinking + reasoning_content→thinking_delta + getThinkFirstProtocol |
| 编程专用 Prompt | ✅ 已落地 | full tier 60+ section |

**本次补齐的3个缺口**：
1. **Circuit Breaker**（`fusion-mlx-adapter.ts`）— 防止 MLX 服务不可用时无限制重试
2. **env var 覆盖 Bug**（`getModelInferenceParams()`）— 修复覆盖路径丢 repetition_penalty 等参数
3. **Prefix Cache 优化**（`mlx-system-prompt.ts`）— 静态/动态分区 + `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 标记

**待上游支持**：fusion-mlx 服务端需实现 cache_control API 或 KV cache prefix 复用端点，才能将 `DYNAMIC_BOUNDARY` 转化为实际加速

---

## 二、6层架构对比总览

| 层级 | Claude Code | Fusion-Code 现状 | 差距 |
|------|-------------|-------------------|------|
| L1 工具设计 | 28+ 工具，Workflow/Agent 并行编排 | 20+ 工具，Agent 有但 Workflow 移除 | ⚠️ 中 |
| L2 上下文管理 | 5级 compact，prompt cache，session memory，项目规范自动注入 | compact ✅，MLX 60% 阈值 ✅，session memory ✅，缺项目规范自动注入 | ❌ 高 |
| L3 提示工程 | 动态分区 system prompt，per-model 裁剪，项目规范自动注入 | MLX compact prompt ✅，缺动态分区和项目规范注入 | ❌ 高 |
| L4 结果格式 | tool result 持久化，截断，budget 控制 | MLX 持久化 ✅，截断 ✅，budget ✅ | ✅ 已对齐 |
| L5 查询管线 | max_tokens 升级，structured output 重试，工具调用失败重试 | max_tokens 升级 ✅（MLX 绕过门控），工具调用重试 ✅（validateToolCall + _parse_error），structured output 重试 ✅ | ✅ 已对齐 |
| L6 模型适配 | per-model 能力探测，schema 清洗 | 能力探测 ✅，schema 清洗 ✅ | ✅ 已对齐 |

---

## 三、逐项差距详细分析

### ❌ P0 — 严重差距（影响核心体验）

#### 3.1 缺少项目规范自动注入（专家重点指出）
- **Claude Code**: 自动读取 package.json/tsconfig.json/eslintrc/.gitignore/CLAUDE.md → 注入上下文
- **Fusion-Code**: 仅自动注入 CLAUDE.md 层级（`claudemd.ts` 4层 hierarchy），**不自动读项目配置文件**
- **影响**: 模型不知道项目用什么框架、什么构建工具、什么代码规范，容易生成不匹配的代码
- **补齐方案**: 在 `getMlxSystemPrompt()` 或 `computeSimpleEnvInfo()` 中自动检测并注入：package.json（scripts+dependencies）、tsconfig（编译选项）、eslintrc/prettier（代码规范）、.gitignore（忽略规则）

#### 3.2 max_tokens 升级机制（已补齐）
- **Claude Code**: `claude.ts` 检测 `stop_reason === 'max_tokens'`，自动升级到 64k 重试（需 GrowthBook `tengu_otk_slot_v1` 门控）
- **Fusion-Code**: 两条升级路径现已打通：
  1. `fusion-mlx-adapter.ts` 非流式路径：`MLX_MAX_TOKENS_ESCALATION_FACTOR=2` 自动翻倍重试
  2. `query.ts` 流式路径：MLX provider 自动绕过 GrowthBook 门控，直接升级到 `ESCALATED_MAX_TOKENS`
- **影响**: 本地模型不再因 max_tokens 截断而回复不完整

#### 3.3 MLX 系统提示缺少动态分区 + 项目规范（专家重点指出）
- **Claude Code**: `systemPromptSection()` 动态构建 10+ 分区（session_guidance/memory/env_info/language/output_style/scratchpad/frc 等），每分区独立缓存
- **Fusion-Code MLX 路径**: `getMlxSystemPrompt()` 返回简单 string[]（~30行），无分区概念，无项目规范
- **影响**: (1) 系统 prompt 太短，模型缺乏足够指导 (2) 无法利用 prompt cache (3) 项目规范缺失导致代码生成质量低
- **补齐方案**: 为 MLX 路径扩展系统提示，增加项目规范分区、代码规范分区、工具使用指导分区

#### 3.4 Cron 定时工具未注册
- **Claude Code**: `CronCreate/CronDelete/CronList/ScheduleWakeup` 4个工具完整注册
- **Fusion-Code**: `cronScheduler.ts` (565行) 和 `cronTasks.ts` (16.9K) 存在完整基础设施，但 **tools.ts 中未注册任何 Cron 工具**
- **影响**: `/loop` 命令无法工作，定时任务完全不可用
- **补齐方案**: 创建 `CronCreateTool/CronDeleteTool/CronListTool`，注册到 tools.ts

#### 3.5 LSP 工具被 ENV 门控
- **Claude Code**: LSP 工具默认可用
- **Fusion-Code**: `...(isEnvTruthy(process.env.ENABLE_LSP_TOOL) ? [LSPTool] : [])`
- **影响**: LSP 代码智能对本地模型开发者最有价值，但默认关闭
- **补齐方案**: MLX 模式下自动启用 LSPTool

---

### ⚠️ P1 — 中等差距（影响效率和体验）

#### 3.6 缺少 Workflow 多代理编排工具
- **Claude Code**: `Workflow` 工具，支持 `agent()/parallel()/pipeline()/phase()` 编排
- **Fusion-Code**: `WorkflowTool removed - cloud-only`
- **影响**: 无法做多维度并行审查、大规模迁移
- **补齐方案**: 基于 AgentTool 的 fork 机制实现本地 Workflow 引擎

#### 3.7 /loop 命令只有 stub
- **Claude Code**: `/loop` 完整支持定时/动态模式
- **Fusion-Code**: `loop.ts` 是 stub，`isKairosCronEnabled = (): boolean => false`
- **影响**: 无法自动循环执行任务
- **补齐方案**: 依赖 3.4 的 Cron 工具注册，然后激活 loop skill

#### 3.8 缺少 ReportFindings 工具
- **Claude Code**: `ReportFindings` 工具，结构化代码审查发现报告
- **Fusion-Code**: 完全缺失
- **补齐方案**: 实现简单版 ReportFindings

#### 3.9 Agent 提示中 MLX 专用指导不足
- **Claude Code**: Agent prompt 有完整工具提示、禁止清单
- **Fusion-Code**: Agent prompt 缺少 MLX 小模型专用指导
- **补齐方案**: 在 Agent prompt 中根据模型大小注入行为指导

---

### ✅ P2 — 已对齐（无需改动）

| 能力 | 状态 | 关键文件 |
|------|------|----------|
| 5级 compact 系统 | ✅ | `src/services/compact/` (16文件) |
| MLX 自动 compact 阈值 (60%) | ✅ | `autoCompact.ts` |
| Tool result 持久化 + MLX 阈值 | ✅ | `toolResultStorage.ts` |
| Per-message budget 限制 | ✅ | `toolResultStorage.ts` |
| MLX 工具过滤 (CORE/MEDIUM/FULL) | ✅ | `src/tools.ts` + `fusion-mlx-tool-validator.ts` |
| Schema 清洗 + 描述截断 | ✅ | `fusion-mlx-tool-validator.ts` (170行) |
| 模型能力探测 | ✅ | `fusion-mlx-adapter.ts` `getMlxModelCapabilities()` |
| Per-model 上下文窗口缓存 | ✅ | `context.ts` `getMlxContextWindowForModel()` |
| Text-to-tool-call 提取 (3种模式) | ✅ | `fusion-mlx-stream.ts` `extractToolCallsFromText()` |
| Permission 系统 (5种模式) | ✅ | `PermissionMode.ts` + `PermissionContext.ts` |
| Session Memory | ✅ | `SessionMemory/` + `memdir/` |
| Plan Mode (Enter/Exit) | ✅ | `EnterPlanModeTool` + `ExitPlanModeV2Tool` |
| Worktree 隔离 | ✅ | `EnterWorktreeTool` + `ExitWorktreeTool` |
| Sub-Agent (fork/resume) | ✅ | `AgentTool/` (forkSubagent.ts, resumeAgent.ts) |
| MCP 集成 | ✅ | `src/services/mcp/` (完整实现) |
| Skill 系统 | ✅ | `src/skills/` |
| Hook 系统 | ✅ | `src/hooks/` |
| 连接失败重试 | ✅ | `fusion-mlx-adapter.ts` `MAX_RETRIES = 1` |
| Structured output (response_format) | ✅ | `fusion-mlx-adapter.ts` |

---

## 四、补齐计划

### Batch 1: P0 核心能力 (4 个任务)

| # | 任务 | 文件 | 复杂度 | 专家关联 |
|---|------|------|--------|----------|
| 1 | max_tokens 自动升级重试 | `fusion-mlx-adapter.ts` | 中 | 工具调用严格协议 |
| 2 | 项目规范自动注入 | `src/constants/prompts.ts` + 新建 `src/utils/projectContext.ts` | 中 | 17万行 Prompt |
| 3 | MLX 系统提示扩展 + 动态分区 | `src/constants/prompts.ts` | 中 | Prompt 模板深度 |
| 4 | LSP 工具默认启用 | `src/tools.ts` | 低 | - |

### Batch 2: P1 体验优化 (4 个任务)

| # | 任务 | 文件 | 复杂度 |
|---|------|------|--------|
| 5 | Cron 工具注册 (3个工具) | 新建 `src/tools/Cron*Tool/` | 中 |
| 6 | /loop 命令激活 | `src/skills/bundled/loop.ts` | 低 (依赖 #5) |
| 7 | ReportFindings 工具 | 新建 `src/tools/ReportFindingsTool/` | 中 |
| 8 | Agent MLX 行为指导 | `src/tools/AgentTool/prompt.ts` | 低 |

### Batch 3: P2 增值能力 (2 个任务)

| # | 任务 | 文件 | 复杂度 |
|---|------|------|--------|
| 9 | Workflow 本地引擎 | 新建 `src/tools/WorkflowTool/` | 高 |
| 10 | DesignSync 工具 | 新建 `src/tools/DesignSyncTool/` | 高 |
