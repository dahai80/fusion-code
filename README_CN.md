<p align="center">
  <h1 align="center">fusion-code</h1>
</p>

<p align="center">
  <strong>终端原生 AI 编码助手 — 集成 fusion-mlx 本地推理，零云端依赖可选。</strong><br>
  本地优先的终端 AI 编码助手，剥离云端遥测残留，集成 Apple Silicon 本地 MLX 推理引擎，34 个实验特性标志全修复。
</p>

<p align="center">
  <a href="#安装"><img src="https://img.shields.io/badge/install-bun%20build-blue?style=flat-square" alt="Install" /></a>
  <a href="#构建"><img src="https://img.shields.io/badge/version-0.2.0-green?style=flat-square" alt="Version" /></a>
  <a href="#实验功能"><img src="https://img.shields.io/badge/features-34%20flags%20fixed-orange?style=flat-square" alt="Feature Flags" /></a>
  <a href="#model-provider-系统"><img src="https://img.shields.io/badge/providers-6-teal?style=flat-square" alt="Providers" /></a>
</p>

---

## 目录

- [项目介绍](#项目介绍)
- [Model Provider 系统](#model-provider-系统)
- [环境变量映射](#环境变量映射)
- [安装](#安装)
- [构建](#构建)
- [使用](#使用)
- [实验功能](#实验功能)
- [项目结构](#项目结构)
- [技术栈](#技术栈)
- [性能基准](#性能基准)
- [贡献](#贡献)
- [许可](#许可)

---

## 项目介绍

fusion-code 是一个终端原生 AI 编码 CLI 工具，面向本地优先开发，集成 fusion-mlx 本地推理，支持六种云端后端可选。主要特性：

### 集成 fusion-mlx 本地推理

内置 fusion-mlx 适配器，可在 Apple Silicon (M 系列) 上通过本地 MLX 引擎运行大模型推理，无需任何云端 API key。fusion-mlx 服务运行在 `127.0.0.1:11434`，兼容 OpenAI `/v1/chat/completions` 接口格式，适配器内部做 Anthropic Messages API 格式转换，上层代码无感知。

当未配置云端 API key 时，自动检测并切换到本地 MLX 推理模式。

### 云端残留剥离

- 所有出站遥测端点（OpenTelemetry/gRPC、GrowthBook analytics、Sentry）已被 dead-code-eliminated 或 stub
- GrowthBook 特性标志评估仍在本地运行（运行时特性门控需要），但不回传任何数据
- 无崩溃报告、无用量分析、无会话指纹

### 34 个实验特性标志全修复

代码库原版有 88 个 `feature('FLAG')` 编译时标志，其中 34 个在公开快照中无法编译。fusion-code 通过恢复 12 个缺失入口文件、补齐 4 个已存在文件、以及 Phase 4-8 的逐步修复，使全部 34 个标志均能通过编译。详见 [FEATURES.md](FEATURES.md)。

---

## Model Provider 系统

fusion-code 支持 6 种 API provider，通过环境变量切换，无需修改代码。Provider 选择逻辑定义在 `src/utils/model/providers.ts` 的 `getAPIProvider()` 中，优先级如下：

| 优先级 | Provider | 触发条件 | 认证方式 |
|---|---|---|---|
| 1 | `fusionMlx` | `FUSION_MLX_ENABLED=1` 或未设置云 API key | 无需认证（本地推理） |
| 2 | `openai` | `FUSION_CODE_USE_OPENAI=1` | OpenAI OAuth |
| 3 | `foundry` | `FUSION_CODE_USE_FOUNDRY=1` | `ANTHROPIC_FOUNDRY_API_KEY` |
| 4 | `bedrock` | `CLAUDE_CODE_USE_BEDROCK=1` | AWS 凭证 |
| 5 | `vertex` | `CLAUDE_CODE_USE_VERTEX=1` | `gcloud` ADC |
| 6 | `firstParty` | 默认（有云 API key 时） | `FUSION_API_KEY` / OAuth |

### fusion-mlx 本地推理（默认）

当没有云 API key 时自动启用。通过 `fusion service start mlx` 启动本地服务（端口 11434），自动检测可用模型。

```bash
# 启动本地 MLX 服务
fusion service start mlx

# 直接运行（自动检测 11434 端口）
./fusion-code
```

强制启用本地推理：

```bash
export FUSION_MLX_ENABLED=1
./fusion-code
```

禁用本地推理（回退到云端）：

```bash
export FUSION_MLX_DISABLED=1
export FUSION_API_KEY="your-key"
./fusion-code
```

### Anthropic 直连 API

```bash
export FUSION_API_KEY="sk-ant-..."
./fusion-code
```

### OpenAI Codex

```bash
export FUSION_CODE_USE_OPENAI=1
./fusion-code
```

### AWS Bedrock

```bash
export CLAUDE_CODE_USE_BEDROCK=1
export AWS_REGION="us-east-1"
./fusion-code
```

### Google Vertex AI

```bash
export CLAUDE_CODE_USE_VERTEX=1
./fusion-code
```

### Anthropic Foundry

```bash
export FUSION_CODE_USE_FOUNDRY=1
export ANTHROPIC_FOUNDRY_API_KEY="..."
./fusion-code
```

模型解析优先级：会话覆盖（`/model`）> `--model` 参数 > `FUSION_MODEL` / `FUSION_MLX_MODEL` 环境变量 > 已保存设置。

---

## 环境变量映射

fusion-code 使用 `FUSION_*` 前缀的环境变量，启动时自动映射到 `ANTHROPIC_*` 以兼容 Anthropic SDK：

| Fusion 环境变量 | Anthropic 等价 | 用途 |
|---|---|---|
| `FUSION_API_KEY` | `ANTHROPIC_API_KEY` | Anthropic API 密钥 |
| `FUSION_BASE_URL` | `ANTHROPIC_BASE_URL` | 自定义 API 端点 |
| `FUSION_AUTH_TOKEN` | `ANTHROPIC_AUTH_TOKEN` | 认证 token（替代方案） |
| `FUSION_MODEL` | `ANTHROPIC_MODEL` | 覆盖默认模型 |
| `FUSION_BETAS` | `ANTHROPIC_BETAS` | Beta 功能标志 |
| `FUSION_LOG` | `ANTHROPIC_LOG` | 日志级别 |

fusion-mlx 专用环境变量：

| 变量 | 用途 |
|---|---|
| `FUSION_MLX_ENABLED` | 设为 `1` 强制启用本地 MLX 推理 |
| `FUSION_MLX_DISABLED` | 设为 `1` 禁用本地 MLX，回退云端 |
| `FUSION_MLX_MODEL` | 指定本地 MLX 模型 |
| `FUSION_MLX_AUTO` | 自动检测模式 |

配置目录默认为 `~/.fusion-code`，独立隔离，互不干扰。

---

## 安装

### 前置要求

- [Bun](https://bun.sh) >= 1.3.11
- macOS 或 Linux（Windows 通过 WSL）
- API key 或 OAuth 登录（使用云端 provider 时）
- Apple Silicon Mac（使用本地 MLX 推理时）

```bash
# 安装 Bun
curl -fsSL https://bun.sh/install | bash

# 克隆仓库
git clone https://github.com/dahai80/fusion-code.git
cd fusion-code

# 安装依赖
bun install
```

---

## 构建

```bash
# 标准构建（./fusion-code，仅 VOICE_MODE 启用）
bun run build

# 开发构建（./fusion-code-dev，仅 VOICE_MODE 启用）
bun run build:dev

# 开发构建 + 全部实验特性（./fusion-code-dev）
bun run build:dev:full

# 编译构建（./dist/fusion-code）
bun run compile

# 从源码运行（启动较慢）
bun run dev
```

### 构建变体

| 命令 | 产物 | 特性标志 | 说明 |
|---|---|---|---|
| `bun run build` | `./fusion-code` | `VOICE_MODE` | 生产级二进制 |
| `bun run build:dev` | `./fusion-code-dev` | `VOICE_MODE` | 开发版本号戳 |
| `bun run build:dev:full` | `./fusion-code-dev` | 全部实验标志 | 完整解锁构建 |
| `bun run compile` | `./dist/fusion-code` | `VOICE_MODE` | 替代输出路径 |

### 自定义特性标志

```bash
# 只启用 ULTRAPLAN 和 ULTRATHINK
bun run ./scripts/build.ts --feature=ULTRAPLAN --feature=ULTRATHINK

# 在 dev 构建基础上追加标志
bun run ./scripts/build.ts --dev --feature=BRIDGE_MODE
```

构建系统使用 Bun 原生 bundler（`bun build --compile`），通过 `--feature=NAME` 传入特性标志，以 `feature('X')` 调用实现 dead-code elimination。构建时宏：`MACRO.VERSION`、`MACRO.BUILD_TIME`、`process.env.USER_TYPE`（设为 `"external"`）。

---

## 使用

```bash
# 交互式 REPL（默认）
./fusion-code

# 单次模式
./fusion-code -p "当前目录有哪些文件？"

# 指定模型
./fusion-code --model <model-id>

# 从源码运行
bun run dev

# OAuth 登录
./fusion-code /login

# 查看版本
./fusion-code --version

# 转储系统提示词
./fusion-code --dump-system-prompt
```

启动后进入交互式终端 UI（React/Ink），支持斜杠命令（`/`开头）、工具调用、语音输入、任务列表、上下文压缩、会话管理等功能。

---

## 实验功能

fusion-code 的 `bun run build:dev:full` 构建启用全部实验特性标志。以下是部分亮点：

### 交互与 UI

| 标志 | 说明 |
|---|---|
| `ULTRAPLAN` | 远程多 agent 规划（Opus 级别） |
| `ULTRATHINK` | 深度思考模式，输入 "ultrathink" 提升推理力度 |
| `VOICE_MODE` | 按键说话语音输入与听写（默认启用） |
| `TOKEN_BUDGET` | Token 预算跟踪与用量告警 |
| `HISTORY_PICKER` | 交互式提示历史选择器 |
| `MESSAGE_ACTIONS` | 消息操作入口 |
| `QUICK_SEARCH` | 提示快速搜索 |

### Agent、记忆与规划

| 标志 | 说明 |
|---|---|
| `BUILTIN_EXPLORE_PLAN_AGENTS` | 内置 explore/plan agent 预设 |
| `VERIFICATION_AGENT` | 任务验证 agent |
| `EXTRACT_MEMORIES` | 查询后自动提取记忆 |
| `COMPACTION_REMINDERS` | 上下文压缩智能提醒 |
| `CACHED_MICROCOMPACT` | 缓存 microcompact 状态 |
| `AGENT_MEMORY_SNAPSHOT` | Agent 记忆快照 |

### 工具与基础设施

| 标志 | 说明 |
|---|---|
| `BRIDGE_MODE` | IDE 远程控制桥接（VS Code、JetBrains） |
| `BASH_CLASSIFIER` | 分类器辅助 bash 权限决策 |
| `PROMPT_CACHE_BREAK_DETECTION` | 压缩/查询流中的缓存断裂检测 |
| `TREE_SITTER_BASH` | Tree-sitter Bash 解析 |
| `NATIVE_CLIPBOARD_IMAGE` | 原生剪贴板图片支持 |

完整 88 个标志的审计（含 34 个已修复标志的重建记录）见 [FEATURES.md](FEATURES.md)。

---

## 项目结构

```
scripts/
    build.ts                    # 构建脚本，含特性标志系统
benchmarks/
    benchmark.ts                # 性能基准脚本
    README.md                   # 基准说明

src/
    entrypoints/cli.tsx         # CLI 入口
    commands.ts                 # 斜杠命令注册表（40+ 命令）
    tools.ts                    # Agent 工具注册表（30+ 工具）
    QueryEngine.ts              # LLM 查询引擎
    screens/REPL.tsx            # 主交互 UI（Ink/React）

    commands/                   # /斜杠命令实现
    tools/                      # Agent 工具实现（Bash, Read, Edit 等）
    components/                 # Ink/React 终端 UI 组件
    hooks/                      # React hooks
    services/
        api/                    # API 客户端 + MLX 适配器 + Codex 适配器
        oauth/                  # OAuth 流程（Anthropic + OpenAI）
        mcp/                    # Model Context Protocol 集成
        lsp/                    # Language Server Protocol 集成
    state/                      # 应用状态存储
    utils/
        model/                  # 模型配置、provider、验证
    skills/                     # Skill 系统
    plugins/                    # 插件系统
    bridge/                     # IDE 桥接（VS Code、JetBrains）
    voice/                      # 语音输入
    tasks/                      # 后台任务管理
```

---

## 技术栈

| | |
|---|---|
| **运行时** | [Bun](https://bun.sh) >= 1.3.11 |
| **语言** | TypeScript |
| **终端 UI** | React + [Ink](https://github.com/vadimdemedes/ink) |
| **CLI 解析** | [Commander.js](https://github.com/tj/commander.js) |
| **Schema 校验** | Zod v4 |
| **代码搜索** | ripgrep（内置） |
| **协议** | MCP（Model Context Protocol）、LSP（Language Server Protocol） |
| **本地推理** | fusion-mlx（MLX 引擎，端口 11434） |
| **API** | Anthropic Messages、OpenAI Codex、AWS Bedrock、Google Vertex AI、Anthropic Foundry |

---

## 性能基准

fusion-code 内置性能基准测试脚本，可测量二进制启动时间、构建耗时、产物体积和本地 MLX 推理延迟。

```bash
# 运行基准测试
bun run benchmarks/benchmark.ts
```

结果输出到控制台表格和 `benchmarks/results.json`。详见 [benchmarks/README.md](benchmarks/README.md)。

---

## 贡献

欢迎提交 Issue 和 Pull Request。

1. Fork 仓库
2. 创建特性分支（`git checkout -b feat/my-feature`）
3. 提交更改（`git commit -m 'feat: add something'`）
4. 推送分支（`git push origin feat/my-feature`）
5. 发起 Pull Request

如果需要恢复或改进实验特性标志，请先查阅 [FEATURES.md](FEATURES.md) 中的重建记录。

---

## 许可

使用风险自负。具体条款见项目许可声明。
