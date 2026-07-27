# kimi-code & kimi-cli 优势特性完整分析报告

> 分析日期：2026-07-27
> 目标：从 kimi-code（TypeScript monorepo）和 kimi-cli（Python CLI）中识别可借鉴的优势特性，为 fusion-code 提供实施路线图

---

## 一、最高优先级可借鉴特性（P0 — 立即可做）

### 1. `/goal` 目标驱动模式 + Budget 系统 ⭐⭐⭐

**来源**：kimi-code（命令层 + 4 个工具）

**核心机制**：用户设定目标 + 预算，模型自动持续执行直到目标完成或预算耗尽。

| 子命令 | 功能 |
|--------|------|
| `/goal <objective>` | 创建目标 |
| `/goal status` | 查看状态 + 预算使用 |
| `/goal pause/resume/cancel` | 生命周期控制 |
| `/goal replace <objective>` | 替换目标 |
| `/goal next <objective>` | 加入队列 |
| `/goal next manage` | 队列管理（排序/编辑/删除）|

**4 个配套工具**（模型可主动调用）：
- `CreateGoal` — 模型自建目标
- `GetGoal` — 读取目标状态
- `SetGoalBudget` — **设预算上限**（turns/tokens/ms/s/min/hours），到预算自动停止
- `UpdateGoal` — 模型报告完成/阻塞，触发 stopTurn

**状态机**：`active → paused/blocked/complete`

**持久化**：`wire.jsonl` 日志 + GoalModel（可重放、崩溃恢复）

**对 MLX 的价值**：`SetGoalBudget` 让用户放心启动长任务，设"最多跑 10 轮"或"最多 50000 tokens"，到达预算自动停止。MLX 本地推理场景下防止无限循环消耗资源。

**实现建议**：
```
/goal refactor auth module --budget turns=20 --budget tokens=100000
```

**参考代码**：`~/code/kimi-code/apps/kimi-code/src/tui/commands/goal.ts`（508 行）

---

### 2. `/undo` 会话回退 ⭐⭐⭐

**来源**：kimi-code

**核心机制**：
- `/undo` — 交互式选择器，预览每个可回退点
- `/undo <count>` — 回退 N 轮
- 回退后自动恢复用户输入到输入框
- compaction 边界后无法继续回退（硬限制）
- 同步清理 transcript entries 和 UI 组件

**回退锚点**：user message、skill activation、plugin command

**关键函数**：
- `isUndoAnchorEntry()` — 识别可回退的入口
- `removeUndoContextComponents()` — 结构化 UI 清理
- `parseUndoCount()` — 验证正整数参数
- `UndoAvailability` — 检测 compaction 边界

**对 fusion-code 的价值**：没有会话回退是 CLI 工具硬伤。模型走偏时不需要重新开 session。

**参考代码**：`~/code/kimi-code/apps/kimi-code/src/tui/commands/undo.ts`（501 行）

---

### 3. D-Mail — Agent 主动上下文压缩 ⭐⭐⭐

**来源**：kimi-cli

**核心机制**：LLM 自己检测上下文臃肿（大文件读取、失败代码尝试），主动调用 `SendDMail` 工具触发压缩。

**工作流程**：
1. Agent 在关键点自动 `checkpoint()`（标记上下文位置）
2. 当 Agent 检测到上下文冗余，调用 `SendDMail(message="总结")`
3. Soul 抛出 `BackToTheFuture` 异常
4. 上下文 `revert_to(checkpoint)` + 注入 D-Mail 摘要消息
5. Agent 从"干净"上下文继续

**vs fusion-code 现有 compaction**：
- fusion-code：系统触发，只做摘要，不回滚
- kimi-cli D-Mail：Agent 主动触发，checkpoint+revert 真正回滚到已知良好状态

**对 MLX 的价值**：MLX 上下文窗口小，D-Mail 让模型自己管理上下文膨胀，比系统自动 compaction 更精准。

**参考代码**：`~/code/kimi-cli/src/kimi_cli/tools/dmail.py`

---

## 二、高优先级特性（P1 — 近期可做）

### 4. Plan Mode — 结构化只读规划 ⭐⭐⭐

**来源**：kimi-cli

**核心机制**：
- `EnterPlanMode` — 进入只读模式，只能读文件和写计划文件
- `ExitPlanMode` — 退出时展示计划，用户审批（Approve/Reject/Revise）
- 支持多方案展示（用户选择）
- `PlanModeInjectionProvider` — 每 5 轮注入节流提醒
- 计划文件自动批准写入，其他文件写入被拒绝

**对 fusion-code 的价值**：当前模型经常边想边改，Plan Mode 强制"先想清楚再动手"。

---

### 5. Plugin Marketplace ⭐⭐⭐

**来源**：kimi-code

**架构**：
- `marketplace.json` — 官方/精选插件目录（tier: official/curated）
- `PluginManager` — 完整生命周期（install/enable/disable/remove/reload）
- 插件可提供：Skills、MCP Servers、Hooks、Commands
- 3 种安装源：local-path、github、zip-url
- Per-MCP-server enable/disable 粒度
- 非官方插件需信任确认

**kimi.plugin.json 示例**：
```json
{
  "name": "kimi-datasource",
  "version": "3.3.0",
  "mcpServers": { "data": { "command": "node", "args": ["..."] } },
  "interface": { "displayName": "Kimi Datasource" },
  "skills": ["./SKILL.md"],
  "hooks": [],
  "commands": []
}
```

**实现建议**：先支持 MCP Servers 类插件（fusion-code 已有 MCP 基础），再扩展。

**参考代码**：`~/code/kimi-code/packages/agent-core/src/plugin/manager.ts`（517 行）

---

### 6. Background Task Manager 增强 ⭐⭐

**来源**：kimi-cli

**kimi-cli 的改进点**：
- bash 任务：独立 worker 进程 + 文件系统心跳检测
- agent 任务：asyncio Task + 超时 + 取消
- `recover()` — 崩溃恢复（检测 stale heartbeat、lost tasks）
- `NotificationManager` — 任务完成通知（去重、severity 分级）
- `TaskOutput` — 32KB 非阻塞预览 + ReadFile 提示获取完整输出
- `kill_all_active()` — 优雅关闭

**对 fusion-code 的价值**：当前后台任务较简单，缺少心跳检测、崩溃恢复、输出大小限制。

**参考代码**：`~/code/kimi-cli/src/kimi_cli/background/manager.py`（726 行）

---

### 7. `/swarm` 多 Agent 快速开关 ⭐⭐

**来源**：kimi-code

**核心机制**：
- `/swarm on/off` — 开关
- `/swarm <task>` — 开启并分配任务
- `AgentSwarm` 工具：`prompt_template` + `items`（最大 128 个子 Agent）
- 突发启动（初始并发 5，间隔 700ms）+ 节流
- 速率限制指数退避重试（3s 基数，2x 因子）
- `resume_agent_ids` — 恢复失败的 Agent

**参考代码**：`~/code/kimi-code/apps/kimi-code/src/tui/commands/swarm.ts`（157 行）

---

## 三、中优先级特性（P2 — 架构改进）

### 8. Wire Model + Op 模式 — 确定性状态持久化 ⭐⭐

**来源**：kimi-code（agent-core-v2）

**核心机制**：
- 每个 Agent 有 `wire.jsonl` 日志
- `WireModel` 是可重放状态容器（GoalModel、SwarmModel 等）
- `Op` 是确定性 reducer（`goal.create`、`goal.update`）
- 非确定性值（ID、时间戳）在 Op payload 中携带
- `restore()` → 验证 → 迁移 → 回放 ops → 运行 hooks

**对 fusion-code 的价值**：QueryEngine 是单体架构。Wire Model 让崩溃恢复确定性化 — 重放日志就能完整恢复状态。

---

### 9. Subagent 系统 — 类型定义 + 工具策略 ⭐⭐

**来源**：kimi-cli

**关键改进**：
- `AgentTypeDefinition` — 名称、描述、`when_to_use`（指导 LLM 何时委托）、`default_model`、`ToolPolicy`
- `ToolPolicy` — `inherit`（继承父 Agent 工具）/ `allowlist`（白名单）模式
- `summary_continuation` — 输出太短（<200 字符）自动要求补充
- `Git context auto-injection` — 探索类 Agent 自动注入 git 上下文
- `file-per-instance` 持久化 — 完整状态（context.jsonl, wire.jsonl, prompt.txt）

**参考代码**：
- `~/code/kimi-cli/src/kimi_cli/subagents/models.py`
- `~/code/kimi-cli/src/kimi_cli/subagents/builder.py`
- `~/code/kimi-cli/src/kimi_cli/subagents/registry.py`
- `~/code/kimi-cli/src/kimi_cli/subagents/runner.py`（429 行）

---

### 10. Hooks Engine 增强 ⭐⭐

**来源**：kimi-cli

**改进点**：
- 双源：server-side（shell）+ client-side（wire/IDE）
- IDE 可动态注册 hook（`WireHookSubscription`）
- 14 种事件类型（含 SubagentStart/Stop、PreCompact/PostCompact、Notification）
- 结构化输出：exit 2 = block，JSON `permissionDecision=deny` = block
- `fire_and_forget_trigger` — 带 GC 保护，防止 asyncio task 被回收

---

### 11. Approval Runtime — 权限运行时 ⭐⭐

**来源**：kimi-cli

**改进点**：
- `cancel_by_source()` — 前台轮次结束时自动取消所有待审批
- `approve_for_session` — 会话级自动批准（批量解决待审批）
- Shared waiter + 引用计数 — 多消费者等待同一审批
- Wire hub 集成 — 多客户端审批路由

---

### 12. Steer Queue — 轮次中间输入注入 ⭐⭐

**来源**：kimi-cli

**机制**：用户在当前 step 结束后、下一步开始前，追加 follow-up 输入。不需要打断当前执行。

**对 fusion-code 的价值**：长任务运行中用户想追加指令，目前只能等执行完或取消。

---

### 13. `/btw` 旁路提问 ⭐⭐

**来源**：kimi-code

**机制**：派生主 Agent 的 fork，禁用所有工具调用，只能文本回复。侧面板显示对话。

**场景**：长任务运行中想问一个不相关的小问题（"这个变量名什么意思"），不打断主工作流。

**参考代码**：`~/code/kimi-code/apps/kimi-code/src/tui/commands/btw.ts`（20 行）

---

## 四、低优先级特性（P3 — 长期规划）

### 14. KAP Server（Agent Protocol）⭐

REST + WebSocket 协议，暴露整个 Agent Engine 为 API。支持 Web UI、IDE 集成。

### 15. ACP Adapter（IDE 标准协议）⭐

JSON-RPC 标准协议，让 Agent 在编辑器中作为 sidecar 运行。支持 FS reverse-RPC、MCP 转发。

### 16. `/web` TUI→Web 无缝切换 ⭐

当前 session 交接给 Web UI，TUI 进程变成 KAP Server，自动打开浏览器。

**参考代码**：`~/code/kimi-code/apps/kimi-code/src/tui/commands/web.ts`（83 行）

### 17. `/provider` 交互式 Provider 管理 ⭐

UI 级别的 Provider 切换、API Key 存储、Catalog 浏览、模型选择。

### 18. pi-tui 终端图像支持 ⭐

Kitty/iTerm2/Sixel 协议 — 终端直接渲染图片。`CURSOR_MARKER` 用于中文 IME 候选窗口定位。

### 19. Agent Personality（YAML 继承）⭐

`extend` 字段递归解析，选择性覆盖。如 okabe 继承 default 并添加 D-Mail 工具。

### 20. AGENTS.md 约定 ⭐

项目级 Agent 上下文文件，独立于 CLAUDE.md（人类指令）。

---

## 五、工具系统差异分析

### 10 个 Kimi 独有工具（fusion-code 无等效项）

| 工具 | 功能 | 对应特性 |
|------|------|----------|
| `CreateGoal` | 模型自建目标 | `/goal` |
| `GetGoal` | 读取目标状态 | `/goal` |
| `SetGoalBudget` | 设预算上限 | `/goal` |
| `UpdateGoal` | 更新目标状态 | `/goal` |
| `EnterPlanMode` | 进入只读规划 | Plan Mode |
| `ExitPlanMode` | 退出并审批 | Plan Mode |
| `CronCreate` | 创建定时任务 | Cron |
| `CronDelete` | 删除定时任务 | Cron |
| `CronList` | 列出定时任务 | Cron |
| `AskUserQuestion` | 结构化用户提问 | 交互 |

### 3 个架构差异化

| 差异点 | kimi-code | fusion-code |
|--------|-----------|-------------|
| 工具发现 | `select_tools` 渐进式披露 | 全量工具一次性注入 |
| Todo 管理 | 单个 `TodoList` 工具 | 拆分的 `TodoRead/TodoWrite` |
| Provider | Moonshot 特有 + 本地回退 | Anthropic + 多 provider 映射 |

### 22 个工具的自动批准策略

kimi-code 中以下工具需要明确批准：Bash、Write、Edit、CronCreate、CronDelete。其余 22 个工具自动批准。

### 3 种 V2 工具注册路径

1. 标准 `registerAgentToolService` — 大部分工具
2. 手动 `registerScopedService` + `registry.register()` — cron 类工具
3. 直接实例化 + `registry.register()` — `ReadMediaFile`（能力门控）

---

## 六、Wire 协议层分析

**协议版本**：WIRE_PROTOCOL_VERSION = "1.10"

### 事件类型

| 类别 | 事件 |
|------|------|
| Turn 生命周期 | TurnBegin, TurnEnd |
| Step 生命周期 | StepBegin, StepInterrupted, StepRetry |
| 压缩 | CompactionBegin, CompactionEnd |
| Hook | HookTriggered, HookResolved |
| 状态 | StatusUpdate, Notification |
| 内容 | ContentPart, ToolCall |
| 审批 | ApprovalResponse |
| 子 Agent | SubagentEvent |
| 计划 | PlanDisplay |
| 旁路 | BtwBegin, BtwEnd |

### 请求类型

所有 Request 类型都有 async Future-based `wait()/resolve()`：
- `ApprovalRequest` — 含 source_kind/source_id 用于 cancel-by-source
- `ToolCallRequest` — 工具调用审批
- `QuestionRequest` — 结构化 QuestionItem/QuestionOption
- `HookRequest` — Hook 执行请求

**参考代码**：`~/code/kimi-cli/src/kimi_cli/wire/types.py`（718 行）

---

## 七、实施路线图

| 阶段 | 特性 | 预估 |
|------|------|------|
| **Phase 1** (1-2周) | `/goal` + Budget + Goal Queue | 3-5天 |
| | `/undo` 会话回退 | 2-3天 |
| | D-Mail Agent 主动压缩 | 2-3天 |
| **Phase 2** (2-3周) | Plan Mode（enter/exit + 只读执行） | 3-4天 |
| | Plugin Marketplace（先 MCP 插件） | 5-7天 |
| | Background Task 增强 | 3-5天 |
| **Phase 3** (3-4周) | `/swarm` + AgentSwarm 工具 | 2-3天 |
| | Subagent 类型定义 + ToolPolicy | 2-3天 |
| | Hooks Engine 增强 | 2-3天 |
| | Approval Runtime 改进 | 2-3天 |
| **Phase 4** (持续) | Wire Model + Op 持久化 | 5-7天 |
| | KAP/ACP 协议层 | 5-7天 |
| | `/web` TUI→Web | 3-5天 |

---

## 八、ROI 排名

**ROI 最高的 3 个特性**：

1. **`/goal`** — 改变交互范式，从"一问一答"到"目标驱动自主执行"，Budget 机制尤其适合 MLX 本地推理
2. **`/undo`** — 基础体验刚需，模型走偏时不需要重开 session
3. **D-Mail** — MLX 小窗口场景的核心优化，Agent 主动管理上下文比系统自动 compaction 更精准

---

## 九、参考仓库结构

### kimi-code（TypeScript monorepo, pnpm workspace）

```
packages/
  acp-adapter/     — Agent Client Protocol 适配器
  agent-core-v2/   — Agent 核心（Wire Model, Ops, PluginManager）
  kap-server/      — KAP Agent Protocol Server
  protocol/        — 协议定义
  telemetry/       — 遥测
  pi-tui/          — 终端图像支持
  klient/          — API 客户端
  kosong/          — 空状态组件
apps/
  kimi-code/       — CLI 应用
  web/             — Web UI
  vscode/          — VS Code 扩展
  vis/             — 可视化
plugins/
  marketplace.json — 插件目录
  official/        — 官方插件
```

### kimi-cli（Python CLI, uv workspace）

```
src/kimi_cli/
  soul/            — Agent 个性系统（YAML 继承）
  subagents/       — 子 Agent 类型定义 + 运行器
  background/      — 后台任务管理器
  wire/            — Wire 协议层（types, protocol, hub）
  hooks/           — Hooks 引擎
  approval/        — 审批运行时
  tools/           — 工具集（含 D-Mail）
  plan/            — Plan Mode
  dmail/           — D-Mail 上下文压缩
```
