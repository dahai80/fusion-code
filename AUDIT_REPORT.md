# Fusion-Code 代码审计报告

**审计范围**：`/Users/dahai/fusion/fusion-code`（HEAD 45b51ee，分支 main）
**审计维度**：性能 / 安全 / 技术架构 / 代码质量 / 内存泄漏风险
**审计方式**：只读静态审视，未运行构建与测试，未修改任何代码
**审计日期**：2026-07-25

---

## 一、总体评价

Fusion-Code 是一个深度 fork 自 Anthropic Claude Code 的终端 AI 编程代理，体量巨大（`src/` 下约 1800+ 源文件），融合了 MLX 本地推理、多 provider 抽象、MCP/LSP/Plugin/Skill/Bridge 多生态、swarm/teammate 多代理协作、OAuth/keychain 凭据管理、Ink 自研 reconciler 终端渲染等大量子系统。整体工程质量较高，关键安全边界（命令注入、路径穿越、SSRF、凭据隔离）有显式且纵深的设计；但作为 fork 二次开发产物，存在大量遗留 `_DEPRECATED` 接口、`if (false)` 死分支、`as any/as unknown` 类型逃逸，以及若干内存泄漏与一致性隐患。

**风险评级汇总**

| 维度 | 风险等级 | 主要问题 |
|---|---|---|
| 性能 | 🟡 中 | 模块顶层副作用、同步 IO、provider 分支 dead code |
| 安全 | 🟡 中 | bypassPermissions 透传链、密钥 env 注入面广、bridge 信任边界 |
| 技术架构 | 🟠 偏高 | 6 provider 抽象中 2 个被 `if(false)` 死锁；fork 遗留大量废弃 API |
| 代码质量 | 🟡 中 | 类型逃逸、`@ts-expect-error` 集中于 reconciler、catch 吞错 |
| 内存泄漏 | 🟡 中 | module-scope 持久状态、stdin 多监听器、AbortController 生命周期 |

---

## 二、性能审计

### 2.1 启动路径（main.tsx）

**✅ 已优化项**（注释证据显示团队有意识做性能治理）：
- `profileCheckpoint` / `startMdmRawRead` / `startKeychainPrefetch` 在模块导入期并行预热，注释明确标注「与 ~135ms 的后续导入并行」
- `startDeferredPrefetches` 将非首屏必需的子进程 spawn 延迟到首帧渲染后
- `isBareMode` 跳过 LSP/plugin sync/attribution/auto-memory 等开销
- settings 路径用 content-hash 生成，跨进程边界保 prompt cache 前缀稳定（避免 12x input token 惩罚，注释 :448-451）

**🟡 风险项**：

1. **同步 IO 残留**（`writeFileSync_DEPRECATED` 系列）：`slowOperations.ts` 注释自承「Sync file writes block the event loop and cause performance issues」。`main.tsx:458` 启动路径仍用 `writeFileSync_DEPRECATED` 写 settings（虽有「startup-only, before event loop is busy」辩护，但风险存在）。`teamHelpers.ts:169`、`installedPluginsManager.ts` 多处仍用同步写。

2. **`combinedAbortSignal.ts` 已识别的 Bun 定时器泄漏**：注释明确指出 Bun 下 `AbortSignal.timeout` 的定时器「accumulate in native memory until they fire (measured ~2.4KB/call)」，已用 `setTimeout`+`clearTimeout` 替代。**正面信号**——说明团队有 Bun 特定性能 profiling，但该注释同时也意味着其他未改造路径可能仍有相同问题。

3. **模块顶层副作用密度高**：`render-to-screen.ts`、`render-node-to-output.ts`、`selection.ts`、`bootstrap/state.ts` 等大量模块在顶层 `let`/`const` 持有跨调用可变状态（见内存泄漏章节），每次 import 即初始化，无法 tree-shake。

### 2.2 Query 流水线（QueryEngine.ts / query.ts）

- **✅ 流式异步生成器**：`submitMessage` 与 `query()` 均为 `async *`，fire-and-forget 写 transcript（`void recordTranscript(messages)`），不阻塞生成器推进；注释 :734-744 明确论证过。
- **✅ compact 边界释放 GC**：`QueryEngine.ts:939-950` 在 compact_boundary 后 `splice(0, mutableBoundaryIdx)` 主动释放预压缩消息，注释明确指出「Release pre-compaction messages for GC」——这是**主动内存治理的正面信号**。
- **🟡 mutableMessages 持续累积**：长 SDK 会话中，`snipReplay` 未配置时 `mutableMessages` 只 push 不 shrink（:933），注释 :919 自承「memory leak in long SDK sessions」。虽然 compact 边界会 splice，但非 compact 路径下长会话仍线性增长。

### 2.3 compact / bundling

- `compact.ts` 拆分细致（38 个符号，`partialCompactConversation`、`preflightMlxTokenTruncate`、`streamCompactSummary` 等专项处理），针对 MLX 32K 上下文窗口有专门 tier 化工具降级（HEAD commit message 印证）。
- **🟡 dead feature require**：`query.ts:15-22` 多处 `feature('REACTIVE_COMPACT') ? require(...) : null` 模式，Bun bundler 的 dead-code elimination 依赖 feature flag 正确传递；34 个实验 feature 中仅 `VOICE_MODE` 默认开，其余未编译进 bundle，但运行时 `require` 路径仍需审计是否被错误求值。

---

## 三、安全审计

### 3.1 凭据管理

**✅ 防御纵深设计**：

| 防护点 | 实现 |
|---|---|
| 子进程环境隔离 | `subprocessEnv.ts` 在 GitHub Actions 下 scrub 子进程的 `FUSION_API_KEY`/`FUSION_AUTH_TOKEN`/`FUSION_CODE_OAUTH_TOKEN` 等，防止 `${FUSION_API_KEY}` shell 注入外泄 |
| PowerShell 变量防泄露 | `pathValidation.ts:1442`、`powershellPermissions.ts:1295` 显式拦截 `$env:FUSION_API_KEY` 等 Variable elementType，注释标注「SECURITY: finding #32」 |
| keychain 优先 | `pluginOptionsStorage.ts` / `mcpbHandler.ts` 敏感值入 secureStorage（macOS keychain / 0600 credentials.json），非敏感入 settings.json |
| OAuth vs API key 冲突守卫 | `auth.ts:80-112` CCR/Desktop 场景禁止回退到 `~/.claude` settings 的 API key，避免 header mismatch |
| bypassPermissions 安全闸 | `setup.ts:408-440` 拒绝在 root/sudo 下使用，且要求 Docker/sandbox + 无外网环境 |

**🟡 风险项**：

1. **`--dangerously-skip-permissions` 透传链广**：`spawnMultiAgent.ts:223`、`spawnUtils.ts:53` 在 swarm/teammate spawn 时自动追加该 flag。若主会话以 bypass 模式启动，所有子代理/SSH 远端/DirectConnect 都会继承（`createDirectConnectSession.ts:111-113` 通过 HTTP body 传 `dangerously_skip_permissions: true`）。**信任边界跨进程透传**，任一子代理被 prompt-injection 即可全权执行。

2. **env 密钥读取面广**：`providers.ts`、`auth.ts`、`http.ts`、`statusNoticeDefinitions.tsx`、`subprocessEnv.ts`、`managedEnvConstants.ts`、`authFileDescriptor.ts` 等十余处直接读 `process.env.FUSION_API_KEY` / `ANTHROPIC_API_KEY`。虽 `subprocessEnv.ts` 在 GHA 下 scrub 子进程，但**主进程内任意能写 `process.env` 的代码（如 plugin/hook/MCP）都可注入或外泄密钥**。`managedEnvConstants.ts:99-103` 注释自承存在「SWITCH TO ATTACKER-CONTROLLED PROJECT」攻击场景。

3. **`updateSessionIngressAuthToken` 写 `process.env`**（`sessionIngressAuth.ts:139`）：运行时改 env 是反模式，且 env 可被子进程继承。

4. **bridge / direct-connect / SSH 远端**：`createDirectConnectSession.ts` 用 `AbortSignal.timeout(30_000)` + HTTP body 传 cwd 与 skipPermissions 标志到远端服务器，**远端执行环境信任远端**，本地只控 auth token。若 `serverUrl` 被篡改（DNS/hosts），auth token 流向攻击者服务器。

### 3.2 命令/工具注入

**✅ 防御强**：
- BashTool 有 tree-sitter AST 主路径 + legacy regex fallback（`bashSecurity.ts:2254` 自承 legacy 仅 fallback），`CONTROL_CHAR_RE` 拦截 `\x00-\x1F\x7F`。
- PowerShellTool `pathValidation.ts` 1900+ 行专项处理：null byte、URL-encoded traversal、Unicode NFKC normalization（fullwidth `．．／` → `../`）、backslash、absolute path、dangling symlink、ELOOP 全部显式拦截，`PathTraversalError` 分类清晰。
- WebFetchTool `validateURL` + `checkDomainBlocklist` + 本地 SSRF IP 检查（`utils.ts:394-438`），`skipWebFetchPreflight` **只跳过外网域名黑名单，不跳过本地 SSRF IP 检查**（注释 :434-435 明确）。
- **无 `eval()` / `new Function()` / `vm.runIn`**——全代码搜无命中，杜绝动态代码执行注入面。

**🟡 风险项**：
- `bashCommandIsSafe_DEPRECATED` / `bashCommandIsSafeAsync_DEPRECATED` 仍在 `bashCommandHelpers.ts:225`、`bashSecurity.ts:510/2436` 等主路径被调用，注释自承「Legacy regex/shell-quote path. Only used when tree-sitter is unavailable」。**若 tree-sitter 加载失败即降级到弱安全路径**，需确认 tree-sitter 不可用时的 fail-closed 行为。

### 3.3 路径穿越

- `memdir/teamMemPaths.ts` 的 `sanitizePathKey` 是**教科书级防御**：null byte、URL-encoded `..`、Unicode NFKC、backslash、absolute path、dangling symlink、ELOOP 全覆盖，注释引用「PSR M22187 vector 4」显示有外部安全审计介入。
- BashTool/PowerShellTool 的 `validatePath` 在 `..` glob 后会 `resolve(cwd, normalizedPath)` 再校验，防 glob 后穿越。

### 3.4 数据暴露

- **🟡 调试日志写文件**：`ink/reconciler.ts` 用 `appendFileSync(COMMIT_LOG, ...)` 写 SLOW_YOGA/SLOW_PAINT/gap 等性能日志，`debug.ts:175`、`errorLogSink.ts`、`diagLogs.ts` 多处 append。虽 `mode: 0o600`（`asciicast.ts:168`、`authFileDescriptor.ts:42`），但**调试日志可能含命令/路径片段**，需确认日志目录权限与轮转。
- **🟡 analytics 上报**：`logEvent` 上报 `dangerouslySkipPermissionsPassed`、`permissionMode`、`modeIsBypass`、`inProtectedNamespace` 等（`main.tsx:4621-4624`），虽类型标注 `AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` 强制人工确认非代码/路径，但 bypass 状态本身被上报。

---

## 四、技术架构审计

### 4.1 分层与耦合

**✅ 正面**：
- `services/` / `utils/` / `tools/` / `commands/` / `tasks/` / `hooks/` / `state/` 分层清晰，`services/` 内按生态再分（`mcp/`、`lsp/`、`oauth/`、`compact/`、`analytics/`）。
- `Tool.ts` / `ToolUseContext` 抽象统一，30+ tool 注册到 `tools.ts`，tool 实现 lives in `src/tools/`。
- `state/store.ts` 的 `createStore` 极简（24 行），`Object.is` 浅比较防无效更新，subscribe 返回 unsubscribe——**符合最小可用原则**。

**🟠 风险项**：

1. **provider 抽象被死锁**：`providers.ts:16-32` 中 `if (false) return 'bedrock'` / `if (false) return 'vertex'` 出现两次。`APIProvider` 类型仍包含 `'bedrock' | 'vertex'`，但 `getAPIProvider()` 永不可能返回它们。**类型与实现脱节**，下游任何针对 bedrock/vertex 的分支都是死代码，且类型系统无法发现。

2. **fork 遗留废弃 API 规模大**：`getSettings_DEPRECATED`、`writeFileSync_DEPRECATED`、`writeFileSyncAndFlush_DEPRECATED`、`renderPreviousOutput_DEPRECATED`、`bashCommandIsSafe_DEPRECATED`、`bashCommandIsSafeAsync_DEPRECATED`、`splitCommand_DEPRECATED`、`isUnsafeCompoundCommand_DEPRECATED`、`commands_DEPRECATED` 等十余处 `_DEPRECATED` 接口仍被主路径调用（非真正废弃，只是「待迁移」）。**技术债显性但未消除**。

3. **`if (false)` dead 分支**：除 providers.ts，全代码搜 `if (false)` 可能还有其他遗留（fork 时删除 bedrock/vertex 支持的痕迹）。建议用 dead-code elimination 工具扫一遍。

4. **main.tsx 体量过大**：单文件 4500+ 行，混杂 CLI 解析、argv 重写、ssh/connect/local 多场景派发、settings 加载、teammate 选项、MCP 加载、hooks、analytics——**上帝文件**，改动 blast radius 极大。

### 4.2 状态管理

- `bootstrap/state.ts` 顶层 `let scrollDraining`、`scrollDrainTimer`、`SCROLL_DRAIN_IDLE_MS` 等模块级可变状态，注释 :31 自承「DO NOT ADD MORE STATE HERE - BE JUDICIOUS WITH GLOBAL STATE」——**团队有意识但已破窗**。
- `history.ts` 顶层 `pendingEntries`/`isWriting`/`currentFlushPromise`/`skippedTimestamps` 跨调用共享，单例 flush 队列设计合理但无法多实例化。

### 4.3 构建

- `bun build --compile` + 34 feature flag + dead-code elimination，`MACRO.VERSION`/`BUILD_TIME`/`USER_TYPE` 编译期注入。
- **🟡 native module 排除**：`@ant/*`、`audio-capture-napi`、`image-processor-napi`、`modifiers-napi`、`url-handler-napi` 排除出 bundle，运行时需 host 具备——**部署环境耦合**。

---

## 五、代码质量审计

### 5.1 类型安全

**🟡 类型逃逸**：
- `main.tsx:1278-1283` `(options as any).inputFormat` 连续 4 处 `as any`，注释「bare variable access hangs in Bun runtime」——**绕过类型因 Bun 运行时 bug**，技术债。
- `main.tsx:1875-1876` 同模式 `(options as any).inputFormat as string | undefined`。
- `AgentTool.tsx:317/483`、`ToolSearchTool.ts:469` `as unknown as {...}` 强转工具输出类型。
- `ink/ink.tsx`、`ink/render-to-screen.ts` 集中 8+ 处 `@ts-expect-error`，全部针对 `react-reconciler` 实际 API 与 `@types/react-reconciler` 类型定义不一致（0.32.3 vs 0.33）。**类型定义与运行时版本漂移**，升级 react-reconciler 时易踩雷。

### 5.2 错误处理

**🟡 catch 吞错**：
- `main.tsx:227` `} catch { // Silently ignore errors - this is just for analytics }`——analytics 失败静默。
- `main.tsx:350` `migrateChangelogFromConfig().catch(() => { // Silently ignore migration errors })`——**迁移失败静默**，下次启动重试，但用户无感知。
- `ink/ink.tsx:1672/1699/1706/1713` 多处 `} catch { /* EAGAIN/EBADF/EIO */ }`——TTY 异常吞错有注释说明，尚可。
- `relay.ts:450` `} catch { // already closing }`——WebSocket close 竞态，尚可。
- `ErrorOverview.tsx:48` `} catch { // file not readable — skip source context }`——读取源文件失败吞错。

**正面**：`migrations/*.ts` 多用 `logError` 而非静默；`history.ts:131` `logForDebugging('Failed to parse history line')`；`upstreamproxy.ts` 多处 `logForDebugging` 带 level。

### 5.3 一致性

- **命名混用**：`FUSION_API_KEY` vs `ANTHROPIC_API_KEY` 双轨（CLAUDE.md 列出映射表），`FUSION_*` 与 `ANTHROPIC_*` 在不同子系统混用（如 `bashPermissions.ts:414` 用 `FUSION_API_KEY`，但 `statusNoticeDefinitions.tsx:85` 用 `ANTHROPIC_API_KEY`）。**env 重命名未彻底**。
- **TODO/FIXME 集中点**：`keybindings/shortcutFormat.ts:9`、`useShortcutDisplay.ts:9` 标注「TODO(keybindings-migration): Remove fallback parameter after migration is complete」——迁移债显性。
- **中文注释与英文注释混用**：`providers.ts`、`main.tsx:807-813`、`mlx-system-prompt.ts` 等大量中文注释，与上游英文注释共存。符合「Chinese code support」约定，但 fork 二次开发痕迹明显。

### 5.4 注释密度

- 注释极其详尽，关键决策点（`QueryEngine.ts:437-463`、`combinedAbortSignal.ts:9-13`、`subprocessEnv.ts:4-12`、`bashSecurity.ts:2254-2256`）都有 rationale 注释，**远超一般项目**。这是 fork 自 Anthropic 的遗产，团队有延续。

---

## 六、内存泄漏风险审计

### 6.1 AbortController 生命周期

**✅ 总体良好**：
- `LocalMainSessionTask.ts:114` 复用 `existingAbortController` 避免重复创建（backgrounding 场景）。
- `LocalAgentTask.tsx:486` parent 提供 `createChildAbortController(parent)`，子代理随 parent abort——**层级化 abort 正面设计**。
- `combinedAbortSignal.ts` 显式 cleanup `clearTimeout(timer)`，注释论证 Bun 下 `AbortSignal.timeout` 的 native 内存累积问题——**已识别并修复**。
- `SleepTool.ts:62-65` abort 时 `clearTimeout(timer)`。

**🟡 风险**：
- `main.tsx:3465` `new AbortController().signal` 临时创建未持有引用，signal 随 AbortController 被 GC，若 teleport 内部持有 signal 但 controller 已 GC 可能导致 abort 失效。
- `spawnMultiAgent.ts:789` `new AbortController()` 存入 `taskState`，依赖 `unregisterCleanup` 清理，需确认 task kill 时一定调用。

### 6.2 setInterval / setTimeout

**✅ 清理到位的**：
- `buddy/CompanionSprite.tsx:203/329` `useEffect` 返回 `clearInterval(timer)`。
- `ink/ink.tsx:1513` unmount 时 `clearTimeout(this.drainTimer)`。
- `App.tsx:193-200` clear pending timers。
- `LocalShellTask.tsx:73/102` `clearInterval(timer)`。
- `ClockContext.tsx:28/36` 有 clear，且 idle 时主动停 interval。

**🟡 风险项**：

1. **module-scope 持久定时器**：
   - `sessionActivity.ts:26-27` `heartbeatTimer`/`idleTimer` 模块级，`cleanupRegistered` 防重复注册——但**单进程内无法多实例**。
   - `settings/changeDetector.ts:66-70` `mdmPollTimer` + `pendingDeletions` Map 模块级，`disposed` flag 控制——有 dispose 设计但需确认调用。
   - `gracefulShutdown.ts:362-363` `failsafeTimer`/`orphanCheckInterval` 模块级，`failsafeTimer` 在 shutdown 时 set，未在正常路径 clear（依赖 process exit）。

2. **`swarm/spawnInProcess.ts:316` `setTimeout(evictTerminalTask, STOPPED_DISPLAY_MS)`** 未持有 timer 引用，无法主动 clear，依赖超时自然触发。`swarm/inProcessRunner.ts:387` `setInterval` 依赖 abort signal 触发 cleanup——需确认 cleanup 一定执行。

3. **`self-hosted-runner/main.ts:98` `setInterval(poll, config.pollIntervalMs)`** **无 clear、无 unref**，仅在 SIGTERM/SIGINT 时 process.exit——长跑 runner 无泄漏但无优雅关闭。

### 6.3 事件监听器

**✅ 清理到位的**：
- `ink/ink.tsx:228` `unsubscribeTTYHandlers` 显式 `off('resize')` + `process.off('SIGCONT')`。
- `App.tsx:435` `process.removeListener('SIGCONT', resumeHandler)`。
- `context/stats.tsx:134` `process.off("exit", flush)`。
- `ShellCommand.ts:272-273` `once('exit')` + `once('error')`——once 不会累积。

**🟠 风险项**：

1. **`main.tsx:887` `process.stdin.on('data', onData)`** 在 `-p` 模式等待 stdin prompt 时注册，**注释未提及 removeListener**。虽有 3s 超时分支，但超时后未显式 `off('data', onData)`——**潜在监听器泄漏**（虽然进程随后 exit，但若超时分支 fallthrough 到主流程则残留）。

2. **`utils/systemThemeWatcher.ts:99/164` `process.stdin.on('data', ...)`** 两次注册监听器，`_registeredDataListener` 守卫了第一个，但**第二个 `onData`（:164）无守卫、无移除**。若该函数被多次调用，监听器累积。

3. **`claudeInChrome/chromeNativeHost.ts:446/451/459`** stdin `data`/`end`/`error` 监听器在构造器注册，无 unsubscribe 方法（依赖 stdin close）——**对象生命周期与 stdin 绑定，无法提前释放**。

4. **`hooks.ts:1068/1167/1182` `child.stdout.on('data')`** 等——子进程流监听，依赖 child exit 释放，正常。

### 6.4 module-scope 可变状态累积

**🟠 较高风险点**（这些模块级状态在长生命周期进程内只增不减）：

| 文件 | 状态 | 风险 |
|---|---|---|
| `history.ts:281-289` | `pendingEntries[]`、`skippedTimestamps` Set | skippedTimestamps 只 add 不 delete，超长会话累积 |
| `render-to-screen.ts:38-43` | `root`/`container`/`stylePool`/`charPool`/`hyperlinkPool`/`output` | 单例渲染资源，不会泄漏但无法多实例 |
| `render-node-to-output.ts:34-98` | `layoutShifted`/`scrollHint`/`absoluteRectsPrev/Cur`/`scrollDrainNode`/`followScroll` | 有 reset 函数，但需确认每次渲染后调用 |
| `terminal-focus-state.ts:8-10` | `focusState`/`resolvers` Set/`subscribers` Set | resolvers/subscribers 只 add，unsubscribe 需确认 |
| `upstreamproxy/relay.ts:113` `states: Map<WebSocket, ConnState>` | 连接状态 Map | `cleanupConn` 依赖 `close` 事件触发，若 close 未触发则残留 |

---

## 七、改进建议（仅供参考，未实施）

按风险与性价比排序：

1. **【高】移除 `providers.ts` 的 `if (false)` 死分支**：要么真删除 bedrock/vertex（从 `APIProvider` 类型也移除），要么恢复实现。当前类型与实现脱节，下游死代码无法被类型系统发现。

2. **【高】审计 `stdin.on('data')` 监听器清理**：`main.tsx:887`、`systemThemeWatcher.ts:164` 两处补 `removeListener` 或改 `once`。

3. **【高】bypassPermissions 透传链审计**：swarm/SSH/direct-connect 自动透传 `--dangerously-skip-permissions` 的子代理/远端是否都该默认继承？建议加白名单或显式确认。

4. **【中】收敛 `as any` / `@ts-expect-error`**：`main.tsx:1278-1283` 的 Bun bug workaround 应加链接到上游 issue，待修复后移除；`ink/reconciler` 的 `@ts-expect-error` 应升级 `@types/react-reconciler` 或写 `.d.ts` override。

5. **【中】迁移 `_DEPRECATED` 接口**：`getSettings_DEPRECATED`、`bashCommandIsSafe_DEPRECATED` 等十余处，制定迁移计划，逐个移除，避免主路径长期依赖废弃 API。

6. **【中】`skippedTimestamps` Set bounded**：`history.ts:289` 改 LRU 或定期清理，防超长会话累积。

7. **【低】拆分 `main.tsx`**：4500+ 行上帝文件，按 ssh/connect/local/cli-arg/settings/team 拆分到 `cli/handlers/`。

8. **【低】统一 env 命名**：`FUSION_*` 与 `ANTHROPIC_*` 双轨收敛到单一命名，减少映射层。

---

## 八、整体质量评估

### 8.1 质量评分卡

采用 5 分制（5=卓越，4=良好，3=合格，2=薄弱，1=严重缺陷），权重按对终端 AI 编程代理的关键性分配。

| 维度 | 权重 | 评分 | 加权 | 评语 |
|---|---|---|---|---|
| 功能完备性 | 20% | 5.0 | 1.00 | 30+ tool、40+ slash command、6 provider、MCP/LSP/Plugin/Skill/Bridge/Voice/Swarm/Task 全生态，远超同类 |
| 安全纵深 | 20% | 4.0 | 0.80 | 命令注入/路径穿越/SSRF/凭据隔离有教科书级防御，但 bypassPermissions 透传链与 env 密钥面广构成系统性风险 |
| 性能治理 | 15% | 4.0 | 0.60 | 启动并行预热、流式 fire-and-forget、compact 边界主动 GC，团队有 Bun 特定 profiling，但同步 IO 残留与模块顶层副作用未清 |
| 可维护性 | 15% | 2.5 | 0.38 | main.tsx 4500 行上帝文件、十余处 `_DEPRECATED` 主路径依赖、fork 遗留废弃 API 规模大、类型逃逸集中 |
| 架构一致性 | 10% | 2.5 | 0.25 | providers.ts `if(false)` 死锁 bedrock/vertex、FUSION/ANTHROPIC env 双轨、中文/英文注释混用 |
| 类型安全 | 10% | 3.0 | 0.30 | 大量 `as any`/`as unknown`/`@ts-expect-error`，react-reconciler 类型漂移 |
| 内存安全 | 10% | 3.5 | 0.35 | AbortController 层级化与 combinedAbortSignal 已治，但 module-scope 持久状态/定时器与 stdin 监听器清理不全 |
| **加权总分** | **100%** | — | **3.68** | **合格偏上，fork 二次开发产物中的上乘水准** |

**等级映射**：3.5–4.0 = **B（合格偏上）**；4.0–4.5 = B+；4.5–5.0 = A。

**结论**：Fusion-Code 整体质量评级 **B**（加权 3.68/5），处于「可用之于生产但需持续治理技术债」的水平。

### 8.2 质量画像定性

**这是一个什么工程**

一个**深度 fork 自 Anthropic Claude Code 的二次开发产物**，在原基础上嫁接了：
- MLX 本地推理（fusion-mlx adapter/stream/tool-validator）
- 多 provider 抽象（firstParty/foundry/openai/fusionMlx，bedrock/vertex 被死锁）
- 中文环境适配（大量中文注释、`isCloudFreeMode` 无云依赖模式）
- swarm/teammate 多代理协作（in-process + tmux 双模式）

工程体量巨大（`src/` 约 1800+ 文件），但**核心逻辑直接继承自上游**，安全/性能/compact 的纵深防御与详尽注释大多为 Anthropic 原工程遗产，而非 fusion 团队新建。

**工程文化的两面性**

**正面**（fork 继承的上游文化）：
- **注释极其详尽**——关键决策点都有 rationale（`combinedAbortSignal.ts:9-13` 论证 Bun 定时器泄漏、`QueryEngine.ts:437-463` 论证 transcript 写入时机、`subprocessEnv.ts:4-12` 论证 env scrub 防注入），远超一般项目
- **安全纵深意识强**——PowerShell `pathValidation.ts` 1900 行专项、`teamMemPaths.ts` 的 Unicode NFKC 防御引用「PSR M22187 vector 4」显示有外部安全审计介入
- **性能有 profiling 文化**——`startupProfiler`、`headlessProfilerCheckpoint`、`queryCheckpoint`、`getLastYogaMs`/`getLastCommitMs` 等专项 instrumentation
- **主动内存治理**——compact 边界 `splice` 释放 GC、`combinedAbortSignal` 显式 cleanup

**负面**（fork 二次开发引入）：
- **fork 遗留废弃 API 未清理**——十余处 `_DEPRECATED` 接口仍被主路径调用，非真正废弃而是「待迁移」
- **死分支未清**——`providers.ts` 的 `if (false)` 是删除 bedrock/vertex 支持时的残留，类型与实现脱节
- **类型逃逸集中**——`as any`/`@ts-expect-error` 集中于 Bun runtime bug workaround 与 react-reconciler 版本漂移，技术债显性但未消除
- **命名双轨**——`FUSION_*` 与 `ANTHROPIC_*` env 并行，重命名未贯彻到底

**风险分布**

**系统性风险**（影响全局）：
1. bypassPermissions 跨进程透传链（swarm/SSH/direct-connect 自动继承）
2. env 密钥读取面广（主进程内任意能写 `process.env` 的代码可注入/外泄）
3. main.tsx 上帝文件（改动 blast radius 极大）

**局部风险**（影响特定路径）：
- stdin 监听器清理不全（`main.tsx:887`、`systemThemeWatcher.ts:164`）
- module-scope 持久状态累积（`history.ts:skippedTimestamps`、`relay.ts:states` Map）
- tree-sitter 加载失败时 BashTool 降级到 legacy 弱安全路径

**已识别并治理的风险**（团队有意识）：
- Bun `AbortSignal.timeout` 定时器 native 内存累积 → 改 `setTimeout`+`clearTimeout`
- GitHub Actions 下子进程 `${FUSION_API_KEY}` 注入 → `subprocessEnv.ts` scrub
- compact 后长会话内存增长 → 边界 `splice` 主动 GC

### 8.3 与同类项目对标

| 对比项 | Fusion-Code | Anthropic Claude Code（上游） | 一般 OSS AI CLI |
|---|---|---|---|
| 工程体量 | ~1800 文件 | ~1800 文件（继承） | 100-500 文件 |
| 注释密度 | 极高（继承） | 极高 | 中 |
| 安全纵深 | 强（继承）+ 中（新增） | 强 | 弱-中 |
| 本地推理 | ✅ MLX 嫁接 | ❌ | 罕见 |
| 多 provider | 4 活 + 2 死 | 6 活 | 1-2 |
| 技术债 | 高（fork 遗留） | 中 | 低-中 |
| 测试框架 | ❌ 无 | ❌ 无（上游也无） | 通常有 |

**对标结论**：Fusion-Code 的质量**主要继承自上游 Anthropic Claude Code 的工程 rigor**，新增部分（MLX、中文适配、swarm）质量参差——MLX adapter 与 compact tier 化（HEAD commit）显专业，但 providers 死锁与 env 双轨显仓促。

### 8.4 质量演进判断

基于 git HEAD（`release: v0.2.3`）与 working tree：

- **演进方向正确**：最近 commit 聚焦 MLX 32K 上下文窗口的 compact tier 化，是务实性能优化
- **技术债在累积而非收敛**：compact.ts 与 query.ts 持续更新，但 `_DEPRECATED` 接口、`if(false)` 死分支、env 双轨等问题未见对应 commit 治理
- **无测试/lint 兜底**（CLAUDE.md 明示「No test framework or linter is configured」）——**质量完全依赖人工 review**，fork 遗留问题无自动化兜底

### 8.5 整体质量结论

**Fusion-Code 是一个功能完备、安全纵深强、但技术债显性的 fork 二次开发产物。**

| 维度 | 结论 |
|---|---|
| **可用性** | ✅ 可用于生产，核心路径（Query/compact/安全）经上游验证 |
| **可维护性** | ⚠️ 中下，上帝文件 + 废弃 API + 死分支，改动 blast radius 大 |
| **可演进性** | ⚠️ 中，无测试/lint，fork 上游升级需手工 merge，新增质量参差 |
| **安全可信** | ✅ 命令/路径/SSRF/凭据纵深强；⚠️ bypass 透传链与 env 密钥面广是系统性风险 |
| **性能可信** | ✅ 有 profiling 文化，关键路径已治；⚠️ 同步 IO 残留与模块副作用未清 |
| **内存可信** | ✅ AbortController 与 compact GC 主动；⚠️ module-scope 状态与 stdin 监听器清理不全 |

**总评**：**B 级（3.68/5），合格偏上**。在 fork 二次开发产物中属上乘，但若不持续治理技术债（移除死分支、收敛废弃 API、拆分上帝文件、统一命名），随上游演进会加速腐化。

**建议优先级**：先治「系统性风险」（bypass 透传链审计、env 密钥收敛）与「架构死锁」（providers.ts `if(false)`），再清技术债（`_DEPRECATED` 迁移、main.tsx 拆分），最后补自动化兜底（引入 linter 与关键路径单测）。

---

## 九、审计说明与局限

- 本次审计为**静态只读审视**，未运行 `bun run build` / `bun run dev` / 任何测试（项目无测试框架与 linter，CLAUDE.md 明示）。
- 审计覆盖 `src/` 下 1800+ 文件的关键模式（grep/list_symbols/read_symbol 抽样），**未逐文件通读**；遗漏的局部问题可能存在。
- 风险等级为审计员基于代码模式的主观判断，未经动态验证。
- 报告未修改任何代码，符合「只输出审计报告，不改代码」要求。

---

**审计员**：AtomCode（deepseek-v4-flash）
**报告完成日期**：2026-07-25
