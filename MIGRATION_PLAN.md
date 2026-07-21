# Fusion-Code 迁移与演进方案

## 按照 OpenCode 模式实现设计目标

> 本文档定义 fusion-code 从 Claude Code 分支（free-code）向本地优先、fusion-mlx 驱动的 AI 编程助手演进的完整迁移计划。
>
> 参考模式：Fusion-Design 的 OpenPencil 集成方案（[INTEGRATION_PLAN.md](../fusion-design/docs/INTEGRATION_PLAN.md)）

---

## 一、现状分析

### 1.1 当前架构

```
fusion-code (Bun/TypeScript)
├── 入口层: cli.tsx → REPL.tsx (Ink/React TUI)
├── API 层: client.ts → claude.ts / codex-fetch-adapter.ts
│   ├── @anthropic-ai/sdk (Anthropic Messages API)
│   ├── OpenAI Codex (codex-fetch-adapter)
│   ├── AWS Bedrock (bedrock-sdk)
│   └── Google Vertex AI (vertex-sdk)
├── 工具层: tools.ts → Bash/Read/Write/Edit/Grep/Glob 等
├── 命令层: commands.ts → /commit, /init, /config 等
├── 插件层: utils/plugins/ → 市场插件 + 内置插件
├── MCP 层: services/mcp/ → MCP 客户端/服务器
├── 技能层: skills/bundled/ → 内置技能
├── 桥接层: bridge/ → IDE 桥接 (VS Code, JetBrains)
├── 遥测层: services/analytics/ → OpenTelemetry, GrowthBook (已剥离)
└── 构建层: scripts/build.ts → 88 个特性标志
```

### 1.2 关键依赖

| 依赖 | 用途 | 迁移方向 |
|------|------|---------|
| `@anthropic-ai/sdk` | 核心 LLM API 调用 | 替换为 fusion-mlx HTTP 客户端 |
| `@anthropic-ai/claude-agent-sdk` | Agent SDK | 替换为本地 Agent 引擎 |
| `@anthropic-ai/bedrock-sdk` | Bedrock 提供商 | 删除（本地不依赖） |
| `@anthropic-ai/vertex-sdk` | Vertex AI 提供商 | 删除（本地不依赖） |
| `@anthropic-ai/mcpb` | MCP 桥接 | 保留但改造为本地 MCP |
| `@anthropic-ai/sandbox-runtime` | 沙箱运行时 | 删除或替换为本地沙箱 |
| `@aws-sdk/*` | AWS 认证 | 删除 |
| `google-auth-library` | GCP 认证 | 删除 |
| `@opentelemetry/*` | 遥测 | 已剥离 |
| `@growthbook/growthbook` | 特性标志 | 已剥离但保留本地评估 |

### 1.3 当前能力矩阵

| 能力 | 当前状态 | 目标状态 |
|------|---------|---------|
| AI 代码生成 | 依赖 Anthropic/OpenAI 云 API | 融合 fusion-mlx 本地推理 |
| 代码理解 | 云 API + LSP | 本地 MLX + LSP |
| 文件操作 | 本地工具 (Bash/Read/Write/Edit) | 保留并增强 |
| Git 集成 | 本地工具 + GitHub API | 保留 + 支持 Gitee/GitLab |
| MCP 协议 | 支持 | 保留并增强本地 MCP |
| 插件系统 | 市场插件 | 扩展为 Fusion 插件生态 |
| 技能系统 | 内置技能 | 扩展为 Fusion 技能 |
| 桥接模式 | IDE 桥接 (VS Code/JetBrains) | 保留 + Fusion-Desk 集成 |
| 遥测 | 已剥离 | 继续保持无遥测 |
| 用户认证 | Anthropic/OpenAI OAuth | 替换为本地认证/无认证 |

---

## 二、目标架构（OpenCode 模式）

### 2.1 最终架构

```
fusion-code (Bun/TypeScript — 本地优先 AI 编程助手)
├── 入口层: cli.tsx → REPL.tsx (Ink/React TUI)
├── API 层: client.ts → fusion-mlx-adapter.ts
│   └── fusion-mlx (本地 HTTP API: 127.0.0.1:11434/v1/chat/completions)
├── 工具层: tools.ts → Bash/Read/Write/Edit/Grep/Glob 等
├── 命令层: commands.ts → /commit, /init, /config 等
├── 插件层: Fusion 插件生态 (fusion-plugins-ecosystem)
├── MCP 层: services/mcp/ → 本地 MCP 服务器
├── 技能层: skills/bundled/ → Fusion 技能
├── 桥接层: bridge/ → IDE 桥接 + Fusion-Desk 集成
├── 知识库层: services/kb/ → fusion-kb 集成 (RAG)
├── 生态层: services/ecosystem/ → Fusion 全生态联动
└── 构建层: scripts/build.ts → 简化特性标志
```

### 2.2 通信架构

```
┌─────────────────────────────────────────────────────┐
│  fusion-code CLI (Bun/TypeScript)                    │
│  ┌─────────────────────────────────────────────────┐ │
│  │  fusion-mlx-adapter.ts                           │ │
│  │  ┌─────────────────────────────────────────────┐ │ │
│  │  │  /v1/chat/completions (本地 HTTP)            │ │ │
│  │  │  /v1/embeddings (知识库 RAG)                 │ │ │
│  │  │  /v1/models (模型列表)                       │ │ │
│  │  └─────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────┘ │
│                          │                            │
│                          ▼                            │
│  ┌─────────────────────────────────────────────────┐ │
│  │  fusion-mlx (Apple Silicon MLX 推理引擎)          │ │
│  │  Metal/ANE 加速 · 40+ 量化格式 · 连续批处理      │ │
│  └─────────────────────────────────────────────────┘ │
│                          │                            │
│  ┌─────────────────────────────────────────────────┐ │
│  │  Fusion 生态联动                                  │ │
│  │  ├── fusion-kb (RAG 知识库检索)                   │ │
│  │  ├── fusion-plugins-ecosystem (插件注册中心)      │ │
│  │  ├── fusion-model-hub (模型管理)                  │ │
│  │  ├── fusion-cli (统一入口)                        │ │
│  │  └── fusion-desk (桌面自动化)                     │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

---

## 三、分阶段迁移计划

### 阶段 1：AI 后端替换（P0 核心）

**目标**：将核心 AI 调用从 Anthropic SDK 切换到 fusion-mlx 本地推理

| 任务 | 文件 | 说明 |
|------|------|------|
| 1.1 创建 fusion-mlx 适配器 | `src/services/api/fusion-mlx-adapter.ts` | 实现兼容 Anthropic Message API 格式的本地适配器 |
| 1.2 替换客户端初始化 | `src/services/api/client.ts` | 检测 fusion-mlx 运行状态，优先使用本地引擎 |
| 1.3 改造查询引擎 | `src/services/api/claude.ts` | 将 queryModel/queryModelWithoutStreaming 改为本地调用 |
| 1.4 适配流式响应 | `src/services/api/fusion-mlx-stream.ts` | 处理 MLX SSE 流 → Anthropic 事件格式转换 |
| 1.5 模型配置 | `src/utils/model/model.ts` | 添加 fusion-mlx 本地模型列表和配置 |

### 阶段 2：云依赖剥离（P0 核心）

**目标**：删除所有云 API 依赖，确保全链路本地离线

| 任务 | 文件 | 说明 |
|------|------|------|
| 2.1 删除 Anthropic SDK 导入 | 全局 | 替换 `@anthropic-ai/sdk` 调用为本地适配器 |
| 2.2 删除 Bedrock 提供商 | `src/services/api/client.ts` | 删除 `@anthropic-ai/bedrock-sdk` 相关代码 |
| 2.3 删除 Vertex AI 提供商 | `src/services/api/client.ts` | 删除 `google-auth-library` 相关代码 |
| 2.4 删除 OpenAI Codex 适配器 | `src/services/api/codex-fetch-adapter.ts` | 删除或标记为遗留 |
| 2.5 删除 OAuth 流程 | `src/services/oauth/` | 替换为本地无认证模式 |
| 2.6 删除沙箱依赖 | `src/services/sandbox/` | 删除 `@anthropic-ai/sandbox-runtime` |

### 阶段 3：Fusion 生态集成（P1）

**目标**：与 Fusion 全生态深度集成

| 任务 | 文件 | 说明 |
|------|------|------|
| 3.1 知识库集成 | `src/services/kb/` | 集成 fusion-kb RAG 检索能力 |
| 3.2 插件生态 | `src/utils/plugins/` | 对接 fusion-plugins-ecosystem 注册中心 |
| 3.3 模型管理 | `src/utils/model/` | 对接 fusion-model-hub 模型下载/切换 |
| 3.4 CLI 统一入口 | `src/entrypoints/` | 支持被 fusion-cli 调用 |
| 3.5 桌面集成 | `src/bridge/` | 扩展桥接模式支持 Fusion-Desk |

### 阶段 4：全链路本地离线化（P1）

**目标**：确保所有功能在无网络环境下正常工作

| 任务 | 文件 | 说明 |
|------|------|------|
| 4.1 本地模型管理 | `src/utils/model/` | 模型下载、缓存、量化格式管理 |
| 4.2 本地文件索引 | `src/services/kb/` | 代码库本地索引和语义搜索 |
| 4.3 离线 Git 集成 | `src/commands/` | 支持 Gitee/GitLab 自托管 |
| 4.4 本地 MCP 服务器 | `src/services/mcp/` | 内置本地 MCP 服务器供生态调用 |

### 阶段 5：特性优化与增强（P2）

**目标**：充分发挥本地 MLX 优势，提供差异化能力

| 任务 | 说明 |
|------|------|
| 5.1 长上下文优化 | 利用本地推理低成本优势，突破上下文窗口限制 |
| 5.2 代码建模 | 集成 fusion-code-modelization 的代码分析能力 |
| 5.3 安全扫描 | 集成 fusion-security 的本地安全审计 |
| 5.4 多模态 | 利用 MLX 多模态能力实现图生代码 |

---

## 四、核心文件变更清单

### 新增文件

| 文件 | 用途 |
|------|------|
| `src/services/api/fusion-mlx-adapter.ts` | fusion-mlx HTTP 客户端适配器 |
| `src/services/api/fusion-mlx-stream.ts` | MLX SSE 流式响应处理 |
| `src/services/api/fusion-mlx-types.ts` | MLX API 类型定义 |
| `src/services/kb/fusion-kb-client.ts` | fusion-kb 知识库客户端 |
| `src/services/kb/rag-integration.ts` | RAG 检索集成 |
| `src/services/ecosystem/fusion-ecosystem.ts` | Fusion 生态联动总线 |
| `src/utils/model/fusion-mlx-models.ts` | MLX 本地模型配置 |
| `src/utils/plugins/fusion-plugin-adapter.ts` | Fusion 插件生态适配器 |
| `MIGRATION_STATUS.md` | 迁移进度跟踪 |

### 修改文件

| 文件 | 变更内容 |
|------|---------|
| `src/services/api/client.ts` | 添加 fusion-mlx 作为主要提供商，保留 Anthropic 作为回退 |
| `src/services/api/claude.ts` | 核心查询逻辑改为本地 MLX 调用 |
| `src/utils/model/providers.ts` | 添加 `fusion-mlx` 提供商类型 |
| `src/utils/model/model.ts` | 添加本地模型列表和默认配置 |
| `src/utils/model/modelStrings.ts` | 添加本地模型字符串 |
| `src/utils/model/modelCapabilities.ts` | 声明本地模型能力 |
| `src/entrypoints/cli.tsx` | 启动时检测 fusion-mlx 服务 |
| `src/commands/config/index.ts` | 添加本地模型配置选项 |
| `package.json` | 删除云依赖，添加本地工具依赖 |

### 删除文件

| 文件 | 原因 |
|------|------|
| `src/services/api/codex-fetch-adapter.ts` | 不再需要 OpenAI Codex 适配 |
| `src/services/oauth/` | 不再需要 OAuth 认证 |
| `src/services/analytics/` | 已剥离遥测 |
| `src/services/api/bedrock.ts` (若存在) | 不再需要 Bedrock |

---

## 五、技术决策

### 5.1 API 兼容层策略

**方案**：保持 Anthropic Messages API 格式作为内部抽象，在 adapter 层做格式转换

```
fusion-mlx HTTP API (OpenAI-compatible /v1/chat/completions)
    ↕ (adapter 格式转换)
内部 Anthropic Messages API 格式
    ↕ (保持现有代码不变)
现有工具/命令/UI 层
```

**理由**：现有代码大量依赖 Anthropic Messages 格式（消息、工具、流式事件），保持内部格式不变可最小化改造成本。

### 5.2 模型发现策略

fusion-code 启动时：
1. 检测 `localhost:11434` 上的 fusion-mlx 服务
2. 调用 `/v1/models` 获取可用模型列表
3. 根据模型能力自动选择默认模型（代码专用模型 > 通用模型）
4. 若 fusion-mlx 不可用，降级提示用户启动服务

### 5.3 特性标志简化

从 88 个特性标志简化为 Fusion 核心标志集：

| 标志 | 说明 |
|------|------|
| `FUSION_MLX` | fusion-mlx 后端集成 |
| `FUSION_KB` | 知识库集成 |
| `FUSION_PLUGINS` | 插件生态集成 |
| `FUSION_DESK` | 桌面集成 |
| `FUSION_CODE_MODELIZATION` | 代码建模集成 |
| `FUSION_SECURITY` | 安全扫描集成 |
| `VOICE_MODE` | 语音模式（保留） |
| `BRIDGE_MODE` | IDE 桥接（保留） |

---

## 六、迁移优先级

```
P0 (必须完成，MVP)
├── 阶段 1: AI 后端替换为 fusion-mlx
├── 阶段 2: 云依赖剥离
└── 验证: 基本对话、代码生成、工具调用全链路本地运行

P1 (重要，MVP 后立即跟进)
├── 阶段 3: Fusion 生态集成
└── 阶段 4: 全链路本地离线化

P2 (增强，持续迭代)
├── 阶段 5: 特性优化与增强
└── 长期维护
```

---

## 七、验证标准

| 验收项 | 标准 |
|--------|------|
| 基本对话 | 在无网络环境下启动 fusion-code，输入提示词，获得 MLX 本地推理回复 |
| 代码生成 | 要求生成代码，LLM 调用走 fusion-mlx，结果正确 |
| 工具调用 | Bash/Read/Write/Edit 等工具在本地 MLX 推理下正常工作 |
| 流式响应 | 流式输出流畅，无卡顿 |
| 模型切换 | 支持通过 /model 命令切换本地 MLX 模型 |
| 知识库集成 | 可调用 fusion-kb 进行 RAG 检索 |
| 无云依赖 | 不依赖任何外部 API 密钥或网络连接 |