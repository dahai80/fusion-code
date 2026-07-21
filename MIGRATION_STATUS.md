# Fusion-Code 迁移与演进状态报告

> 按照 OpenCode 模式（OpenPencil 集成方案）迁移 fusion-code 的实现状态。
>
> 参考：`MIGRATION_PLAN.md`、`ARCHITECTURE.md`
> 日期：2026-07-18

---

## 一、总体进度

| 阶段 | 状态 | 完成度 |
|------|------|--------|
| 阶段 1：AI 后端替换为 fusion-mlx | ✅ 已完成 | 100% |
| 阶段 2：云依赖剥离 | ✅ 已完成 | 100% |
| 阶段 3：Fusion 生态集成 | ✅ 已完成 | 100% |
| 阶段 4：全链路本地离线化 | ✅ 已完成 | 100% |
| 阶段 5：特性优化与增强 | 📋 待启动 | 0% |

---

## 二、已实现的文件

### 新增文件

| 文件 | 行数 | 用途 |
|------|------|------|
| `src/services/api/fusion-mlx-types.ts` | 276 | fusion-mlx HTTP API 类型定义 |
| `src/services/api/fusion-mlx-stream.ts` | 502 | MLX SSE 流 → Anthropic 事件格式转换 |
| `src/services/api/fusion-mlx-adapter.ts` | 614 | 核心适配器：查询/流式/Embeddings/Fetch 适配 |
| `src/services/ecosystem/fusion-ecosystem.ts` | 450 | Fusion 全生态联动总线 |
| `src/services/kb/fusion-kb-client.ts` | 214 | Fusion-KB 知识库客户端 |
| `src/services/offline/offline-mode.ts` | 236 | 离线模式检测与功能降级 |
| `src/utils/model/fusion-mlx-models.ts` | 215 | 本地 MLX 模型配置管理 |
| `MIGRATION_PLAN.md` | 292 | 迁移方案文档 |
| `MIGRATION_STATUS.md` | — | 本文件 |

### 修改文件

| 文件 | 变更内容 |
|------|---------|
| `src/utils/model/providers.ts` | 添加 `fusionMlx` 提供商类型；`getAPIProvider()` 在无云密钥时默认返回 fusion-mlx；添加 `isFusionMlxProvider()`、`isCloudFreeMode()`、`shouldAutoUseFusionMlx()` |
| `src/utils/model/configs.ts` | 添加 `FUSION_MLX_DEFAULT_CONFIG` 和 `FUSION_MLX_CODE_CONFIG` 模型配置；注册到 `ALL_MODEL_CONFIGS` |
| `src/services/api/client.ts` | 添加 `FusionMlxClient` 接口；在 `getAnthropicClient()` 中处理 fusion-mlx 提供商分支 |
| `src/entrypoints/cli.tsx` | 启动时自动检测 fusion-mlx 服务，无云密钥时自动启用 |

---

## 三、核心架构变更

### 3.1 AI 后端变更

```
迁移前:                              迁移后:
┌──────────────────────┐            ┌──────────────────────┐
│  @anthropic-ai/sdk   │            │  fusion-mlx-adapter  │
│  (云 API)            │     →      │  (本地 HTTP API)     │
│                      │            │                      │
│  claude.ts           │            │  /v1/chat/completions│
│  codex-fetch-adapter │            │  /v1/embeddings      │
│  bedrock-sdk         │            │  /v1/models          │
│  vertex-sdk          │            └──────────┬───────────┘
│  foundry-sdk         │                       │
└──────────────────────┘                       ▼
                                        fusion-mlx
                                   (Apple Silicon MLX)
```

### 3.2 提供商选择逻辑

```
getAPIProvider()
  ├── FUSION_MLX_DISABLED=1 → 回退到 firstParty/bedrock/vertex/foundry/openai
  ├── FUSION_MLX_ENABLED=1  → fusionMlx
  ├── CLAUDE_CODE_USE_BEDROCK → bedrock
  ├── CLAUDE_CODE_USE_VERTEX → vertex
  ├── CLAUDE_CODE_USE_FOUNDRY → foundry
  ├── CLAUDE_CODE_USE_OPENAI → openai
  ├── 无 ANTHROPIC_API_KEY  → fusionMlx (默认)
  └── 有 ANTHROPIC_API_KEY  → firstParty
```

### 3.3 生态集成架构

```
fusion-code CLI
  ├── fusion-mlx (本地 AI 推理引擎)
  ├── fusion-kb (知识库 RAG 检索)
  ├── fusion-plugins-ecosystem (插件注册中心)
  ├── fusion-model-hub (模型管理)
  ├── fusion-code-modelization (代码建模)
  ├── fusion-security (安全扫描)
  └── fusion-cli (统一入口)
```

### 3.4 离线模式检测

```
启动时检测:
  ├── 网络连通性检查 (3s timeout)
  ├── 本地服务检测 (fusion-mlx / fusion-kb / ...)
  ├── 模式选择: full / partial / none
  └── 能力矩阵: inference / KB / plugins / models / ...
```

---

## 四、环境变量参考

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FUSION_MLX_ENABLED` | — | 强制启用 fusion-mlx 提供商 |
| `FUSION_MLX_DISABLED` | — | 禁用 fusion-mlx，回退到云 API |
| `FUSION_MLX_AUTO` | — | 自动模式：无云密钥时使用 MLX |
| `FUSION_MLX_BASE_URL` | `http://127.0.0.1:11434` | fusion-mlx 服务地址 |
| `FUSION_MLX_MODEL` | 自动选择 | 使用的本地模型 ID |
| `FUSION_MLX_TIMEOUT_MS` | 120000 | 推理超时时间 |
| `FUSION_MLX_MODEL_STRATEGY` | `code` | 模型选择策略 (auto/code/fast/manual) |
| `FUSION_OFFLINE_MODE` | — | 强制离线模式 |
| `FUSION_ECOSYSTEM_ENABLED` | 1 | 启用 Fusion 生态集成 |
| `FUSION_ECOSYSTEM_DISABLED` | — | 禁用 Fusion 生态集成 |
| `FUSION_KB_BASE_URL` | `http://127.0.0.1:11435` | 知识库服务地址 |
| `FUSION_PLUGINS_BASE_URL` | `http://127.0.0.1:11436` | 插件服务地址 |
| `FUSION_MODEL_HUB_BASE_URL` | `http://127.0.0.1:11437` | 模型管理服务地址 |

---

## 五、后续工作（阶段 5）

| 任务 | 优先级 | 说明 |
|------|--------|------|
| 长上下文优化 | P2 | 利用本地推理低成本优势，突破上下文窗口限制 |
| 代码建模集成 | P2 | 在 fusion-code 中直接调用 fusion-code-modelization |
| 安全扫描集成 | P2 | 在 /review 命令中集成 fusion-security |
| 多模态支持 | P2 | 利用 MLX 多模态能力实现图生代码 |
| 性能优化 | P2 | 本地推理延迟优化、缓存策略 |
| 测试覆盖 | P2 | 为 fusion-mlx 适配器添加单元测试和集成测试 |