# fusion-code 开发指南

本文覆盖环境准备、构建命令、feature flag 机制、本地 MLX 调试与代码风格约定。

## 环境准备

```bash
# 进入项目目录
cd /Users/dahai/fusion/fusion-code

# 安装依赖（需要 bun >= 1.3.11）
bun install
```

`package.json` 中 `engines.bun` 要求 `>=1.3.11`，`packageManager` 锁定 `bun@1.3.11`。

## 构建命令

| 命令 | 产物 | 说明 |
|------|------|------|
| `bun run build` | `./fusion-code` | 标准构建，仅 `VOICE_MODE` 启用 |
| `bun run build:dev` | `./fusion-code-dev` | dev 构建，版本号带时间戳+sha，仅 `VOICE_MODE` |
| `bun run build:dev:full` | `./fusion-code-dev` | dev 构建 + 全部 23 个实验 feature（dev-full） |
| `bun run compile` | `./dist/fusion-code` | 编译产物到 dist 目录 |
| `bun run dev` | - | 直接从源码运行 `src/entrypoints/cli.tsx`，不打包 |

### 自定义 feature 组合

```bash
# 单个 flag
bun run ./scripts/build.ts --feature=ULTRAPLAN --feature=ULTRATHINK

# dev 构建 + 单个 flag
bun run ./scripts/build.ts --dev --feature=BRIDGE_MODE

# dev 构建 + 全部实验 flag
bun run ./scripts/build.ts --dev --feature-set=dev-full

# 编译产物
bun run ./scripts/build.ts --compile
```

`--feature` 可重复传入，`--feature-set=dev-full` 会加入 `fullExperimentalFeatures` 列表的全部 23 个 flag，可与 `--feature` 叠加。

### 运行产物

```bash
./fusion-code        # 标准构建
./fusion-code-dev    # dev 构建
```

云端 provider 需设置 `FUSION_API_KEY` 或 `ANTHROPIC_API_KEY`；本地 MLX 通过 `fusion service start mlx` 启动（端口 11432 自动检测）。

仓库未配置 test framework 或 linter。

## Feature Flag 机制

详细 flag 列表与 34 broken flags 修复记录见 feature-flags.md。

核心机制：

1. `scripts/build.ts` 收集 `--feature=X` 与 `--feature-set` 参数，生成 `features` 数组
2. 每个 feature 以 `--feature=X` 形式传给 `bun build`
3. Bundler 将源码中的 `feature('X')` 调用替换为 `true`（启用）或 `false`（未启用）
4. `false` 分支触发死代码消除（DCE），不进入产物

默认启用：`VOICE_MODE`（在 `defaultFeatures` 中）。

## FUSION_* env 映射表

`src/entrypoints/cli.tsx` 启动时执行映射，规则为仅当 `ANTHROPIC_*` 未设置时用 `FUSION_*` 回填：

| Fusion env | Anthropic equivalent | 用途 |
|---|---|---|
| `FUSION_API_KEY` | `ANTHROPIC_API_KEY` | 云端 API key |
| `FUSION_BASE_URL` | `ANTHROPIC_BASE_URL` | API base URL |
| `FUSION_AUTH_TOKEN` | `ANTHROPIC_AUTH_TOKEN` | auth token |
| `FUSION_MODEL` | `ANTHROPIC_MODEL` | 默认模型 |
| `FUSION_BETAS` | `ANTHROPIC_BETAS` | beta header |
| `FUSION_LOG` | `ANTHROPIC_LOG` | SDK 日志级别 |

另外 `FUSION_CODE_CONFIG_DIR` 固定为 `~/.fusion-code`。

provider 选择相关 env：

| Env | 作用 |
|-----|------|
| `FUSION_MLX_ENABLED=1` | 强制使用本地 MLX |
| `FUSION_MLX_DISABLED=1` | 强制跳过本地 MLX，走云端 |
| `FUSION_CODE_USE_OPENAI=1` | 使用 OpenAI provider |
| `FUSION_CODE_USE_FOUNDRY=1` | 使用 Azure Foundry provider |
| `FUSION_CODE_USE_BEDROCK=1` | 使用 AWS Bedrock provider |
| `FUSION_CODE_USE_VERTEX=1` | 使用 GCP Vertex provider |
| `FUSION_MLX_MODEL` | 本地 MLX 模型 ID |

## 本地 MLX 调试

### 启动 fusion-mlx 服务

```bash
fusion service start mlx
```

服务监听 `127.0.0.1:11432`。

### 检查端口占用

```bash
lsof -i :11432
# 或
curl http://127.0.0.1:11432/v1/models
```

若端口被占用，先重启 fusion-mlx 服务。fusion-code 启动时通过 `shouldAutoUseFusionMlx()` 检测 11432 端口，可用即自动切换本地推理。

### 下载模型

通过镜像站 https://hf-mirror.com 下载，避免直连 huggingface.co 网络问题。

涉及大模型测试时，须真实加载模型，检查 11432 端口是否占用，重启 fusion-mlx 使用 11432 端口。

### 本地模型能力检测

fusion-code 启动后会：

1. `checkFusionMlxHealth` 检查服务健康
2. `getFusionMlxModels` 拉取可用模型列表
3. `getMlxModelCapabilities(modelId)` 检测 tool calling / vision / streaming 能力
4. 从 API 获取 per-model `max_input_tokens`（不再硬编码）
5. `/model` 命令展示本地可用模型

能力检测结果会缓存，模型热切换时调用 `clearMlxCapabilitiesCache()`。

## 调试日志

- `FUSION_LOG=debug ./fusion-code` 开启 SDK 级日志
- MLX 适配器关键路径在 `src/services/api/fusion-mlx-adapter.ts` / `fusion-mlx-stream.ts` 默认有日志
- 压缩流程在 `src/services/compact/*.ts` 关键路径有日志
- 构建调试：观察 `bun build` 输出的模块数与退出码，`exit 0` + 模块数正常即编译通过

## 代码风格

- 4 空格缩进（禁止 5/9/11 等非 4 倍数缩进）
- 不生成 docstring
- 默认带日志，便于问题定位
- 直接输出干净代码，不包裹多余格式
- 修改前先读相邻文件，理解既有 pattern，match 现有风格
- 只改必须改的部分，不顺带重构相邻代码

## 调试日志

- 构建失败时，`scripts/build.ts` 会原样输出 `bun build` 的 stderr
- 运行时异常，优先看 `~/.fusion-code/` 下的日志文件
- MLX 请求/响应细节，开启 `FUSION_LOG=debug` 后可在终端看到 SDK 级别输出
- 压缩触发与结果，`services/compact/*.ts` 中每个入口均有 console 日志
