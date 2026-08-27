# fusion-code 开发者使用指南 — 场景化快速上手与配置排障

面向**使用** fusion-code 的开发者（非构建 fusion-code 本身）。覆盖两类高频需求：
1. **场景化快速上手** — "我想做 X，该设哪些配置、跑哪些命令"
2. **遇到问题快速改配置解决** — "出现 Y 症状，先查什么、改哪个配置"

构建内部（feature flag 机制、env 映射表、代码风格）见 [`development.md`](./development.md)；
6 个 provider 完整选择逻辑 + 各 provider env 示例见 [`model-providers.md`](./model-providers.md)；
安装与功能总览见 [`README_CN.md`](../README_CN.md)。本文不重复，只补场景与排障。

## 前置：30 秒判断该用哪个 provider

```
有云 API key 吗？
├─ 没有  ─→ fusionMlx（本地，零配置，需 fusion-mlx 跑在 11432）
├─ 有，想本地 ─→ FUSION_MLX_ENABLED=1 → fusionMlx
└─ 有，想云端 ─→
       ├─ FUSION_CODE_USE_OPENAI=1  → openai
       ├─ FUSION_CODE_USE_FOUNDRY=1 → foundry
       ├─ FUSION_CODE_USE_BEDROCK=1 → bedrock（当前 fork 禁用）
       ├─ FUSION_CODE_USE_VERTEX=1  → vertex（当前 fork 禁用）
       └─ 否则                      → firstParty（Anthropic）
```

- `FUSION_MLX_DISABLED=1` = 总开关，强制跳过本地走云端。
- 本地 fusion-mlx 服务不在 11432 → fusion-code 启动检测不到 → 自动落云端（有 key）或报错。
- 完整优先级链见 [`model-providers.md`](./model-providers.md#getapiprovider-选择逻辑)。

## 场景化快速上手

### 场景 1：纯本地零配置（最常见）

目标：不花钱、不配 key、本机推理。

```bash
# 1. 起本地推理服务（fusion-mlx）
~/claude-home/fusion-mlx/start.sh start   # 监听 127.0.0.1:11434

# 2. 进项目目录
cd /Users/dahai/fusion/fusion-code

# 3. 直接跑（自动检测 11432 端口 → fusionMlx）
./fusion-code
```

注意：fusion-code 默认检测 **11432** 端口（`shouldAutoUseFusionMlx()`）。若 fusion-mlx 起在 11434，需用 `FUSION_GATEWAY_URL=127.0.0.1:11434` 指向。无任何 env 即零配置。

### 场景 2：本地 + 指定模型

目标：换更强的本地模型。

```bash
# 指定模型 ID（需已下载到 ~/.fusion-mlx/models）
FUSION_MLX_MODEL=qwen2.5-coder-32b ./fusion-code

# 或启动后用 /model 命令热切换（不改 env，仅本会话）
# REPL 内输入: /model
```

注意：模型需先通过镜像站 https://hf-mirror.com 下载。模型规模影响可用工具集（≤3B 仅 5 core tools，7-9B 10 tools，其余全套，见 model-providers.md "MLX 模型能力分层"）。小模型可能不支持 vision。

### 场景 3：切到云端 Anthropic

目标：用 Claude 官方 API，模型更强。

```bash
# 设 key（持久化建议写进 ~/.zshrc）
export FUSION_API_KEY=sk-ant-xxx

# 强制云端（即使本地 mlx 在跑）
FUSION_MLX_DISABLED=1 ./fusion-code

# 指定模型
FUSION_MODEL=claude-sonnet-4-20250514 ./fusion-code
```

注意：`FUSION_API_KEY` 优先于 `ANTHROPIC_API_KEY`。设了 key 但不设 `FUSION_MLX_DISABLED=1` 且本地 11432 在跑 → 仍走本地（有 key 不自动切云端，需显式禁用本地或关掉服务）。`FUSION_MLX_ENABLED=1` 会反向锁定本地。

### 场景 4：第三方代理（LiteLLM / OpenAI 兼容）

目标：走自建/第三方代理，非 Anthropic 官方。

```bash
# 仅设 ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL（接缝层补了 SDK 旧回退读取）
ANTHROPIC_API_KEY=sk-adco-xxx \
ANTHROPIC_BASE_URL=http://litellm.proxy:4000 \
FUSION_MLX_DISABLED=1 \
./fusion-code --model glm5.2 -p "hi"
```

注意：`FUSION_BASE_URL` 优先级**高于** `ANTHROPIC_BASE_URL`。若 `FUSION_BASE_URL` 残留 `http://127.0.0.1` 会覆盖代理 URL → 连接失败。代理场景**用 `ANTHROPIC_BASE_URL`**，清空 `FUSION_BASE_URL`。

### 场景 5：用 OpenAI provider

目标：用 OpenAI 官方。

```bash
FUSION_CODE_USE_OPENAI=1 \
OPENAI_API_KEY=sk-xxx \
FUSION_MLX_DISABLED=1 \
./fusion-code
```

注意：`FUSION_CODE_USE_OPENAI=1` 仅声明 provider，仍需 `FUSION_MLX_DISABLED=1` 防被本地优先级截胡。bedrock/vertex/foundry 当前 fork 已禁用（源码 `if (false)`），需恢复源码分支才能用——优先走 fusion-gateway 签名。

### 场景 6：开启实验功能

目标：试未默认开启的功能（executor / session-skills / capability-manifest 等）。

```bash
# 方法 A：dev 构建 + 全部实验 flag（dev-full，28 个）
bun run build:dev:full   # 产物 ./fusion-code-dev
./fusion-code-dev

# 方法 B：dev 构建 + 指定 flag
bun run ./scripts/build.ts --dev --feature=SESSION_SKILLS --feature=CAPABILITY_MANIFEST
./fusion-code-dev

# 方法 C：标准构建 + 指定 flag
bun run ./scripts/build.ts --feature=ULTRAPLAN
./fusion-code
```

注意：`bun run build`（标准）只开 `VOICE_MODE`。`--feature` 可重复，`--feature-set=dev-full` 加全列表可叠加。88 个 flag 详见 [`feature-flags.md`](./feature-flags.md)。feature flag 是**编译期** DCE，禁用的 flag 不进产物——必须重新 build 才能开。

### 场景 7：executor（Layer B 外置执行）

目标：把 bash 命令路由到 fusion-executor 外置进程（诊断切片 + git 回滚）。

```bash
# 1. 确认 executor 已装
source /Users/dahai/fusion/.venv/bin/activate
which fusion-executor   # 应有路径

# 2. 开启（default off）
FUSION_CODE_EXECUTOR_ENABLED=1 ./fusion-code-dev

# 3.（可选）开自动回滚——破坏 edit-test-fail 循环，谨慎
FUSION_CODE_EXECUTOR_ENABLED=1 FUSION_CODE_EXECUTOR_AUTO_ROLLBACK=1 ./fusion-code-dev
```

注意：executor 缺失 / crash → fail-open 落回进程内 `runShellCommand`，零差异。`FUSION_CODE_EXECUTOR_AUTO_ROLLBACK` **独立 env gate，default off**——auto-rollback 在命令失败 + 文件毁损时会回滚，可能撤销你的合法编辑。非 git repo 自动 no-op。背景命令不走 executor。

### 场景 8：会话技能 / 能力清单（双门禁实验功能）

目标：用 P5.4 会话技能或 P5.5 能力导出。两者都是**双门禁**（build feature flag + 运行时 env）。

```bash
# 1. build 时带 feature flag（dev-full 已含）
bun run ./scripts/build.ts --dev --feature=SESSION_SKILLS --feature=CAPABILITY_MANIFEST

# 2. 运行时再开 env（strict，仅 "1" 生效）
FUSION_CODE_SESSION_SKILLS_ENABLED=1 ./fusion-code-dev
FUSION_CODE_CAPABILITY_MANIFEST_ENABLED=1 ./fusion-code-dev capability export
```

注意：双门禁 = build flag **和** env 都要开，缺一即 byte-identical off。env 仅认 `"1"`（`"true"`/`"0"` 都算关）。`capability export` 是 fast-path 子命令（不走 REPL），输出 JSON 到 stdout，可 `> manifest.json` 重定向。

### 场景 9：/model 热切换本地模型

目标：会话中途换模型，不重启。

```
# REPL 内直接输入
/model
```

注意：MLX 模式下 `/model` 走本地 fast path（`prefetchLocalModelOptions` 预取，不需 API 调用）。模型解析优先级：`/model` > `--model` flag > `FUSION_MODEL`/`FUSION_MLX_MODEL` env > saved settings。热切换后能力缓存自动清（`clearMlxCapabilitiesCache()`），新模型能力重新探测。

## 遇到问题：症状 → 配置排查矩阵

| 症状 | 先查 | 改哪个配置 | 参考 |
|------|------|-----------|------|
| 启动报"无法连接 API" | `lsof -i :11432` 看本地 mlx 是否在跑 | 无 key 且 11432 没服务 → 起 `~/claude-home/fusion-mlx/start.sh start`；或设 `FUSION_API_KEY` 走云端 | 场景 1/3 |
| 明明设了 key 却走了本地 | env 里有没有 `FUSION_MLX_ENABLED=1` 或 11432 在跑 | 加 `FUSION_MLX_DISABLED=1` 强制云端 | 场景 3 |
| 想本地却走了云端 | `echo $FUSION_API_KEY` 是否残留 | 清 key，或 `FUSION_MLX_ENABLED=1` 锁本地 | 场景 1/2 |
| 第三方代理连接失败 | `echo $FUSION_BASE_URL` 是否残留 127.0.0.1 | `FUSION_BASE_URL` 优先级更高 → 清空它，改用 `ANTHROPIC_BASE_URL` | 场景 4 |
| `/model` 看不到本地模型 | `curl http://127.0.0.1:11432/v1/models` 返回什么 | 11432 服务没起 / 端口被占 → 重启 fusion-mlx | 场景 9 |
| 小模型不调工具 | 模型规模 ≤3B? | 小模型仅 5 core tools，换 ≥7B 模型 | 场景 2 |
| 压缩太频繁 / 上下文不够 | 是否 MLX provider? | MLX auto-compact 阈值 60%（比云端 93% 早），换大模型或切云端 | model-providers.md |
| executor 不生效 | build 是否带 `--feature`? env 设了没? | 双门禁：build flag + `FUSION_CODE_EXECUTOR_ENABLED=1` 都要 | 场景 7 |
| 实验功能命令报 "not enabled" | build 带 flag 了，env 没设? | env 仅认 `"1"`（`"true"` 不算） | 场景 6/8 |
| build 后行为没变 | 改了源码但跑的是旧产物? | `./fusion-code` 是编译产物，改源码要重 `bun run build` | development.md |
| 报 OOM / 模型加载失败 | 模型大小 vs 内存 | 换小模型，或 `~/claude-home/fusion-mlx/start.sh status` 看内存 | 场景 2 |

## 常见配置误区

1. **设了 key 就以为走云端** — 错。有 key + 本地 11432 在跑 → 仍走本地。要么 `FUSION_MLX_DISABLED=1`，要么关掉 mlx 服务。

2. **`FUSION_BASE_URL` 和 `ANTHROPIC_BASE_URL` 都设** — `FUSION_BASE_URL` 赢。代理场景设了 `FUSION_BASE_URL=http://127.0.0.1` 残留，会覆盖代理地址 → 连不上。代理场景只用 `ANTHROPIC_BASE_URL`。

3. **改源码后直接跑 `./fusion-code`** — `./fusion-code` 是编译产物。源码改动要 `bun run build`（或 `bun run dev` 从源码直接跑，不打包）。

4. **开了 env 但没开 build flag**（双门禁功能）— executor / session-skills / capability-manifest 等需 build feature flag **且** 运行时 env。只开 env → byte-identical off，命令不存在或 "not enabled"。

5. **env 设成 `"true"` 期望开启** — 多数 gate 是 strict `"1"`。`"true"`/`"yes"`/`"on"` 对 capability-manifest 等算关。用 `=1`。

6. **小模型期望全套工具** — ≤3B 仅 Bash/Read/Write/Edit/Glob 5 个。要 Grep 等需 ≥7B。这不是 bug，是按模型能力裁剪。

## 调试日志速查

```bash
# 通用：开 SDK 级日志
FUSION_LOG=debug ./fusion-code

# 查 provider 选了哪个
FUSION_LOG=debug ./fusion-code 2>&1 | grep -i provider

# 查 MLX 健康探测
curl http://127.0.0.1:11432/v1/models
~/claude-home/fusion-mlx/start.sh status
~/claude-home/fusion-mlx/start.sh doctor

# 查端口占用
lsof -i :11432

# 构建失败：scripts/build.ts 原样输出 bun build stderr，看退出码与模块数
bun run build 2>&1 | tail -20

# 运行时异常：看日志文件
ls ~/.fusion-code/
```

MLX 请求/响应细节、压缩触发记录在 `src/services/api/fusion-mlx-adapter.ts` 与 `src/services/compact/*.ts` 关键路径，开 `FUSION_LOG=debug` 可见。日志文件落 `~/.fusion-code/`。

## 相关文档

- [`development.md`](./development.md) — 构建命令、feature flag 机制、env 映射表、代码风格（改 fusion-code 本身）
- [`model-providers.md`](./model-providers.md) — 6 provider 完整选择逻辑、自动检测、模型解析优先级、各 provider env 示例、LLM 接缝
- [`feature-flags.md`](./feature-flags.md) — 88 个 feature flag 详表
- [`trajectory-pipeline.md`](./trajectory-pipeline.md) — 会话→训练数据飞轮
- [`README_CN.md`](../README_CN.md) — 安装、功能总览、云端配置详情
- [`architecture.md`](./architecture.md) — 高层架构、核心子系统
