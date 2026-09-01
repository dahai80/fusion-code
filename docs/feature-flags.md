# fusion-code Feature Flags

本文说明 fusion-code 两类 feature flag 的总览、DCE 机制、dev-full 列表与验证方法。
审计 §3.2 (2026-08) 指出文档与源码背离, 本文件于 2026-08-28 按源码实际重新核对。

## 两类 flag (不同机制, 不可混用)

fusion-code 有**两套**语义重叠但机制不同的 flag:

| 维度 | build-time `feature('X')` | runtime env-gate `isEnvTruthy(process.env.FUSION_CODE_*)` |
|------|---------------------------|----------------------------------------------------------|
| 机制 | Bun bundler 编译时宏, 死代码消除 | 进程启动读 env, 运行时条件分支 |
| 文件 | `import { feature } from 'bun:bundle'` | `isEnvTruthy(process.env.X)` (envUtils.ts) |
| 数量 | **89** distinct flag / **904** call site | **88** distinct flag / **177** call site |
| 默认 | 仅 `VOICE_MODE` 进产物, 其余 DCE 移除 | unset = off, byte-identical |
| 改变需 | 重新 `bun run build` | 重启进程, 无需重编译 |

**混用风险 (审计 3.2.2):** `feature()` 要求**字符串字面量**参数才能 DCE (PR #9 build bug: 运行时变量 cast 破坏 build:dev)。env-gate 用 `isEnvTruthy(process.env.X)` (运行时)。二者语义重叠但机制不同 — 该 DCE 的没消除 (包体膨胀), 该运行时的被 build 消除 (行为错)。新 flag 先确定归属: 进产物与否决定用 build-time 还是 runtime。

### DCE 机制 (build-time)

1. `scripts/build.ts` 收集 `--feature=NAME` 参数, 生成 `features` 数组
2. 每个 feature 以 `--define` 传给 `bun build --compile`
3. 源码 `import { feature } from 'bun:bundle'`, 调用 `feature('FLAG')` (单/双引号均可)
4. 启用: `feature('FLAG')` -> `true`, 代码进入 bundle
5. 未启用: `feature('FLAG')` -> `false`, Bundler DCE 移除该分支

未启用的 feature 代码完全不进入产物, 零运行时开销。

### 默认启用

`scripts/build.ts` `defaultFeatures = ['VOICE_MODE']`, 所有构建变体含 `VOICE_MODE`。

## dev-full: 89 Flags

`scripts/build.ts` `fullExperimentalFeatures` 列出全部 89 个 build-time flag, `--feature-set=dev-full` 一次性全部启用, 使所有 DCE-eligible 实验路径进入二进制编译。该列表与 `src/` 实际 `feature('X')` 调用**逐一核对一致**并由 `bun run lint:flags` (`scripts/check-feature-flags.ts`) 强制 — 0 dead entry, 0 active miss (audit P1-4 R10; 2026-09-01 复核: 删 BRIDGE_MODE/BUILDING_CLAUDE_APPS 死条目, 补 TELEMETRY 活动漏项; P1-7 删 DAEMON stub 子系统)。

```
ABLATION_BASELINE
AGENT_MEMORY_SNAPSHOT
AGENT_TRIGGERS
AGENT_TRIGGERS_REMOTE
ALLOW_TEST_VERSIONS
ANTI_DISTILLATION_CC
AUTO_THEME
AWAY_SUMMARY
BASH_CLASSIFIER
BG_SESSIONS
BREAK_CACHE_COMMAND
BUDDY
BUILTIN_EXPLORE_PLAN_AGENTS
BYOC_ENVIRONMENT_RUNNER
CACHED_MICROCOMPACT
CAPABILITY_MANIFEST
CCR_AUTO_CONNECT
CCR_MIRROR
CHICAGO_MCP
COMMIT_ATTRIBUTION
COMPACTION_REMINDERS
CONNECTOR_TEXT
CONTEXT_COLLAPSE
COORDINATOR_MODE
COWORKER_TYPE_TELEMETRY
DIRECT_CONNECT
DOWNLOAD_USER_SETTINGS
DUMP_CONFIG
DUMP_SYSTEM_PROMPT
EXPERIMENTAL_SKILL_SEARCH
EXTRACT_MEMORIES
FILE_PERSISTENCE
FORK_SUBAGENT
HARD_FAIL
HISTORY_PICKER
HISTORY_SNIP
HOOK_PROMPTS
IS_LIBC_GLIBC
IS_LIBC_MUSL
KAIROS
KAIROS_BRIEF
KAIROS_CHANNELS
KAIROS_DREAM
KAIROS_GITHUB_WEBHOOKS
KAIROS_PUSH_NOTIFICATION
LLM_ADAPTER_SEAM
LODESTONE
MCP_RICH_OUTPUT
MCP_SKILLS
MEMORY_SHAPE_TELEMETRY
MESSAGE_ACTIONS
MONITOR_TOOL
NATIVE_CLIPBOARD_IMAGE
NEW_INIT
OVERFLOW_TEST_TOOL
PERFETTO_TRACING
POWERSHELL_AUTO_MODE
PROACTIVE
PROMPT_CACHE_BREAK_DETECTION
QUICK_SEARCH
REACTIVE_COMPACT
REVIEW_ARTIFACT
RUN_SKILL_GENERATOR
SELF_HOSTED_RUNNER
SESSION_SKILLS
SHOT_STATS
SKILL_IMPROVEMENT
SKIP_DETECTION_WHEN_AUTOUPDATES_DISABLED
SLOW_OPERATION_LOGGING
SSH_REMOTE
STREAMLINED_OUTPUT
TEAMMEM
TEMPLATES
TELEMETRY
TERMINAL_PANEL
TOKEN_BUDGET
TORCH
TRANSCRIPT_CLASSIFIER
TREE_SITTER_BASH
TREE_SITTER_BASH_SHADOW
UDS_INBOX
ULTRAPLAN
ULTRATHINK
UNATTENDED_RETRY
UPLOAD_USER_SETTINGS
VERIFICATION_AGENT
VOICE_MODE
WEB_BROWSER_TOOL
WORKFLOW_SCRIPTS
```

`CHICAGO_MCP` 虽编译通过, 但运行时 reaches `@ant/computer-use-*`, dev-full 已可编译, 实际运行需该外部化包。

## runtime env-gate: 88 Flags

`isEnvTruthy(process.env.FUSION_CODE_*)` 读取的运行时 flag, 进程启动决定, 不需重编译。默认 unset = off, 路径 byte-identical 与关时一致。命名空间统一 `FUSION_CODE_` 前缀 (审计 3.2.4 指出 env 混用 `FUSION_CODE_*`/`FUSION_*`/`CLAUDE_CODE_*` 三前缀, 见 `src/entrypoints/cli.tsx` 映射表 — `FUSION_*` 映射到 `ANTHROPIC_*` 供 SDK 兼容, `CLAUDE_CODE_*` 为上游兼容遗留)。

```
FUSION_CODE_ACTION
FUSION_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD
FUSION_CODE_AGENT_LIST_IN_MESSAGES
FUSION_CODE_ALWAYS_ENABLE_EFFORT
FUSION_CODE_ASSISTANT_MODE
FUSION_CODE_ASSISTANT_TEAM_MODE
FUSION_CODE_ASSISTANT_VIEWER_MODE
FUSION_CODE_BRIEF
FUSION_CODE_BRIEF_UPLOAD
FUSION_CODE_BUBBLEWRAP
FUSION_CODE_COORDINATOR_MODE
FUSION_CODE_DEBUG_MLX_FETCH
FUSION_CODE_DEBUG_REPAINTS
FUSION_CODE_DISABLE_1M_CONTEXT
FUSION_CODE_DISABLE_ADAPTIVE_THINKING
FUSION_CODE_DISABLE_ADVISOR_TOOL
FUSION_CODE_DISABLE_ATTACHMENTS
FUSION_CODE_DISABLE_AUTO_MEMORY
FUSION_CODE_DISABLE_BACKGROUND_TASKS
FUSION_CODE_DISABLE_CLAUDE_MDS
FUSION_CODE_DISABLE_EXPERIMENTAL_BETAS
FUSION_CODE_DISABLE_FAST_MODE
FUSION_CODE_DISABLE_FILE_CHECKPOINTING
FUSION_CODE_DISABLE_LEGACY_MODEL_REMAP
FUSION_CODE_DISABLE_MOUSE
FUSION_CODE_DISABLE_MOUSE_CLICKS
FUSION_CODE_DISABLE_POLICY_SKILLS
FUSION_CODE_DISABLE_PRECOMPACT_SKIP
FUSION_CODE_DISABLE_TERMINAL_TITLE
FUSION_CODE_DISABLE_THINKING
FUSION_CODE_DUMP_AUTO_MODE
FUSION_CODE_EAGER_FLUSH
FUSION_CODE_EMIT_SESSION_STATE_EVENTS
FUSION_CODE_ENABLE_CFC
FUSION_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING
FUSION_CODE_ENABLE_SDK_FILE_CHECKPOINTING
FUSION_CODE_ENABLE_TASKS
FUSION_CODE_ENABLE_TOKEN_USAGE_ATTACHMENT
FUSION_CODE_ENABLE_XAA
FUSION_CODE_ESC_KILLS_BACKGROUND
FUSION_CODE_EVENT_SOURCING
FUSION_CODE_EXECUTOR_ENABLED
FUSION_CODE_EXECUTOR_TURN_SNAPSHOT
FUSION_CODE_EXIT_AFTER_FIRST_RENDER
FUSION_CODE_EXPERIMENTAL_BUILD
FUSION_CODE_IDE_SKIP_AUTO_INSTALL
FUSION_CODE_IDE_SKIP_VALID_CHECK
FUSION_CODE_IS_COWORK
FUSION_CODE_KAIROS_ENABLED
FUSION_CODE_MCP_INSTR_DELTA
FUSION_CODE_NEW_INIT
FUSION_CODE_NO_AUTH
FUSION_CODE_NO_FLICKER
FUSION_CODE_PLAN_MODE_REQUIRED
FUSION_CODE_PLUGIN_SHA256_STRICT
FUSION_CODE_PLUGIN_USE_ZIP_CACHE
FUSION_CODE_POST_FOR_SESSION_INGRESS_V2
FUSION_CODE_PROACTIVE
FUSION_CODE_PROFILE_ENABLED
FUSION_CODE_PROFILE_QUERY
FUSION_CODE_PROFILE_STARTUP
FUSION_CODE_PROVIDER_MANAGED_BY_HOST
FUSION_CODE_PROXY_RESOLVES_HOSTS
FUSION_CODE_REMOTE
FUSION_CODE_REMOTE_SEND_KEEPALIVES
FUSION_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT
FUSION_CODE_SIMPLE
FUSION_CODE_SKIP_FAST_MODE_NETWORK_ERRORS
FUSION_CODE_SKIP_PROMPT_HISTORY
FUSION_CODE_STREAMLINED_OUTPUT
FUSION_CODE_STREAM_RESUME_ENABLED
FUSION_CODE_SUBPROCESS_ENV_PASSTHROUGH
FUSION_CODE_SUBPROCESS_ENV_SCRUB
FUSION_CODE_SYNC_PLUGIN_INSTALL
FUSION_CODE_TASK_REAPER_ENABLED
FUSION_CODE_TERMINAL_RECORDING
FUSION_CODE_TRUSTED_PROXY
FUSION_CODE_UNATTENDED_RETRY
FUSION_CODE_UNDERCOVER
FUSION_CODE_USE_BEDROCK
FUSION_CODE_USE_CCR_V2
FUSION_CODE_USE_COWORK_PLUGINS
FUSION_CODE_USE_FOUNDRY
FUSION_CODE_USE_NATIVE_FILE_SEARCH
FUSION_CODE_USE_OPENAI
FUSION_CODE_USE_POWERSHELL_TOOL
FUSION_CODE_USE_VERTEX
FUSION_CODE_VERIFY_PLAN
```

## 运行时 caveat

"bundle cleanly" 不等于 "runtime-safe"。部分 flag 运行时依赖:

- 可选原生模块 (`image-processor-napi` / `audio-capture-napi` 等)
- claude.ai OAuth
- GrowthBook gate
- 外部化的 `@ant/*` 包

典型:

- `VOICE_MODE`: 需 claude.ai OAuth + 录音后端 (原生模块或 SoX fallback)
- `NATIVE_CLIPBOARD_IMAGE`: 需 `image-processor-napi` 才加速
- `CCR_*`: 运行时受 OAuth + GrowthBook 控制 (`BRIDGE_MODE` 已随 P0-5 移除, 见 build.ts 注释)
- `CHICAGO_MCP`: 编译通过但运行时 reaches `@ant/computer-use-*`
- `TEAMMEM`: 需 team-memory 配置实际启用才有用

## 如何启用 Flag

### build-time 单个 flag

```bash
bun run ./scripts/build.ts --feature=ULTRAPLAN
```

### build-time 多个 flag

```bash
bun run ./scripts/build.ts --feature=ULTRAPLAN --feature=ULTRATHINK
```

### build-time 全部 89 实验 flag (dev-full)

```bash
bun run ./scripts/build.ts --dev --feature-set=dev-full
```

### dev-full + 额外 flag

`--feature-set=dev-full` 已含全部 89 个 `fullExperimentalFeatures`, 故额外 `--feature=` 仅对**列表外**的 flag 有效 (理论上不应有, 因列表与源码一致; 若源码新增 flag 需同步列表, 见末节核对)。

### runtime env-gate

运行时 flag 无需重编译, 进程启动前设 env 即可:

```bash
FUSION_CODE_STREAM_RESUME_ENABLED=1 ./fusion-code-dev
```

多个叠加:

```bash
FUSION_CODE_EXECUTOR_ENABLED=1 FUSION_CODE_PROFILE_ENABLED=1 ./fusion-code-dev
```

默认 unset = off, 路径 byte-identical。

## 验证 Flag

### 1. build-time: 构建并观察退出码

```bash
bun run ./scripts/build.ts --dev --feature=XXX
echo $?  # 0 表示成功
```

成功输出 `Built ./fusion-code-dev` 并打印模块数。

### 2. build-time: strings 确认 flag-gated 代码进入二进制

```bash
bun run ./scripts/build.ts --dev --feature=ULTRAPLAN
strings ./fusion-code-dev | grep -i ultraplan | head
```

`feature('ULTRAPLAN')` 为 `true` 时, guarded 代码进入 bundle, `strings` 可搜到相关符号/字符串。

### 3. build-time: 反向验证 (DCE 生效)

```bash
bun run ./scripts/build.ts --dev    # 不带 --feature=ULTRAPLAN
strings ./fusion-code-dev | grep -i ultraplan    # 应搜不到
```

未启用 flag 的代码被 DCE 移除, `strings` 搜不到。

### 4. runtime env-gate 验证

```bash
FUSION_CODE_XXX=1 ./fusion-code-dev --version  # 启动即读 env
```

runtime flag 不会出现在 `strings` (非编译时), 验证靠日志或行为。多数 runtime flag 在路径入口有 `isEnvTruthy` 短路 + logForDebugging。

## 审计 §3.2 核对 (2026-08-28)

审计 §3.2 原结论 "141 个标志 918 调用点, 组合爆炸不可测" 基于审计时 (2026-08-27) 的 grep, 当时将 build-time 与 runtime 混计。重新核对后:

- build-time `feature('X')`: 审计时 **91** distinct / **915** call site (单/双引号合并统计 — 审计 grep 可能只匹配单一引号风格, 遗漏单引号调用); P1-4 (2026-09-01) 复核后 90 distinct / 904 call site (删 BRIDGE_MODE/BUILDING_CLAUDE_APPS 死条目, 补 TELEMETRY 活动漏项); P1-7 (2026-09-01) 删 DAEMON stub 子系统后 **89** distinct / 904 call site, 见顶部计数表
- runtime `isEnvTruthy(process.env.FUSION_CODE_*)`: **88** distinct / **177** call site
- 二者机制不同 (build DCE vs runtime 条件分支), 非同一 "141 标志" 组合空间; 审计 3.2.1 的 2^141 指的是二者合并后的概念空间, 实际 build-time 子空间为 2^89 (P1-7 后), runtime 子空间为 2^88, 但 runtime flag 多有依赖关系 (非全独立)。

审计 3.2.2 (feature() 字面量约束制造 DCE/运行时二分) **成立** — 两套机制共存是已知设计 (build-time 控产物大小, runtime 控运行时行为), 混用风险靠约定 + 本文档说明缓解, 无静态检查。

审计 3.2.3 (默认关 byte-identical 靠人工维持无强制) **已部分缓解** — off-path 校验仍靠 reviewer 纪律, 但 build-time flag 列表与源码一致性已有自动化 gate: `bun run lint:flags` (`scripts/check-feature-flags.ts`, P1-4 R10), 集成进 `bun run check`。src↔build 漂移 (dead entry / 活动漏项) 会被 CI 拦截。

审计 3.2.4 (命名无前缀约定) **部分成立** — runtime flag 统一 `FUSION_CODE_` 前缀; `FUSION_*` (非 `FUSION_CODE_`) 为 SDK 兼容映射, `CLAUDE_CODE_*` 为上游兼容遗留。build-time flag 无统一前缀 (历史命名)。

### 列表与源码一致性核对命令

新增 `feature('X')` gate 后, 需同步 `scripts/build.ts` `fullExperimentalFeatures` 列表。

**自动化 gate (推荐, P1-4 R10):** `bun run lint:flags` (`scripts/check-feature-flags.ts`) — 纯进程内扫描 (Bun.Glob + readFileSync + matchAll, 不依赖 rg/grep, 免受工具重写代理干扰), diff src `feature('X')` 调用点与 build.ts `fullExperimentalFeatures` 数组, 或phan (build 有 src 无) / miss (src 有 build 无) 任一非零即 exit 1。已集成进 `bun run check`。

```bash
bun run lint:flags
# [check-feature-flags] src=89 build=89 orphans=0 misses=0 → OK exit 0
```

**手动核对 (fallback / 复算引号风格):**

```bash
# src/ 实际 feature() 调用 (单/双引号合并)
{ grep -rhoE "feature\('[A-Z0-9_]+'\)" src/ | sed -E "s/feature\('([^']+)'\)/\1/";
  grep -rhoE 'feature\("[A-Z0-9_]+"\)' src/ | sed -E 's/feature\("([^"]+)"\)/\1/'; } | LC_ALL=C sort -u > /tmp/src-flags.txt
# build.ts 列表
LC_ALL=C grep -oE '"[A-Z_0-9]+"' scripts/build.ts | LC_ALL=C sort -u | tr -d '"' | grep -vE '^HEAD$' > /tmp/build-flags.txt
# 应两两一致 (0 行输出 = 一致)
LC_ALL=C comm -23 /tmp/build-flags.txt /tmp/src-flags.txt   # build.ts 有但 src 无 = dead entry
LC_ALL=C comm -13 /tmp/build-flags.txt /tmp/src-flags.txt   # src 有但 build.ts 无 = dev-full 漏
```

`comm` 要求 `LC_ALL=C` 保证排序规则一致, 否则跨 locale 出现假差异。手动核对与自动化 gate 应结论一致; 若不一致以 `lint:flags` 为准 (其引号/注释行处理更精确)。

## 调试日志

- 构建失败: `scripts/build.ts` 原样输出 `bun build` stderr, 观察报错文件定位
- 模块数异常: 正常 dev-full 约 4000+ 模块, 显著偏离说明依赖树有问题
- runtime flag 未生效: 多数入口有 logForDebugging, 查启动日志; env 名拼写 (全大写下划线)
- runtime flag crash: 检查是否依赖 OAuth / GrowthBook / 原生模块 (见运行时 caveat)
- build flag 未 DCE: `feature()` 参数必须是**字符串字面量**, 运行时变量 cast 破坏 DCE 且致 build:dev 报错 (PR #9)
