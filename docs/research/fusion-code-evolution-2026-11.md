---
doc_id: fusion-code/guide
product: fusion-code
class: app
entry: guided-ui
doc_type: guide
title: { zh: "业界洞察 × 演进路线（2026-11）", en: "Industry scan & evolution input (2026-11)" }
audience: engineer
status: draft
version: 0.5.23
updated: 2026-11-12
owner: @dahai
source_of_truth:
  - docs/evolution-plan-2026-11.md
---

# 业界 AI Coding/Vibe Coding 洞察 × fusion-code 演进路线

> Status: COMPLETE.
> Date: 2026-11-12. Structure: 前半 = 业界洞察（终端 agent / AI IDE / 标准 / 异步 agent / spec 驱动 / 评审 agent / 论文）；后半 = fusion-code 现状 + 不足 + 演进目标与防线。

## 0. 结论速览 / Executive Summary

1. **2026 终端 coding agent 三个定局**：AGENTS.md 赢得上下文文件战争（60k+ 项目/20+ 采纳者）；harness 特性面（skills+hooks+subagents+MCP+plugins）成为标准词汇；"任务→沙箱云会话→PR→人评审"是异步收敛形态，CLI/桌面/web 是同一 agent 的可互换前端。
2. **fusion-code 是 Claude Code 的 AGPL 衍生**（525k LOC，provenance 有档），工具/子 agent/LSP/MCP/会话面已达 parity，且有业界没有的本地三件套：模型尺寸分档工具过滤、Last-Event-ID 流恢复、prompt-cache 断裂检测 — 恰好命中 2026 研究热点"harness 效率"。
3. **最大缺口**：AGENTS.md 兼容缺失（🔴 标准之战已结束而未接入）与无云端/异步会话（🔴 "任务→PR"收敛形态缺席）；其次 macOS 沙箱未落地、评审层未从斜杠命令升为独立"查 agent"、无 SDD 流程面。
4. **演进三阶段**：0-3 月 AGENTS.md 一等支持 + Seatbelt + OTel 成链；3-9 月异步会话+PR 交还 + 独立评审层 + routines + web diff UI + SDD 门控；9-18 月经 ACP 接 IDE（不自写扩展）+ 工具分档开放规格化 + 视频输入评估。
5. **防线**：fork 合规（AGPL + provenance 纪律）、本地优先无遥测、harness 契约同判测试不漂移、provider 中立、单二进制分发、小模型可用性三件套不退。

## 1. 终端 Coding Agent 格局

GitHub star/pushed_at 实测（2026-11-12）。

| 工具 | star | pushed | 要点 |
|---|---|---|---|
| **OpenCode**（anomalyco，原 sst） | **226,265**（最大，超所有一方 CLI） | 11-12 | "The open source AI coding agent"；22 语言 README；org 转移实测 |
| **Claude Code** | 155,384 | 11-11 | CLI+IDE+桌面+web/移动+Slack；docs 实测：CLAUDE.md **与 AGENTS.md** 双读、auto memory（含 per-subagent）、subagents、hooks、Skills、plugins、MCP、session 分支/resume/--from-pr、定时任务、computer use |
| **Codex CLI** | 134,974 | 11-12 | Rust；`codex app` 桌面 + VS Code/Cursor/Windsurf 扩展 + Codex Web 云 agent |
| **Gemini CLI** | 108,790 | 11-12 | **重大定位变化（README "IMPORTANT"）：转企业专属**（Code Assist Standard/Enterprise）；个人档 2026-06-18 起 → Antigravity CLI（`agy`）；明确"不为 Gemini 4+ 优化" |
| **OpenHands** | 93,290 | 11-12 | TypeScript 重写期；org 由 All-Hands-AI 更名 |
| **goose** | 56,478 | 11-12 | Rust；org 已离开 Block |
| **Aider** | 50,078 | **2026-05-22（停滞 ~6 月）** | 先驱配对编程模式实质弃养 |
| **Crush**（Charm） | 29,057 | 11-12 | Go；差异点：LSP 增强上下文、**会话中切模型保上下文**、MCP（http/stdio/sse） |
| **GitHub Copilot CLI** | 11,403 | 11-12 | Copilot 生态 agent 化 CLI |
| **Kimi Code CLI**（MoonshotAI/kimi-code） | 8,206 | 11-12 | 新仓（旧 kimi-cli 11,415★ 已归档）；单二进制；**视频输入**（屏幕录制→agent 读帧）；Agent Skills/Hooks/Sub-agents（并行隔离）/MCP 会话式 /mcp-config/插件市场带信任级；配 Kimi K3.1 Pro |

## 2. AI IDE 与编辑器原生 agent

- **Zed 94,758★**：Rust 编辑器，主推 ACP 作为编辑器↔agent 粘合
- **Cursor**（闭源）：docs 落地页实测 — 特性名词已是 "Agent, Rules, MCP, Skills & CLI"，与终端 agent 同一feature 词汇
- **Kiro（AWS）**：kiro.dev 实测（schema.org parentOrganization=Amazon Web Services）— "agentic engineering system"：plan→build→review→verify；spec 驱动血统
- **Windsurf**：Cognition 旗下（agents.md 采纳者列表）；VS Code Copilot Chat 9,939★（docs 仓，慢速）
- **Rules 文件收敛**：.cursor/rules / CLAUDE.md / AGENTS.md 正坍缩为 AGENTS.md 优先（Claude Code 可原地读 AGENTS.md 替代 CLAUDE.md）

## 3. 标准与协议（AGENTS.md / MCP / ACP）

- **AGENTS.md 25,453★**：agents.md 站实测采纳者 20+（Codex/Jules/Factory/Aider/goose/opencode/Zed/Warp/VS Code/Devin/UiPath/Junie/Amp/Cursor/RooCode/Gemini CLI/Kilo Code/Phoenix/Semgrep/Copilot coding agent/Ona/Windsurf/Augment）；自称 60k+ 开源项目使用 — **上下文文件战争已结束**
- **MCP**：modelcontextprotocol/servers **91,939★** + community registry 7,465★；所有受测 CLI 均带 MCP；Kimi Code 加会话式 /mcp-config
- **ACP 4,629★**（zed-industries 迁至 agentclientprotocol）：**"connecting any editor to any agent"** — MCP 的编辑器↔agent 对应物

## 4. 异步/云端 coding agent

- **收敛形态：任务/issue → 沙箱云会话 → PR → 人评审**；CLI/桌面/web/移动 = 同一 agent 的可互换前端
- Claude Code 云（docs 实测）：web quickstart（连仓→任务→评审 PR）、`--cloud`/`--teleport` 会话在终端/云间移动、移动端转向、Desktop Dispatch、API/GitHub 事件定时任务、Projects = 并行云会话共享 repo/指令/memory
- Codex Web（chatgpt.com/codex，与 CLI/桌面分离）；GitHub Copilot coding agent（issue→PR）；Devin/Jules 不可核（闭源/站点不可达）

## 5. Spec 驱动与工作流工具

- **GitHub Spec Kit 149,416★**（比多数 agent repo 还大）：SDD 核心 + bug 修复/想法评估流程 + 带生命周期 hook 的扩展 + presets/工作流 overlay/bundles — **SDD 是主导团队模式**
- **OpenSpec 74,671★**："fluid not rigid… built for brownfield" — 棕地 spec-delta 角度
- **BMAD-METHOD 55,288★**：v6.12 stable，v7 alpha 预告 11 月中 — **v7 重建在 Skills 标准上**（要求支持 skills 的工具）— 方法论项目向 skills 可移植性对齐

## 6. 代码评审/验证 agent

- **PR-Agent 15,970★**（org 迁自 qodo-ai）：开源核 vs Qodo 托管分层
- **CodeRabbit**（闭源）：首页实测 — 从 "AI-first PR reviewer" 转向营销 "**Governance & Control for Agentic Development**" — 评审层正在转向**治理 agent 写的代码**
- **Greptile**（闭源）："AI Code Review — Catch More Bugs"
- 成熟信号：Claude Code 定时评审/依赖审计任务、Kiro 把 verify 品牌化进流程、BMAD/Spec Kit 内建质量门 — **写 agent 与查 agent 正分离成两层产品**

## 7. arXiv 学术信号（近 ~90 天）

- 记忆/上下文：2611.14009（agent 记忆管理成训练目标）、2611.13709（**上下文文件依从性测量** — AGENTS.md 类成了被测变量）、2611.07286（agent 该如何"看"代码 — 超越裸文本的代码表示）
- 成本/效率：2611.13396（token 花费作为生产力度量）、2611.13241 FlowPlan（抽象引导规划降 token）— harness 效率成为研究主题
- 工程：2610.13361 AgentSWE（agent 造 agent）、2609.32662 AsynCodeBench（异步多 agent 协作基准 — 印证产品异步化）
- **SDD 成独立实证子领域**：2611.05094（门控 SDD 审计链）、2610.07534（EPIC 框架）、2609.00252（人机协作）、2608.25202（规定 vs 实践）、2606.04967（分类法）
- 基准批评：2611.13541（基准在任务耗尽前停止排序）、2611.13994（饱和/泄漏）
- SWE-bench（swebench.com 实测）：2026-02 提交含 Claude 4.6 Opus/GPT 5.2 Codex/Gemini 3/Kimi K2.5（开放权重）/GLM 5/DeepSeek V3.2/MiniMax M2.5 — 具体分数不可提取（JSON 截断），不引用

## 8. fusion-code 现状盘点 / Current State

本地代码调查（2026-11-12，read-only）。**单一 Bun 项目**（非 monorepo，根 CLAUDE.md 措辞有误），`@fusion-mlx/fusion-code` v0.5.23，524,693 TS LOC（不含测试+vendor），bun 单文件编译出 70MB 二进制。**AGPL-3.0 衍生自 Anthropic Claude Code**（README.md:864，去品牌 + README:866-876 记录自有增量 + `docs/upstream-provenance.md` 上游痕迹清单；树内残留：`src/services/claudeAiLimits.ts`、`claudemd-parser` 导出、`src/main/antCommands.ts`）。

### 8.1 Agent 面
- 完整终端 agent loop（Ink/React REPL）：query.ts / QueryEngine / Tool / Task
- **harness 契约一致性是行为级的**（TS 不能 import Python 内核）：`src/__tests__/harness/kernelParity.test.ts` 子进程跑 fusion_harness，4 条镜像契约断言同判 — (1) PermissionEngine deny-first ↔ denied_tools；(2) DANGEROUS_PATTERNS ↔ classifyAllShell；(3) compaction 阈值 3000/2000 ↔ MLX compact；(4) LLMFunnel 预算拦截 ↔ goal checkBudget；内核缺席 CI 安全跳过
- 权限重装：bashPermissions.ts 93KB + bashSecurity.ts 96.6KB + sandboxAskCheck
- **60+ 工具**：File*/Bash+PowerShell/Glob/Grep（ripgrep）/web-tree-sitter AST/WebFetch/Todo/Task*/Skill*/**Worktree 工具**/Cron/SendMessage/TeamCreate/**MCP 客户端工具**
- 子 agent：AgentTool 6 内置（generalPurpose/explore/plan/**verification（反谄媚加固）**/claudeCodeGuide/statuslineSetup）+ 用户自定义目录
- 会话：persist/resume/save-session/session-pack/checkpoint 全套
- 超越基础编码：语音 STT、vim 模式、swarms/teams、后台任务、插件（sha256 供应链钉扎）、skills、/review、/security-review、/commit、/fork、proactive、目标+预算

### 8.2 编码能力
- **LSP 真客户端栈**（LSPServerManager/Client/Instance/DiagnosticRegistry + LSPTool，vscode-languageserver-protocol 3.17.5）
- **MCP 双向**：client.ts 115KB（stdio/SSE/in-process/SDK-control + auth 82KB）+ 自身作为 MCP stdio server 暴露
- 沙箱：vendored linux-sandbox runtime + sandbox-adapter 缝隙
- 本地 embeddings 知识库（embedder → 11432 /api/embeddings + vectorStore + kb 命令）

### 8.3 模型集成（本地差异化）
- fusion-mlx-adapter 65KB（gateway 11432 / MLX 直连 11434 双感知、断路器、信号量并发）+ **provider 中立缝 `src/services/llm/`**（任何 Anthropic 兼容端点，FUSION_BASE_URL）
- **模型尺寸分档工具过滤**（≤2B/≤9B/full — 小本地模型不淹死在 30+ schema 里）
- **流恢复**（Last-Event-ID 中断重放）+ **prompt-cache 断裂检测**（24.7KB）
- 模型目录含 Claude + Codex ID，运行时从 /v1/models 拉

### 8.4 消费方与入口
- CLI 二进制 + headless/connect 模式 + SDK entrypoints + MCP server + **project API server（37.8KB，/ws/chat WebSocket）** + web GUI（v0.1.0，:11482，最小化）
- 消费方已核：**fusion-studio Swift 经 StreamingBridge 连 /ws/chat**；fusion-web-shell 注册 core 模块；fusion-eval 当评测臂（fc-local/fc-glm）；fusion-code-modelization 引用

### 8.5 可观测与测试
- OpenTelemetry 依赖在（sdk-trace-base/metrics/logs）；cost-tracker + tokenEstimation + query/tokenBudget 成本账
- 130 测试文件（103 单测 18k 行 + 27）+ Playwright e2e 1 spec；CI Biome 只扫新文件（迁移期 allowlist）；自定义 lint:layers（导入方向）+ lint:flags

### 8.6 关键缺失（grep 0-hit 事实）
- 无 IDE/编辑器插件（无 VSCode/JetBrains 代码）
- **macOS 沙箱未落地**：vendored linux-sandbox 在，macOS Seatbelt/sandbox-exec 0 hit
- web GUI 与终端能力不对等（无 diff/review web UI）
- 无多仓/组织级配置层（文件式 settings）
- LSP 只有客户端栈，无按语言 server 下载/供给注册表
- `src/claude-api/` 空目录

## 9. 不足与差距 / Gaps

对照 §1-7 逐项。🔴 落后一代 / 🟡 半步 / ⚪ 差异化机会。

| # | 差距 | 证据 | 严重度 |
|---|---|---|---|
| C1 | **AGENTS.md 兼容缺失** — 树内残留 claudemd-parser 但无 AGENTS.md 读写；标准已赢（60k+ 项目、20+ 采纳者、Claude Code 原地读） | §3 vs §8.1 | 🔴 |
| C2 | **无云端/异步会话** — 业界收敛 "任务→沙箱→PR→评审"，CLI/桌面/web 可互换前端；fusion-code 只有本地 CLI+project API，无异步会话与 PR 交还 | §4 vs §8.4 | 🔴 |
| C3 | **web GUI 能力不对等** — web v0.1.0 无 diff/review UI；竞品桌面/web 均含可视 diff 评审（Claude Desktop Dispatch） | §1/§4 vs §8.6 | 🟡 |
| C4 | **无定时任务/routines** — Claude Code 定时评审/依赖审计、Copilot 事件触发已标配；fusion-code 无 routines 面 | §4/§6 vs §8.6 | 🟡 |
| C5 | **评审层未产品化分离** — 有 /review /security-review 斜杠命令但无独立"查 agent"层（CodeRabbit 治理转向、Kiro verify 品牌化的业界方向）；fusion-security 有 SAST 但不消费 agent 会话上下文 | §6 vs §8.6 | 🟡 |
| C6 | **macOS 沙箱未落地** — vendored linux-sandbox 在、Seatbelt 0 hit；本地优先产品在 macOS 上跑 shell 无硬件级约束 | §8.6 | 🟡 |
| C7 | **spec 驱动工作流未接** — Spec Kit 149k★/OpenSpec/BMAD v7 是团队主导模式；fusion-code 无 SDD 流程面（spec→plan→tasks→implement 门控） | §5 vs §8.6 | 🟡 |
| C8 | **无 IDE 插件** — Cursor/VS Code/Kiro 编辑器面全布局；fusion-code 只有终端+web | §2 vs §8.6 | 🟡 |
| C9 | **OTel 依赖在但未成链** — deps 有 sdk-trace-base/metrics/logs，但与 harness/mlx 无统一 GenAI semconv 链 | §7（成本研究主题） vs §8.5 | 🟡 |

### 9.1 已守住的优势
- **模型尺寸分档工具过滤**（≤2B/≤9B/full）— 业界无对应物；本地小模型场景独有解
- **Last-Event-ID 流恢复 + prompt-cache 断裂检测** — harness 效率研究（§7）的产品化先行者
- **harness 行为级契约一致性测试**（子进程同判 4 契约）— fork 衍生项目里最严肃的内核纪律
- **provider 中立缝**（services/llm 任何 Anthropic 兼容端点）— 对齐"多模型中立是标配"收敛项
- 全套工具/子 agent/LSP/MCP 双向/worktree/checkpoint — harness 特性面已达业界 parity（"skills+hooks+subagents+MCP+plugins 成为标准"收敛项）
- 60+ 工具 + 语音/vim/skills + 无遥测外发承诺

## 10. 演进目标与防线建议 / Evolution Goals & Defense Lines

### 10.1 演进目标（三阶段）

**阶段一：标准兼容与本地安全（0-3 个月）**
1. **AGENTS.md 一等支持**（C1）：读 AGENTS.md 替代 CLAUDE.md + 写出（初始化命令生成），rules 文件收敛对齐
2. **macOS Seatbelt 落地**（C6）：sandbox-adapter 后接 sandbox-exec profile（补 linux-sandbox 之外的本机执行档）
3. **成本/trace 成链**（C9）：OTel GenAI semconv 成链（tool span→harness funnel→mlx LLM span），cost-tracker 进 run 对象

**阶段二：异步与评审（3-9 个月）**
4. **异步会话 + PR 交还**（C2）：后台 headless 会话（可脱离终端存活）+ 完成后开 PR/留 review 摘要 — 对齐"任务→沙箱→PR→评审"收敛形态；复用 project API server
5. **查 agent 层**（C5）：独立评审会话（读 transcript/ diff，反谄媚 verification 模板扩展）+ 定时评审/依赖审计 routines（C4）；安全侧挂 fusion-security 扫描结果
6. **web diff/review UI**（C3）：web/ 补可视 diff 评审页（消费 project API），对齐桌面体验
7. **SDD 流程面**（C7）：spec→plan→tasks 门控工作流（可导入 Spec Kit/OpenSpec 格式），对齐 BMAD v7 skills 化方向

**阶段三：生态位深化（9-18 个月）**
8. **IDE 接入**（C8）：优先经 ACP（Zed 已验证路径）而非自写 VS Code 扩展 — "any editor to any agent"
9. **小模型工具分档推广**：mlxToolTiers 提炼为开放规格（对本地模型生态是公共品，也是差异化名片）
10. **视频/多模态输入评估**：Kimi Code 视频输入是唯一模态先例 — 结合 fusion-autotest（macOS 应用测试）评估屏幕录制输入

### 10.2 防线（不能失守的阵地）
1. **fork 合规与 provenance 纪律**：AGPL-3.0 保持、upstream-provenance.md 持续维护、残留物（claudeAiLimits/antCommands/空 claude-api/）清理或标注 — 法律与工程双底线
2. **本地优先 + 无遥测**：无 callbacks home 是承诺级卖点；任何新能力（异步会话/routines）不得引入默认外联
3. **harness 契约一致性**：kernelParity 测试是 fork 不漂移的锚 — 任何权限/压缩/预算改动必须双侧同改同测
4. **provider 中立**：services/llm 缝不收窄到单端点 — 多模型中立已是业界标配
5. **单二进制零依赖分发**：70MB bun 编译是安装摩擦竞争轴上的既有优势，构建管线不复杂化
6. **模型尺寸分档不退**：本地小模型可用性（tier 过滤/流恢复/缓存检测）是与云巨头的根本差异点

## Appendix A. 信源

- 终端 agent/IDE/标准/异步/spec/评审：GitHub API 实测（gh api，2026-11-12）：anomalyco/opencode、anthrics/claude-code（原 anthropics）、openai/codex、google-gemini/gemini-cli、OpenHands/OpenHands、aaif-goose/goose、Aider-AI/aider、charmbracelet/crush、github/copilot-cli、MoonshotAI/kimi-code、MoonshotAI/kimi-cli（archived）、zed-industries/zed、microsoft/vscode-copilot-chat、agentsmd/agents.md、modelcontextprotocol/servers、modelcontextprotocol/registry、agentclientprotocol/agent-client-protocol、github/spec-kit、Fission-AI/OpenSpec、BMAD-METHOD（bmad-code-org）、The-PR-Agent/pr-agent
- 文档实测：code.claude.com/llms.txt 系（memory/sessions/headless/workflows 等）、cursor.com/docs、kiro.dev（含 schema.org 元数据）、agents.md 采纳者列表、swebench.com、CodeRabbit/Greptile 首页
- 论文：arXiv API（2611.14009、2611.13709、2611.13396、2611.13241、2611.07286、2610.13361、2609.32662、2611.05094、2610.07534、2609.00252、2608.25202、2606.04967、2611.13541、2611.13994）
- 本地盘点：/Users/dahai/fusion/fusion-code 代码 read-only 调查（package.json、README.md:864-876、src/__tests__/harness/kernelParity.test.ts、src/services/ 等）
- 不可核已标注：Jules（curl 000）、developers.openai.com/codex（403）、Devin/Cursor/Windsurf/CodeRabbit/Greptile/Antigravity（闭源，仅自述页）、SWE-bench 具体分数（JSON 截断）、copilot-cli 与 coding agent 关系
