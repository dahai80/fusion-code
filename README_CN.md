<h1 align="center">fusion-code</h1>

<p align="center">
  <strong>终端原生 AI 编程代理 — 本地优先、零遥测、单一二进制。</strong><br>
  深度本地 MLX 集成。云端后端可选。无回传数据。
</p>

<p align="center">
  <a href="#快速开始"><img src="https://img.shields.io/badge/快速-开始-blue?style=flat-square" alt="Quick Start" /></a>
  <a href="https://github.com/dahai80/fusion-code/stargazers"><img src="https://img.shields.io/github/stars/dahai80/fusion-code?style=flat-square" alt="Stars" /></a>
  <a href="https://github.com/dahai80/fusion-code/issues"><img src="https://img.shields.io/github/issues/dahai80/fusion-code?style=flat-square" alt="Issues" /></a>
  <a href="./FEATURES.md"><img src="https://img.shields.io/badge/features-88%20flags-green?style=flat-square" alt="Feature Flags" /></a>
  <a href="./README.md"><img src="https://img.shields.io/badge/lang-English-blue?style=flat-square" alt="English" /></a>
</p>

---

## 功能一览

| | |
|---|---|
| 🖥️ **本地 MLX 推理** | 深度 [fusion-mlx](https://github.com/fusion-mlxs/fusion-mlx) 集成，端口 `127.0.0.1:11434`。自动检测本地模型，零云端依赖。 |
| ☁️ **云端 LLM 后端** | Anthropic（直连或代理/LiteLLM）、OpenAI Codex、Azure Foundry — 插入 API Key 即可。429/529 错误自动降级模型链。 |
| 🔒 **零遥测** | 无出站分析、崩溃报告或使用追踪。一切数据留在你的机器上。 |
| 🧩 **内置插件** | GitHub 集成、UI/UX Pro Max 设计助手、Chrome DevTools — 全部打包，用户可切换。 |
| ⚡ **88 个功能开关** | ULTRAPLAN 多代理、ULTRATHINK 深度推理、语音输入、IDE 桥接，以及 80+ 更多。 |
| 🛡️ **智能权限** | Auto 模式自动批准安全操作，仅对危险命令提示确认。Skill 级 `disallowed-tools` 精细控制。无需 LLM 分类器。 |
| 🧠 **上下文管理** | 自动压缩、硬压缩（确定性、零 token 开销）、MLX 内存安全 — 支持 32K 窗口。压缩保留敏感指令。 |

---

## 快速开始

### 前置条件

- **Bun** >= 1.3.11 — 安装命令 `curl -fsSL https://bun.sh/install | bash`
- **macOS Apple Silicon**（M1/M2/M3/M4）用于本地 MLX 推理；Linux/Windows 可使用云端供应商或远程 MLX

### 安装与运行

```bash
git clone https://github.com/dahai80/fusion-code.git
cd fusion-code
bun install
bun run build
```

选择模型供应商：

#### 方案 A：本地 MLX（无需云端 Key）

```bash
# 1. 安装并启动 fusion-mlx（独立项目）
#    参考：https://github.com/fusion-mlxs/fusion-mlx
pip install fusion-mlx
fusion-mlx start

# 2. 下载模型（中国用户使用 hf-mirror.com）
#    推荐模型：
#      - Qwen2.5-Coder-7B-Instruct  (7B，均衡)
#      - Qwen2.5-Coder-14B-Instruct (14B，更强推理)
#      - Qwen2.5-Coder-32B-Instruct (32B，最佳质量，需 32GB+ 内存)
#    示例：
export HF_ENDPOINT=https://hf-mirror.com
fusion-mlx pull qwen2.5-coder-7b-instruct

# 3. 启动 fusion-code — 自动检测端口 11434 上的 MLX
./fusion-code
```

#### 方案 B：Anthropic 云端（直连 API）

```bash
# 设置 API Key（持久化到 ~/.zshrc 或 ~/.bashrc）
export FUSION_API_KEY="sk-ant-..."

# 可选：指定模型
export FUSION_MODEL="claude-sonnet-5"

./fusion-code
```

#### 方案 C：Anthropic 代理 / LiteLLM

适用于无法访问 `api.anthropic.com` 的区域，或通过网关共享 Key：

```bash
# 指向代理（包含路径，如 OpenAI 兼容代理的 /v1）
export FUSION_BASE_URL="http://your-proxy:4000/v1"
export FUSION_API_KEY="sk-..."                    # 代理接受的 Key

# 可选：Bearer Token 代替 x-api-key
export FUSION_AUTH_TOKEN="sk-..."

# 可选：网关路由额外 Header
export FUSION_CUSTOM_HEADERS='{"X-Routing-Key":"abc"}'

./fusion-code
```

> **提示：** 将 `export` 行添加到 `~/.zshrc` 或 `~/.bashrc` 以持久化环境变量，然后 `source ~/.zshrc`。

### 更新

```bash
cd fusion-code
git pull
bun install
bun run build
```

---

## 模型供应商

fusion-code 支持多个 API 后端。供应商按以下优先级自动选择：

1. **fusionMlx（本地）** — 若 `FUSION_MLX_ENABLED=1` 或无云端 Key → 本地 MLX `127.0.0.1:11434`
2. **openai** — 若 `FUSION_CODE_USE_OPENAI=1` → OpenAI Codex（OAuth）
3. **foundry** — 若 `FUSION_CODE_USE_FOUNDRY=1` → Azure AI Foundry
4. **firstParty（Anthropic）** — 若 `FUSION_API_KEY` 已设置 → Anthropic API（直连或代理）

> 第一个匹配的供应商优先。若均不匹配，自动检测端口 11434 上的本地 MLX。

**降级模型**：主模型过载（529）或限速（429）时，fusion-code 自动降级到更小的模型。默认链：opus→sonnet→haiku。可通过 `FUSION_FALLBACK_MODEL` 或 `/config fallbackModel` 覆盖。

### 供应商配置一览

| 供应商 | 必需环境变量 | 认证方式 | 备注 |
|---|---|---|---|
| **fusionMlx（本地）** | 无（端口 11434 自动） | 本地 | 仅 Apple Silicon；用 `FUSION_MLX_MODEL` 指定模型 |
| **fusionMlx（远程）** | `FUSION_MLX_BASE_URL` | 本地或 `FUSION_MLX_API_KEY` | 在另一台 Mac 运行 MLX，通过网络连接 |
| **Anthropic 直连** | `FUSION_API_KEY` | API Key / OAuth | 用 `FUSION_MODEL` 指定模型 |
| **Anthropic 代理** | `FUSION_BASE_URL` + `FUSION_API_KEY` | API Key 或 `FUSION_AUTH_TOKEN` | LiteLLM、OpenRouter、内部网关 |
| **OpenAI Codex** | `FUSION_CODE_USE_OPENAI=1` | OAuth | 首次启动应用内登录 |
| **Foundry** | `FUSION_CODE_USE_FOUNDRY=1` + `FUSION_FOUNDRY_RESOURCE` | API Key / Azure AD | `FUSION_FOUNDRY_API_KEY` 或 Azure DefaultAzureCredential |

### 模型选择优先级

会话覆盖（`/model`）> `--model` CLI 参数 > `FUSION_MODEL` / `FUSION_MLX_MODEL` 环境变量 > 已保存设置。

### FUSION_* 环境变量

`FUSION_*` 变量在启动时映射为 `ANTHROPIC_*` 以兼容 SDK：

| Fusion 变量 | Anthropic 等价 | 示例 |
|---|---|---|
| `FUSION_API_KEY` | `ANTHROPIC_API_KEY` | `sk-ant-api03-...` |
| `FUSION_BASE_URL` | `ANTHROPIC_BASE_URL` | `http://proxy:4000/v1` |
| `FUSION_AUTH_TOKEN` | `ANTHROPIC_AUTH_TOKEN` | `sk-...`（Bearer Token） |
| `FUSION_MODEL` | `ANTHROPIC_MODEL` | `claude-sonnet-5` |
| `FUSION_MLX_MODEL` | — | `qwen2.5-coder-7b-instruct` |
| `FUSION_MLX_BASE_URL` | — | `http://192.168.1.10:11434` |
| `FUSION_CUSTOM_HEADERS` | — | `{"X-Key":"val"}` |
| `FUSION_BETAS` | `ANTHROPIC_BETAS` | `max-tokens-3-5-sonnet-2024-07-15` |
| `FUSION_FALLBACK_MODEL` | — | `claude-sonnet-5`（未设置时自动推导） |
| `FUSION_CREDENTIAL_SANDBOX` | — | `1` 从工具输出中脱敏凭据 |
| `FUSION_CODE_USE_BEDROCK` | — | `1` 使用 AWS Bedrock |
| `FUSION_CODE_USE_VERTEX` | — | `1` 使用 Google Vertex AI |
| `FUSION_SAFE_MODE` | — | `1` 只读 + 无 Shell + 无网络 |
| `FUSION_CODE_FOCUS_VIEW` | — | `1` 隐藏冗长工具输出（聚焦模式） |

### 调优环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `CLAUDE_DISABLE_STREAM_WATCHDOG` | 未设置 | 设为 `1` 禁用流空闲看门狗（自动中止挂起连接） |
| `CLAUDE_STREAM_IDLE_TIMEOUT_MS` | `300000`（5 分钟） | 看门狗中止空闲流的毫秒数 |
| `FUSION_CODE_FOCUS_VIEW` | 未设置 | 设为 `1` 折叠冗长工具输出（聚焦模式） |

### 键盘快捷键

| 快捷键 | 操作 |
|---|---|
| `Ctrl+Shift+↑` | 增加推理等级 |
| `Ctrl+Shift+↓` | 降低推理等级 |
| `/effort <level>` | 设置推理等级（low/medium/high/max） |
| `/focus on\|off` | 切换聚焦视图（折叠冗长输出） |

### 云端配置详情

#### Anthropic 直连

```bash
export FUSION_API_KEY="sk-ant-..."
# 可选：选择特定模型
export FUSION_MODEL="claude-sonnet-5"
./fusion-code
```

OAuth 登录（无需 API Key）也可用 — 启动 `./fusion-code` 并按应用内浏览器登录提示操作。

#### Anthropic 代理 / LiteLLM

通过网关路由 API 调用。适用于：
- 你所在区域 `api.anthropic.com` 被屏蔽
- 你通过企业代理共享 Key
- 你运行 LiteLLM 统一多个供应商

```bash
export FUSION_BASE_URL="http://your-proxy:4000/v1"
export FUSION_API_KEY="sk-..."
./fusion-code
```

> **URL 格式：** `FUSION_BASE_URL` 应指向基础端点。SDK 会自动追加 `/messages`。LiteLLM 使用 `http://host:4000`（无 `/v1` 后缀）。OpenAI 兼容代理需包含 `/v1`。

#### OpenAI Codex

```bash
export FUSION_CODE_USE_OPENAI=1
./fusion-code   # OAuth 登录将自动启动
```

#### Azure AI Foundry

```bash
export FUSION_CODE_USE_FOUNDRY=1
export FUSION_FOUNDRY_RESOURCE="my-foundry"   # 或 FUSION_FOUNDRY_BASE_URL
export FUSION_FOUNDRY_API_KEY="..."
./fusion-code
```

若未设置 Key，使用 Azure AD `DefaultAzureCredential`。设 `FUSION_CODE_SKIP_FOUNDRY_AUTH=1` 用于未认证测试端点。

#### AWS Bedrock

```bash
export FUSION_CODE_USE_BEDROCK=1
export AWS_REGION="us-east-1"
# AWS 凭据通过环境变量、配置文件或 IAM 角色提供
./fusion-code
```

需要 `@anthropic-ai/bedrock-sdk`（`bun add @anthropic-ai/bedrock-sdk`）。用 `AWS_PROFILE` 指定命名配置，`AWS_BEDROCK_MODEL` 指定模型 ID。

#### Google Vertex AI

```bash
export FUSION_CODE_USE_VERTEX=1
export GOOGLE_CLOUD_PROJECT="my-project"
export CLOUD_ML_REGION="us-east5"
# ADC 或服务账号凭据
./fusion-code
```

需要 `@anthropic-ai/vertex-sdk`（`bun add @anthropic-ai/vertex-sdk`）。用 `VERTEX_MODEL` 指定模型 ID。

#### 安全模式

```bash
./fusion-code --safe-mode
# 等同于：FUSION_SAFE_MODE=1 FUSION_CREDENTIAL_SANDBOX=1
```

只读模式：Write、Edit、Bash、WebFetch 和网络工具被禁用。凭据沙箱自动启用。

#### 屏幕阅读器模式

```bash
./fusion-code --ax-screen-reader
# 等同于：FUSION_SCREEN_READER=1
```

禁用动画和旋转效果以兼容屏幕阅读器。运行时用 `/screen-reader`（别名：`/ax`）切换。

#### MCP 认证

```bash
fusion-code mcp login <server-name>   # 为 MCP 服务器启动 OAuth 流程
fusion-code mcp logout <server-name>  # 清除已存储的认证
```

#### 远程 fusion-mlx

在另一台 Mac 上运行 fusion-mlx 并通过网络连接：

```bash
export FUSION_MLX_BASE_URL="http://192.168.1.10:11434"
# 可选：若远程需要认证
export FUSION_MLX_API_KEY="..."
./fusion-code
```

---

## 本地 MLX

### 设置

1. **安装 fusion-mlx**：`pip install fusion-mlx`（参见 [fusion-mlx 仓库](https://github.com/fusion-mlxs/fusion-mlx)）
2. **启动服务器**：`fusion-mlx start` — 监听 `127.0.0.1:11434`
3. **下载模型**（中国使用 HuggingFace 镜像）：

```bash
# 中国用户先设置镜像
export HF_ENDPOINT=https://hf-mirror.com

# 下载推荐模型
fusion-mlx pull qwen2.5-coder-7b-instruct
```

4. **指定模型**（可选）：

```bash
export FUSION_MLX_MODEL="qwen2.5-coder-14b-instruct"
./fusion-code
```

### 推荐模型

| 模型 | 大小 | 所需内存 | 最佳场景 |
|---|---|---|---|
| `qwen2.5-coder-7b-instruct` | 7B | 8 GB | 快速响应、代码补全 |
| `qwen2.5-coder-14b-instruct` | 14B | 16 GB | 更强推理、均衡 |
| `qwen2.5-coder-32b-instruct` | 32B | 32 GB+ | 最佳质量、复杂任务 |

> 端口 11434 兼容 Ollama。如果你已运行带代码模型的 Ollama，fusion-code 可直接使用。

### MLX 提示词分级系统

本地模型上下文窗口有限。系统提示词和工具集按模型大小自动缩放：

| 级别 | 模型大小 | 上下文 | ~系统 Token | 工具 |
|---|---|---|---|---|
| `mini` | ≤3B | 任意 | ~2K | 5 核心 |
| `compact` | 32B+ | ≤32K | ~3K | 5 核心 |
| `standard` | 7B-9B | 任意 | ~8K | 9 标准 |
| `extended` | 14B | 任意 | ~12K | 15 扩展 |
| `full` | 32B+ | >32K | ~24K | 全部 |

**compact 级别**将系统提示词控制在 ~3K token，工具限制为 5 核心（Read、Edit、Bash、Glob、Grep），留出 ~24K token 给对话。

工具分级：
- **核心**（≤32K 窗口）：Read、Edit、Bash、Glob、Grep + MCP 工具
- **标准**（≤64K 窗口）：核心 + Write、LS
- **扩展**（>64K 窗口）：标准 + TodoRead/Write、TaskCreate/Get/Update/List、WebSearch/Fetch

AutoCompact 在有效上下文窗口的 60% 时触发。32K 窗口上，硬压缩使用确定性截断（零 LLM 调用、零 token 开销）代替摘要。

### MLX 用户体验

使用 fusion-mlx 作为供应商时，依赖 claude.ai 的功能会自动隐藏或适配：

- **`/login` 和 `/logout`** — 隐藏（MLX 不需要 claude.ai 认证）
- **语音模式** — 隐藏（需要 claude.ai 音频流）
- **频道** — 隐藏（需要 claude.ai 基础设施）
- **传送 / 远程环境** — 隐藏（需要 claude.ai 会话）
- **远程代理调度** — 隐藏（需要 claude.ai 基础设施）
- **认证错误消息** — 显示 "fusion-mlx 不可用 · 运行 `fusion service start mlx` 或设置 FUSION_API_KEY" 而非 "未登录 · 运行 /login"

确保 MLX 用户不会遇到令人困惑的 claude.ai 登录提示。

### 本地模型行为提示词

当 `provider=fusionMlx` 时，fusion-code 自动向系统提示词追加**行为提示词**（~2.9K token）。该提示词涵盖：

- **首要优先级** — 正确性、有用性、诚实性、清晰性
- **理解请求** — 区分事实、假设、不确定性、意见
- **推理** — 逐步思考、考虑边界情况、验证结论
- **沟通** — 简洁、结构化复杂回答、承认知识局限
- **编码** — 先读后写、匹配现有风格、测试你修改的内容
- **可靠性** — 永不编造信息、标记矛盾、显式失败

该提示词源自供应商中立的 Fable 5 系统提示词（均衡级别）。仅在本地模型上激活 — 云端供应商已有强行为训练。对应的**核心级别**（~1.4K，13 条原则）在无系统消息时由 fusion-mlx 在推理端注入，确保即使裸 API 调用也能获得基准指导。

### Context Hub 集成

fusion-code 自动检测 [Context Hub](https://github.com/anthropics/context-hub)（`chub`）CLI 并在 researcher、explorer、code-reviewer 和通用子代理中注入提示。当可用时，代理将：

1. 使用 `chub search "query"` 查找相关 API 文档
2. 使用 `chub get <id> --lang <py|js|go>` 获取版本化文档
3. 通过引用经过验证的最新文档减少幻觉

单独安装 Context Hub：`npm install -g @aisuite/chub`。无需配置 — fusion-code 自动检测。

基于 MCP 的集成（所有代理类型，不仅子代理），添加到 `~/.fusion-code/settings.json`：

```json
{
  "mcpServers": {
    "chub-mcp": {
      "command": "npx",
      "args": ["-y", "@aisuite/chub-mcp"]
    }
  }
}
```

---

## 构建

```bash
bun run build              # ./fusion-code（生产版，仅 VOICE_MODE）
bun run build:dev          # ./fusion-code-dev（开发版，仅 VOICE_MODE）
bun run build:dev:full     # ./fusion-code-dev（所有实验性标志）
bun run compile            # ./dist/fusion-code（替代输出）
```

### 自定义功能标志

```bash
# 启用特定标志
bun run ./scripts/build.ts --feature=ULTRAPLAN --feature=ULTRATHINK

# 开发版 + 全部标志 + 额外标志
bun run ./scripts/build.ts --dev --feature-set=dev-full --feature=BRIDGE_MODE
```

---

## 使用

```bash
./fusion-code                          # 交互式 REPL
./fusion-code -p "解释这段代码"          # 单次模式
./fusion-code --model <model-id>       # 覆盖模型
bun run dev                            # 从源码运行
```

### 权限模式

按 **Shift+Tab** 切换模式：

| 模式 | 行为 | 最佳场景 |
|---|---|---|
| **Manual** | 每次工具使用都询问 | 首次用户、谨慎工作流 |
| **Auto** ✅ | 自动批准安全操作；危险操作提示确认；不可逆操作阻止 | 日常编码（推荐） |
| **Accept Edits** | 自动批准文件编辑；bash 需确认 | 重构、代码生成 |
| **Plan** | 只读 — 不执行文件/命令 | 代码审查、探索 |

**Auto 模式**使用 `classifyAllShell` — 对每个 Shell 命令的确定性分类器。安全命令（`ls`、`cat`、`git status`、`npm install`、`make` 等）自动批准。危险命令（`rm -rf`、`sudo`、`git push`、`docker rm`、`python`、`node -e`）需确认。不可逆命令（`git push --force`、`terraform destroy`、`kubectl delete`、`DROP TABLE`）即使在自动模式也硬拒绝。未知命令默认需确认。

### 动态工作流（YAML + JS）

工作流可以用 YAML 或 JavaScript 定义。YAML 工作流在运行时自动转换为 JS 脚本：

```yaml
# .claude/workflows/review.yaml
name: review-changes
description: Review changed files across dimensions
phases:
  - title: Review
  - title: Verify
steps:
  - agent: Review code for bugs and security issues
    phase: Review
    label: review-bugs
  - agent: Review code for performance problems
    phase: Review
    label: review-perf
  - agent: Verify findings with adversarial checks
    phase: Verify
    label: verify
```

JS 工作流直接使用 `agent()`、`phase()`、`pipeline()` 和 `parallel()`（参见[工作流文档](src/tools/WorkflowTool/)）。

### 常用斜杠命令

| 命令 | 说明 |
|---|---|
| `/model` | 切换或查看当前模型（跨会话持久） |
| `/compact` | 压缩对话上下文释放空间 |
| `/usage` | 显示 Token 用量、费用和活动统计（别名：`/stats`、`/cost`） |
| `/cd` | 在 REPL 内切换工作目录 |
| `/code-review` | 代码审查，可选 `--fix` 自动修复（别名：`/review`） |
| `/reload-skills` | 热重载命令、插件和技能，无需重启 |
| `/doctor` | 诊断常见配置问题 |
| `/env` | 显示供应商、模型和 Key 环境变量 |
| `/ctx_viz` | 可视化上下文窗口使用量 |
| `/summary` | 生成当前对话摘要 |
| `/workflows` | 列出和运行工作流脚本（支持 YAML 和 JS） |
| `/subtask` | 生成内联子代理处理特定任务 |
| `/fork` | 在当前对话上下文中创建子代理分支 |
| `/break-cache` | 重置提示词缓存破坏检测 |
| `/goal` | 目标管理带预算追踪 |
| `/undo`（`/rewind`） | 撤销 N 个锚点，带压缩边界感知 |
| `/health` | 任务健康概览和恢复 |
| `/steer` | 向当前轮次注入后续输入 |
| `/btw` | 提问侧问题不中断主工作流 |
| `/approve-session` | 会话级自动批准工具 |
| `/focus` | 切换聚焦视图 — 隐藏冗长工具输出 |
| `/tui` | 切换无闪烁全屏渲染 |
| `/dataviz` | 生成终端数据可视化（柱状图、迷你图、表格） |
| `/recap` | 显示当前会话回顾 |
| `/plugins` | 列出已安装插件 |
| `/screen-reader`（`/ax`） | 切换屏幕阅读器模式 |
| `/memory-search` | 搜索已保存记忆和项目上下文文件 |
| `/history-search` | 搜索对话记录，带隐私脱敏 |
| `/suggest` | 基于最近工具使用获取下一步行动建议 |
| `/deploy` | 检测项目部署平台并显示部署命令 |
| `/preview` | 检测开发服务器配置并显示连接信息 |
| `/scaffold` | 生成框架特定的项目脚手架指令 |
| `/progress` | 显示事件流历史 |
| `/research` | 深度研究模式，多步搜索与综合 |
| `/run` | 通过 Bash 工具执行代码片段 |
| `/tour` | 交互式功能导览和项目入门 |
| `/integrations` | 集成市场 |
| `/diagram` | 从描述生成图表 |
| `/tool-discovery` | 显示工具分级和使用指标 |
| `/agent-orchestrator` | 多代理编排器 |

### 内置插件

| 插件 | 说明 | 默认 |
|---|---|---|
| **GitHub** | Issue/PR 集成、gh CLI 封装 | 启用 |
| **UI/UX Pro Max** | 设计系统助手（从 uipro-cli 自动安装） | 启用 |
| **Chrome DevTools** | 浏览器检查、截图、性能 | 启用 |

在 REPL 中用 `/plugin` 切换。

### 项目指令（CLAUDE.md）

在项目根目录放置 `CLAUDE.md` 文件，为 fusion-code 提供项目特定指令 — 编码规范、架构说明、首选库。启动时自动加载，提交到版本控制使整个团队共享相同的 AI 行为。

### 增强规则（FUSION.rules）

FUSION.rules 是优先级**高于 CLAUDE.md** 的增强规则文件。支持 frontmatter 字段用于项目级约束，AI 必须无条件遵守：

```yaml
---
denied_tools:
  - WebSearch
  - WebFetch
default_template: bug-fix
---
```

- `denied_tools` — 此项目阻止的工具名（如 `WebSearch`、`Bash`、`WebFetch`）
- `default_template` — 新会话自动分配的工作流模板

**文件位置：**
- 全局：`~/.fusion-code/FUSION.rules`
- 项目：`<project-root>/FUSION.rules`

**优先级（最高 → 最低）：** 全局 FUSION.rules → 项目 FUSION.rules → CLAUDE.md → `.fusion-code/rules/*.md` → `CLAUDE.local.md`

### 多语言会话标题

会话标题按你第一条消息的语言自动生成。中文输入 → 中文标题，英文 → 英文，以此类推。

---

## 实验性功能

`bun run build:dev:full` 构建启用所有可用的功能标志。默认 `bun run build` 仅包含 `VOICE_MODE`。

### 交互与 UI

| 标志 | 说明 |
|---|---|
| `ULTRAPLAN` | 远程多代理规划（Opus 级） |
| `ULTRATHINK` | 深度思考模式 — 输入 "ultrathink" 提升推理等级 |
| `VOICE_MODE` | 按键说话语音输入和听写 ✅（默认） |
| `TOKEN_BUDGET` | Token 预算追踪和使用警告 |
| `D_MAIL` | 代理驱动的上下文压缩（D-Mail 检查点/回退） |
| `APPROVE_SESSION` | 会话级权限批准，支持按来源取消 |
| `HISTORY_PICKER` | 交互式提示历史选择器 |
| `MESSAGE_ACTIONS` | UI 中的消息操作入口 |
| `QUICK_SEARCH` | 提示快速搜索 |

### 代理、记忆与规划

| 标志 | 说明 |
|---|---|
| `BUILTIN_EXPLORE_PLAN_AGENTS` | 内置探索/规划代理预设 |
| `VERIFICATION_AGENT` | 任务验证代理 |
| `EXTRACT_MEMORIES` | 查询后自动提取记忆 |
| `COMPACTION_REMINDERS` | 上下文压缩相关智能提醒 |
| `CACHED_MICROCOMPACT` | 查询流中的缓存微压缩状态 |

### 工具与基础设施

| 标志 | 说明 |
|---|---|
| `BRIDGE_MODE` | IDE 远程控制桥接（VS Code、JetBrains） |
| `BASH_CLASSIFIER` | 分类器辅助 Bash 权限决策 |
| `PROMPT_CACHE_BREAK_DETECTION` | 压缩/查询流中的缓存破坏检测 |
| `MONITOR_TOOL` | 后台 MCP 任务监控 |
| `WORKFLOW_SCRIPTS` | 本地工作流任务脚本 |
| `WEB_BROWSER_TOOL` | 无头浏览器工具 |

全部 34 个历史上损坏的标志已于 2026-07-23 修复。参见 [FEATURES.md](FEATURES.md) 了解 88 个标志的完整审计。

---

## 项目结构

```
scripts/
  build.ts                # 构建脚本，含功能标志 DCE 系统

src/
  entrypoints/cli.tsx     # CLI 入口，FUSION_* 环境映射，快速路径分发
  main.js -> cliMain()    # 完整 REPL 引导
  screens/REPL.tsx        # 主交互界面（Ink/React）
  QueryEngine.ts          # LLM 查询引擎，会话状态
  commands.ts             # ~40+ 斜杠命令注册
  tools.ts                # 30+ 代理工具注册

  commands/               # /斜杠 命令实现
  tools/                  # 代理工具实现（Bash、Read、Edit 等）
  components/             # Ink/React 终端 UI 组件
  hooks/                  # React hooks
  services/
    api/                  # claude.ts + fusion-mlx 适配器/流 + codex 适配器
    oauth/                # OAuth 流程（Anthropic + OpenAI）
    mcp/                  # Model Context Protocol 集成
    lsp/                  # Language Server Protocol 集成
    compact/              # 上下文压缩
    privacy/              # 隐私脱敏
    model-router/         # 多级模型路由
    search-first/         # 搜索策略引擎
    suggestions/          # 上下文感知建议引擎
    events/               # 事件流
    deploy/               # 部署平台检测
    dev-server/           # 开发服务器检测
    research/             # 深度研究引擎
    license-check/        # 许可证检测
    visualizer/           # 图表生成
    onboarding/           # 项目画像检测
  state/                  # 应用状态存储
  utils/
    model/providers.ts    # 供应商选择
  skills/                 # 技能系统
  plugins/                # 插件系统
  bridge/                 # IDE 桥接
  voice/                  # 语音输入
  tasks/                  # 后台任务管理
```

---

## 技术栈

| | |
|---|---|
| **运行时** | [Bun](https://bun.sh) |
| **语言** | TypeScript |
| **终端 UI** | React + [Ink](https://github.com/vadimdemedes/ink) |
| **CLI 解析** | [Commander.js](https://github.com/tj/commander.js) |
| **Schema 验证** | Zod v4 |
| **代码搜索** | ripgrep（打包） |
| **协议** | MCP, LSP |
| **本地推理** | [fusion-mlx](https://github.com/fusion-mlxs/fusion-mlx)（MLX） |
| **云端 API** | Anthropic Messages, OpenAI Codex, Azure Foundry |

---

## 开发

### 构建与 Lint 状态

| 检查 | 状态 |
|---|---|
| `tsc --noEmit` | ✅ 零错误（原 511） |
| `tsc --noEmit --noUnusedLocals` | ✅ 零真实错误 |
| `bun run build` | ✅ 通过 |
| `bun run build:dev` | ✅ 通过 |

### Lint 清零历史

`chore/ci-lint-zero` 分支修复了全部 511 个 TypeScript 错误：

1. **构建常量辅助** — 91 个 TS2367 错误替换为 `isInternalBuild()`、`isTestEnv()`、`isDevEnv()`
2. **内部模块桩** — 10 个空操作桩用于 Anthropic 内部模块
3. **未使用的 React 导入** — 245+ 个 `import React from 'react'` 移除
4. **未使用导入与死代码** — 329 个文件中 400+ 未使用导入移除
5. **ProcessEnv 扩展** — `USER_TYPE?: string` 添加到 `env.d.ts`

### 版本历史

| 版本 | 主要变更 |
|---|---|
| **v0.3.4** | 修复权限提示重构导致的崩溃和模式提示重叠 |
| **v0.3.5** | 修复 SessionEnd 钩子空指针崩溃 |
| **v0.3.6** | 添加回归测试覆盖（22 通过） |
| **v0.3.7** | 修复 fusion-mlx-adapter 测试 mock 绕过问题（297 通过） |
| **v0.4.0** | 项目级 API 服务器、便携式 CLAUDE.md 解析器（312 通过） |
| **v0.4.4** | FUSION.rules 规则系统、MultiEdit 工具、审计日志、敏感文件保护、频率限制、新命令 |

## 开发者文档

- [`docs/developer-guide.md`](docs/developer-guide.md) — **场景化快速上手 + 配置排障矩阵**（使用 fusion-code 的开发者首选）
- [`docs/development.md`](docs/development.md) — 构建命令、feature flag 机制、env 映射表（改 fusion-code 本身）
- [`docs/model-providers.md`](docs/model-providers.md) — 6 个 provider 选择逻辑 + 各 provider env 配置示例
- [`docs/feature-flags.md`](docs/feature-flags.md) — 88 个 feature flag 详表
- [`docs/architecture.md`](docs/architecture.md) — 高层架构与核心子系统
- [`docs/trajectory-pipeline.md`](docs/trajectory-pipeline.md) — 会话→训练数据飞轮

## 贡献

1. Fork 仓库
2. 创建功能分支（`git checkout -b feat/my-feature`）
3. 提交更改（`git commit -m 'feat: add something'`）
4. 推送分支（`git push origin feat/my-feature`）
5. 开启 Pull Request

上游 `fusion-mlx` 问题：先提交 Issue，再提 PR，遵循上游贡献流程。

---

## 许可证

自行斟酌使用。详见项目许可证条款。
