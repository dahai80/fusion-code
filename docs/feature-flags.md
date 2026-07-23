# fusion-code Feature Flags

本文说明 88 个 feature flag 的总览、DCE 机制、34 个 broken flags 的修复记录、dev-full 列表与验证方法。

## 总览

仓库当前引用 88 个 `feature('FLAG')` 编译时 flag（源码 grep 统计为 86 个唯一 flag，FEATURES.md 记录 88 个）。

### DCE 机制

Feature flag 通过 Bun bundler 的编译时宏实现死代码消除：

1. `scripts/build.ts` 收集 `--feature=NAME` 参数，生成 `features` 数组
2. 每个 feature 以 `--feature=NAME` 传给 `bun build --compile`
3. 源码中 `import { feature } from 'bun:bundle'`，调用 `feature('FLAG')`
4. 启用时：`feature('FLAG')` -> `true`，对应代码进入 bundle
5. 未启用时：`feature('FLAG')` -> `false`，Bundler DCE 移除该分支

这意味着未启用的 feature 代码完全不进入产物，零运行时开销。

### 默认启用

`scripts/build.ts` 中 `defaultFeatures = ['VOICE_MODE']`，所有构建变体都包含 `VOICE_MODE`。

## 34 Broken Flags 修复记录（2026-07-23）

审计日期 2026-03-31 时，34 个 flag 无法 bundle。2026-07-23 全部修复，`bun run ./scripts/build.ts --dev --feature-set=dev-full --feature=<all 34>` 退出码 0，4001 模块，flag-gated 代码确认进入二进制。

### 修复来源

**12 个 HEAD-only 入口文件 restored**：

| Flag | 文件 |
|------|------|
| `BUDDY` | `src/commands/buddy/index.js` |
| `FORK_SUBAGENT` | `src/commands/fork/index.js` |
| `HISTORY_SNIP` | `src/commands/force-snip.js`（即 `force-snip.ts`） |
| `KAIROS_GITHUB_WEBHOOKS` | `src/tools/SubscribePRTool/SubscribePRTool.js` |
| `KAIROS_PUSH_NOTIFICATION` | `src/tools/PushNotificationTool/PushNotificationTool.js` |
| `OVERFLOW_TEST_TOOL` | `src/tools/OverflowTestTool/OverflowTestTool.js` |
| `TORCH` | `src/commands/torch.js` |
| `CONTEXT_COLLAPSE` | `src/tools/CtxInspectTool/CtxInspectTool.js` |
| `MONITOR_TOOL` | `src/tools/MonitorTool/MonitorTool.js` |
| `TERMINAL_PANEL` | `src/tools/TerminalCaptureTool/TerminalCaptureTool.js` |
| `WEB_BROWSER_TOOL` | `src/tools/WebBrowserTool/WebBrowserTool.js` |
| `WORKFLOW_SCRIPTS` | `src/commands/workflows/index.js` |

**4 个文件已存在**：

| Flag | 文件 | 说明 |
|------|------|------|
| `RUN_SKILL_GENERATOR` | `src/skills/bundled/runSkillGenerator.ts` | 已在 phase 4-8 补齐 |
| `REACTIVE_COMPACT` | `src/services/compact/reactiveCompact.ts` | phase 8 实现（5 个缺失函数补齐） |
| `BUILDING_CLAUDE_APPS` | `src/claude-api/csharp/claude-api.md` | asset 文件 |
| `TRANSCRIPT_CLASSIFIER` | `src/utils/permissions/yolo-classifier-prompts/auto_mode_system_prompt.txt` | prompt asset |

**剩余 gap**：phase 4-8 补齐（commands/tools/modules/feature flags 4 个 batch）。

### 运行时注意事项

"bundle cleanly" 不等于 "runtime-safe"。部分 flag 仍依赖：

- 可选原生模块（`image-processor-napi` 等）
- claude.ai OAuth
- GrowthBook gate
- 外部化的 `@ant/*` 包

典型运行时 caveat：

- `VOICE_MODE`：需 claude.ai OAuth + 录音后端（原生模块或 SoX fallback）
- `NATIVE_CLIPBOARD_IMAGE`：需 `image-processor-napi` 才加速
- `BRIDGE_MODE` / `CCR_*`：运行时受 OAuth + GrowthBook 控制
- `CHICAGO_MCP`：编译通过但运行时 reaches `@ant/computer-use-*`，dev-full 已排除
- `TEAMMEM`：需 team-memory 配置实际启用才有用

## dev-full 23 Flags

`scripts/build.ts` 中 `fullExperimentalFeatures` 列表（23 个）：

```
AGENT_MEMORY_SNAPSHOT
BASH_CLASSIFIER
BUILTIN_EXPLORE_PLAN_AGENTS
CACHED_MICROCOMPACT
COMPACTION_REMINDERS
EXTRACT_MEMORIES
HISTORY_PICKER
HOOK_PROMPTS
MCP_RICH_OUTPUT
MESSAGE_ACTIONS
NATIVE_CLIPBOARD_IMAGE
NEW_INIT
POWERSHELL_AUTO_MODE
PROMPT_CACHE_BREAK_DETECTION
QUICK_SEARCH
TOKEN_BUDGET
TREE_SITTER_BASH
TREE_SITTER_BASH_SHADOW
ULTRAPLAN
ULTRATHINK
UNATTENDED_RETRY
VERIFICATION_AGENT
VOICE_MODE
```

`CHICAGO_MCP` 虽编译通过，但因运行时依赖 `@ant/computer-use-mcp`，dev-full 已显式排除。

## Flag 分类（FEATURES.md 历史 reconstruction）

以下分类来自 FEATURES.md，保留作为历史参考，不再反映 failing build。

### Interaction and UI Experiments

`AWAY_SUMMARY`、`HISTORY_PICKER`、`HOOK_PROMPTS`、`KAIROS_BRIEF`、`KAIROS_CHANNELS`、`LODESTONE`、`MESSAGE_ACTIONS`、`NEW_INIT`、`QUICK_SEARCH`、`SHOT_STATS`、`TOKEN_BUDGET`、`ULTRAPLAN`、`ULTRATHINK`、`VOICE_MODE`

### Agent, Memory, and Planning Experiments

`AGENT_MEMORY_SNAPSHOT`、`AGENT_TRIGGERS`、`AGENT_TRIGGERS_REMOTE`、`BUILTIN_EXPLORE_PLAN_AGENTS`、`CACHED_MICROCOMPACT`、`COMPACTION_REMINDERS`、`EXTRACT_MEMORIES`、`PROMPT_CACHE_BREAK_DETECTION`、`TEAMMEM`、`VERIFICATION_AGENT`

### Tools, Permissions, and Remote Experiments

`BASH_CLASSIFIER`、`BRIDGE_MODE`、`CCR_AUTO_CONNECT`、`CCR_MIRROR`、`CCR_REMOTE_SETUP`、`CHICAGO_MCP`、`CONNECTOR_TEXT`、`MCP_RICH_OUTPUT`、`NATIVE_CLIPBOARD_IMAGE`、`POWERSHELL_AUTO_MODE`、`TREE_SITTER_BASH`、`TREE_SITTER_BASH_SHADOW`、`UNATTENDED_RETRY`

### Bundle-Clean Support Flags

`ABLATION_BASELINE`、`ALLOW_TEST_VERSIONS`、`ANTI_DISTILLATION_CC`、`BREAK_CACHE_COMMAND`、`COWORKER_TYPE_TELEMETRY`、`DOWNLOAD_USER_SETTINGS`、`DUMP_SYSTEM_PROMPT`、`FILE_PERSISTENCE`、`HARD_FAIL`、`IS_LIBC_GLIBC`、`IS_LIBC_MUSL`、`NATIVE_CLIENT_ATTESTATION`、`PERFETTO_TRACING`、`SKILL_IMPROVEMENT`、`SKIP_DETECTION_WHEN_AUTOUPDATES_DISABLED`、`SLOW_OPERATION_LOGGING`、`UPLOAD_USER_SETTINGS`

### Compile-Safe But Runtime-Caveated

`VOICE_MODE`、`NATIVE_CLIPBOARD_IMAGE`、`BRIDGE_MODE`、`CCR_AUTO_CONNECT`、`CCR_MIRROR`、`CCR_REMOTE_SETUP`、`KAIROS_BRIEF`、`KAIROS_CHANNELS`、`CHICAGO_MCP`、`TEAMMEM`

## 如何启用 Flag

### 单个 flag

```bash
bun run ./scripts/build.ts --feature=ULTRAPLAN
```

### 多个 flag

```bash
bun run ./scripts/build.ts --feature=ULTRAPLAN --feature=ULTRATHINK
```

### 全部实验 flag

```bash
bun run ./scripts/build.ts --dev --feature-set=dev-full
```

### dev-full + 额外 flag

```bash
bun run ./scripts/build.ts --dev --feature-set=dev-full --feature=BG_SESSIONS
```

dev-full 之外的 flag（如 `BG_SESSIONS`、`AUTO_THEME` 等）需单独 `--feature=` 传入。

## 验证 Flag 编译

### 1. 构建并观察退出码

```bash
bun run ./scripts/build.ts --dev --feature=XXX
echo $?  # 0 表示成功
```

成功时输出 `Built ./fusion-code-dev`，并打印模块数。

### 2. strings 确认 flag-gated 代码进入二进制

```bash
# 构建
bun run ./scripts/build.ts --dev --feature=ULTRAPLAN

# 确认 ULTRAPLAN 相关字符串进入二进制
strings ./fusion-code-dev | grep -i ultraplan | head
```

若 `feature('ULTRAPLAN')` 为 `true`，其 guarded 代码进入 bundle，`strings` 应能搜到相关符号/字符串。

### 3. 反向验证（DCE 生效）

```bash
# 不带 --feature=ULTRAPLAN 构建
bun run ./scripts/build.ts --dev

# 应搜不到 ULTRAPLAN 专属字符串
strings ./fusion-code-dev | grep -i ultraplan
```

未启用的 flag，其代码被 DCE 移除，`strings` 搜不到对应内容。

## 调试日志

- 构建失败：`scripts/build.ts` 会原样输出 `bun build` 的 stderr，观察报错文件定位
- 模块数异常：正常 dev-full 约 4001 模块，显著偏离说明依赖树有问题
- 运行时 flag 未生效：用 `strings ./fusion-code-dev | grep <FLAG>` 确认代码是否真的进入二进制
- flag 运行时 crash：检查是否依赖 OAuth / GrowthBook / 原生模块（见上文运行时 caveat）
