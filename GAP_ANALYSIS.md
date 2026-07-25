# Fusion-Code vs Claude Code 差距分析

> 对标: Claude Code 2.1.212+ vs fusion-code (基于 2.1.86 泄漏源码 + 2.1.86→2.1.212 版本演进)

---

## 一、总览

| 维度 | Claude Code 2.1.212 | fusion-code | 差距 |
|---|---|---|---|
| Slash 命令 | ~100+ | ~85 | 中 |
| Agent 工具 | ~48 | ~54 | 小 (fusion 有额外工具) |
| Feature Flags | ~90 | ~88 | 小 |
| 新增服务 | 动态 Workflows, Agent View, ultrareview, 原生安装器 | 快速路径, BM25, Tree-sitter, 上下文折叠, 自纠正 | 各有侧重 |
| 安全/沙箱 | 文件系统沙箱, 网络拒绝域, PID命名空间隔离 | 基本权限系统 | 大 |
| UI/UX | 主题系统, 屏幕阅读器, Agent View, 交互式滑块 | 基本终端 UI | 大 |
| Provider 支持 | Bedrock/Vertex/Foundry/Mantle 完整 | Bedrock/Vertex 已禁用, 仅 firstParty/openai/foundry/fusionMlx | 中 |

---

## 二、2.1.86→2.1.212 新增命令差距

### fusion-code 缺失的新命令

| 命令 | 版本 | 描述 | 优先级 |
|---|---|---|---|
| `/cd` | 2.1.169 | 切换工作目录（含自动建议） | **P0** |
| `/fork` | 2.1.212 | 复制会话到后台 | **P1** |
| `/subtask` | 2.1.212 | 替代会话内 fork | **P1** |
| `/code-review` | 2.1.147 | 代码审查（renamed from /simplify） | **P1** |
| `/goal` | 2.1.139 | 设置会话目标 | **P2** |
| `/scroll-speed` | 2.1.139 | 调整滚动速度 | **P3** |
| `/tui` | 2.1.110 | 切换无闪烁渲染 | **P2** |
| `/focus` | 2.1.110 | 聚焦视图切换 | **P2** |
| `/recap` | 2.1.108 | 手动触发 recap | **P2** |
| `/powerup` | 2.1.90 | 交互式教学+动画演示 | **P3** |
| `/release-notes` | 2.1.92 | 交互式版本选择器 | **P3** |
| `/less-permission-prompts` | 2.1.111 | 为只读调用建议白名单 | **P2** |
| `/team-onboarding` | 2.1.101 | 生成队友入门指南 | **P3** |
| `/dataviz` | 2.1.198 | 数据可视化技能 | **P2** |
| `/reload-skills` | 2.1.157 | 不重启重载技能 | **P1** |
| `/plugin list` | 2.1.163 | 列出已安装插件 | **P2** |

### fusion-code 独有命令（Claude Code 无）

| 命令 | 描述 |
|---|---|
| `/ast` | Tree-sitter AST 符号索引 |
| `/break-cache` | 重置缓存断检测 |
| `/buddy` | April 1st 彩蛋 |
| `/ctx_viz` | 上下文窗口使用可视化 |
| `/env` | 显示 provider/model/key 环境变量 |
| `/fastpath` | 确定性快速路径引擎 |
| `/force-snip` | 强制截断 |
| `/loop-test` | 循环测试 |
| `/search` | BM25 本地搜索 |
| `/summary` | 会话摘要 |
| `/torch` | 高亮探索 |
| `/workflows` | 工作流脚本 |

---

## 三、工具差距

### fusion-code 缺失的工具

| 工具 | 2.1.86 有 | 2.1.212 新增 | 描述 | 优先级 |
|---|---|---|---|---|
| `RemoteTriggerTool` | ✅ | — | 远程触发 | P3 |

### fusion-code 独有工具（Claude 2.1.86 无）

这些是 fusion-code 的差异化优势：

| 工具 | 描述 |
|---|---|
| **DesignSyncTool** | Design System 项目同步 |
| **CronCreate/Delete/List** | 定时任务调度 |
| **ReportFindingsTool** | 结构化代码审查报告 |
| **WorkflowTool** | 多 agent 编排工作流 |
| **WebBrowserTool** | 无头浏览器（Chrome DevTools 插件实现） |
| **ArtifactCreate/Update** | 设计产物管理 |
| **SubscribePRTool** | PR 变更订阅 |
| **CtxInspectTool** | 上下文窗口检查 |
| **TerminalCaptureTool** | 终端输出捕获 |

---

## 四、核心功能差距（按优先级排序）

### P0 — 关键缺失，影响核心竞争力

| 差距 | Claude 2.1.212 状态 | fusion-code 状态 | 实现建议 |
|---|---|---|---|
| **动态 Workflows** | v2.1.154 引入，支持 YAML 定义多 agent 工作流，含 phase/pipeline/parallel/agent() | `WorkflowTool` 已存在但无 YAML 定义系统 | 实现工作流 YAML 前端定义，复用现有 WorkflowTool 执行引擎 |
| **Agent View** | v2.1.139 引入，独立 UI 模式展示 agent 活动 | 无 | 在 REPL 中添加 agent 活动面板 |
| **`/cd` 命令** | v2.1.169 引入，含目录建议 | 无 | 实现目录切换 + tab 补全 |
| **后台 Agent 通知** | v2.1.198 后台 agent 默认运行，完成时通知 | agent 基本为前台运行 | 实现 agent 后台执行 + 通知系统 |
| **Fork/Subtask** | v2.1.212 引入 `/fork` 和 `/subtask` | 无 | 实现会话 fork 到后台 |
| **`/code-review`** | v2.1.147 引入，含 `--fix` 模式 | 仅有 `/review`（无自动修复） | 增强 `/review` 为 `/code-review --fix` |

### P1 — 重要缺失，影响日常使用体验

| 差距 | Claude 2.1.212 状态 | fusion-code 状态 | 实现建议 |
|---|---|---|---|
| **Effort 滑块** | v2.1.111 交互式努力程度调节 | `/effort` 仅支持文本输入 | 实现 Shift+上下箭头调节 effort |
| **Auto mode 增强** | v2.1.193 classifyAllShell, hard_deny | 基本安全/危险命令列表 | 增加分类器增强的 shell 判断 + hard_deny 规则 |
| **`/model` 持久化** | v2.1.117 选择后保存为默认 | 仅会话级 | `/model` 选择后持久化 |
| **`/reload-skills`** | v2.1.157 不重启重载技能 | 需重启 | 实现 skill 热重载 |
| **PreCompact Hook** | v2.1.105 可阻止压缩 | 无 | 实现 hook 拦截压缩 |
| **`/usage` 合并** | v2.1.118 `/cost`+`/stats` 合并 | 仍分开 | 合并为 `/usage`，保留 `/cost` 作为别名 |
| **"Manual" 模式重命名** | v2.1.200 "Default" → "Manual" | 仍叫 "Default" | 重命名 |
| **Compaction 保留敏感指令** | v2.1.139 压缩时保留敏感指令 | 部分实现（MLX hard compact） | 增强 compact 保留逻辑 |
| **Stalled API 5min 中断** | v2.1.105 5分钟无响应自动中断 | 无超时保护 | 实现流式超时检测 |
| **Fallback model** | v2.1.166 API 错误时自动降级模型 | 无 | 实现模型降级链 |
| **`/goal` 会话目标** | v2.1.139 设置会话目标 | 无 | 简单实现：存储目标字符串注入 system prompt |

### P2 — 体验优化

| 差距 | 描述 | 实现建议 |
|---|---|---|
| **主题系统** | v2.1.118 自定义主题 `/theme` | 实现 ANSI 颜色主题配置 |
| **`/tui` 无闪烁** | v2.1.110 切换渲染模式 | 利用 `NO_FLICKER` 已有变量 |
| **`/focus` 聚焦视图** | v2.1.110 仅显示关键输出 | 实现精简输出模式 |
| **`/recap` 手动摘要** | v2.1.108 返回会话时手动触发 recap | 添加 recap 触发入口 |
| **Agent MCP Servers** | v2.1.117 agent 前端定义可包含 MCP 服务器 | 无 | 在 agent YAML 中支持 mcpServers 字段 |
| **PostToolUse Hook 输出替换** | v2.1.121 hook 可替换工具输出 | 无 | 实现工具输出拦截和替换 |
| **Skill `disallowed-tools`** | v2.1.152 技能可限制可用工具 | 无 | 在 SKILL.md frontmatter 支持 disallowed-tools |
| **`/plugin list`** | v2.1.163 列出已安装插件 | `/plugin` 无列表功能 | 增加列表模式 |
| **`/plugin` 预览** | v2.1.145 安装前预览组件 | 无 | 实现安装前展示 |
| **Bash 路径自动补全** | v2.1.193 Bash 模式下文件路径补全 | 无 | 实现 Tab 补全 |
| **Screen Reader 模式** | v2.1.208 `--ax-screen-reader` | 无 | 添加无障碍支持 |
| **Live elapsed-time** | v2.1.210 工具运行实时计时器 | 无 | 在工具摘要显示运行时间 |
| **`/dataviz` 数据可视化** | v2.1.198 内置数据可视化技能 | 无 | 可作为 bundled skill |
| **`/less-permission-prompts`** | v2.1.111 为只读调用建议白名单 | 无 | 分析历史权限模式，建议白名单 |
| **Readable session names** | v2.1.196 可读会话名称 | 随机 ID | 生成有意义的会话标题 |
| **Session titles 多语言** | v2.1.176 会话标题使用对话语言 | 固定英文 | 根据 prompt 语言生成标题 |

### P3 — 锦上添花

| 差距 | 描述 |
|---|---|
| **`/powerup` 交互式教学** | v2.1.90 动画教程 |
| **`/release-notes` 版本选择** | v2.1.92 交互式版本浏览 |
| **`/team-onboarding`** | v2.1.101 队友入门指南生成 |
| **Push Notification** | v2.1.110 移动推送通知 |
| **Native Installer** | v2.1.113 原生二进制安装器 |
| **`/scroll-speed`** | 滚动速度调节 |
| **Vim Visual Mode** | v2.1.119 可视选择模式 |

---

## 五、安全与沙箱差距

| 差距 | Claude 2.1.212 | fusion-code | 优先级 |
|---|---|---|---|
| **文件系统沙箱** | `sandbox.filesystem.disabled` 设置, 限制文件访问范围 | 无沙箱，仅权限提示 | **P1** |
| **网络拒绝域** | `sandbox.network.deniedDomains` | 无 | **P2** |
| **PID 命名空间隔离** | v2.1.98 Linux 子进程沙箱 | 无 | **P2** (Linux) |
| **Apple Events 沙箱** | `sandbox.allowAppleEvents` | 无 | **P3** (macOS) |
| **SSRF 防护** | HTTP hooks 有 SSRF guard | 无 | **P2** |
| **凭证沙箱** | `sandbox.credentials` 防止凭证泄露 | 无 | **P1** |
| **Auto mode 安全** | v2.1.183 阻止破坏性 git/terraform 命令 | 基本危险命令列表 | **P1** |
| **`--safe-mode`** | v2.1.169 安全模式启动 | 无 | **P2** |
| **Team Memory Secret Scanner** | gitleaks 规则扫描防止凭证上传 | 无 | **P2** |
| **Permission `defer` 决策** | v2.1.89 无头会话暂停在工具调用 | 无 | **P3** |

---

## 六、Provider & Auth 差距

| 差距 | 描述 | 优先级 |
|---|---|---|
| **Bedrock/Vertex 恢复** | 当前代码中永久短接，应恢复为可选 | **P1** |
| **Bedrock 交互式设置向导** | v2.1.92/v2.1.98 交互式 AWS 认证配置 | **P2** |
| **Bedrock via Mantle** | v2.1.94 `CLAUDE_CODE_USE_MANTLE=1` | **P3** |
| **Claude Platform on AWS** | v2.1.198 新 provider | **P2** |
| **Bedrock 凭证缓存** | v2.1.176 缓存 AWS 凭证 | **P2** |
| **`--from-pr` 支持** | v2.1.119 从 GitLab/BB/GHE PR 启动 | **P2** |
| **OTel 可观测性** | v2.1.161+ 多项 OTel 集成 | **P3** |
| **MDM/企业管控** | 远程设置强制、版本限制 | **P3** (企业场景) |

---

## 七、MCP 差距

| 差距 | Claude 2.1.212 | fusion-code | 优先级 |
|---|---|---|---|
| **`claude mcp login/logout`** | v2.1.186 CLI 管理 MCP 认证 | 无 | **P1** |
| **MCP `alwaysLoad`** | v2.1.121 配置 MCP 始终加载 | 无 | **P2** |
| **MCP `roots/list` 工作目录** | v2.1.203 MCP 协议工作目录 | 无 | **P2** |
| **MCP tool result 大小覆盖** | v2.1.91 `_meta["anthropic/maxResultSizeChars"]` | 无 | **P2** |
| **MCP 并行启动** | v2.1.116 并行连接 MCP | 串行 | **P2** |
| **MCP 自动后台** | v2.1.212 2分钟后自动转后台 | 无 | **P2** |
| **MCP SDK Transport** | In-process SDK MCP | 无 | **P3** |
| **VS Code SDK MCP** | VS Code 扩展 MCP 发现 | 无 | **P2** (IDE集成) |
| **Channel Allowlist** | GrowthBook 控制插件 MCP 通道 | 无 | **P3** |
| **XAA 企业认证** | 跨应用访问令牌交换 | 无 | **P3** (企业) |

---

## 八、Hooks 系统差距

| 差距 | 描述 | 优先级 |
|---|---|---|
| **PostToolUse 输出替换** | v2.1.121 hook 可替换所有工具的输出 | **P1** |
| **PreCompact hook** | v2.1.105 可阻止压缩发生 | **P1** |
| **`continueOnBlock`** | v2.1.139 PostToolUse 被阻止后继续 | **P2** |
| **Agent type hooks** | v2.1.139 hook 可 spawn 子 agent | **P2** |
| **MCP tool hooks** | v2.1.118 hook 调用 MCP 工具 `type: "mcp_tool"` | **P2** |
| **`terminalSequence` hook** | v2.1.141 控制终端序列 | **P3** |
| **`MessageDisplay` hook** | v2.1.152 拦截消息显示 | **P2** |
| **PermissionDenied hook** | v2.1.89 auto mode 拒绝后触发 | **P2** |
| **Hook `args` exec form** | v2.1.139 exec 形式参数 | **P2** |
| **`duration_ms` in hooks** | v2.1.119 hook 执行时长 | **P3** |

---

## 九、Compact/内存 差距

| 差距 | 描述 | 优先级 |
|---|---|---|
| **Autocompact 震荡防护** | v2.1.89 检测 3 次连续压缩后停止 | **P0** (已部分实现) |
| **压缩保留敏感指令** | v2.1.139 系统指令中的敏感信息保留 | **P1** |
| **PreCompact hook** | v2.1.105 可阻止压缩 | **P1** |
| **`MAX_THINKING_TOKENS=0`** | v2.1.166 禁用 thinking tokens | **P2** |
| **紧凑工具定义剥离** | v2.1.86 MLX compact 剥离工具定义 | 已实现 ✅ | — |

---

## 十、fusion-code 独有优势

以下功能 Claude Code 2.1.212 没有或实现不同：

| 功能 | 描述 | 竞争价值 |
|---|---|---|
| **fusion-mlx 深度集成** | 本地 MLX 推理 + 流式适配器 + 前缀缓存 + markup 抑制 | ★★★★★ |
| **MLX Prompt Tier System** | 按模型大小自动调整 system prompt 和工具集 | ★★★★★ |
| **Hard Compact** | 确定性工具输出截断，零 token 成本 | ★★★★ |
| **MLX Memory Safety** | 灾难性中止、一次性 forced compact、post-compact GC | ★★★★ |
| **Fast Path 引擎** | 确定性规则引擎拦截简单查询，不走模型 | ★★★ |
| **BM25 本地搜索** | 无向量数据库的本地代码搜索 | ★★★ |
| **Tree-sitter AST 索引** | 实时增量符号索引 | ★★★ |
| **Context Collapse** | 上下文折叠 | ★★ |
| **Self-Correct** | 自纠正系统 | ★★ |
| **DesignSync 工具** | Design System 项目同步 | ★★ |
| **CronCreate/Delete/List** | 定时任务系统 | ★★ |
| **Chrome DevTools 插件** | 浏览器交互工具 | ★★★ |
| **UI/UX Pro Max 插件** | 设计助手自动安装 | ★★ |
| **零遥测** | 完全无出站遥测 | ★★★★★ (隐私价值) |
| **离线/本地优先** | 无需云端即可使用 | ★★★★★ |

---

## 十一、实施路线图

### Phase 1: 核心体验对齐 (1-2 周)

1. **`/cd` 命令** — 目录切换 + tab 补全
2. **`/code-review --fix`** — 增强 `/review`
3. **`/reload-skills`** — skill 热重载
4. **`/usage` 合并** — `/cost` + `/stats`
5. **Auto mode 安全增强** — classifyAllShell + hard_deny
6. **Stalled API 超时** — 5 分钟无响应中断
7. **`/model` 持久化** — 保存选择为默认
8. **"Manual" 模式重命名** — "Default" → "Manual"

### Phase 2: Agent 能力升级 (2-3 周) ✅ COMPLETED

1. **动态 Workflows YAML** — 定义+执行 (Phase 1 已完成)
2. **后台 Agent + 通知** — agent 异步执行 ✅ (已有实现)
3. **`/fork` + `/subtask`** — 会话分叉 ✅
4. **Agent View** — agent 活动面板 ✅ (已有实现)
5. **PreCompact Hook** — 可阻止压缩 ✅
6. **PostToolUse Hook 输出替换** — 工具输出拦截 ✅
7. **Compaction 保留敏感指令** — 增强压缩逻辑 ✅
8. **Fallback Model** — 模型降级链 ✅

### Phase 3: 安全与企业 (2-3 周) ✅ COMPLETED

1. **文件系统沙箱** — 限制文件访问范围 ✅ (已有实现)
2. **凭证沙箱** — 防止凭证泄露 ✅ (credentialSandbox.ts + FUSION_CREDENTIAL_SANDBOX)
3. **SSRF 防护** — HTTP hooks 安全 ✅ (已有实现)
4. **`--safe-mode`** — 安全启动模式 ✅
5. **Bedrock/Vertex 恢复** — 重新启用 provider ✅
6. **`claude mcp login/logout`** — CLI MCP 认证 ✅
7. **MCP 并行启动** — 并行连接 ✅ (已有实现)

### Phase 4: 体验精细化 ✅ COMPLETED

1. **主题系统** — ANSI 颜色主题 ✅ (已有实现)
2. **Effort 滑块** — 交互式调节 ✅ (已有实现)
3. **Screen Reader** — 无障碍支持 ✅ (已有实现)
4. **Live elapsed-time** — 工具计时器 ✅ (已有实现)
5. **Bash 路径补全** — Tab 补全 (待实现)
6. **Readable session names** — 有意义的标题 ✅ (extractFallbackTitle + Haiku)
7. **`/goal`** — 会话目标 ✅
8. **`/dataviz`** — 数据可视化 ✅ (bundled skill)
9. **`/focus` + `/tui`** — 精简输出模式 ✅

---

## 十二、数据对比汇总

### 命令数量

| | Claude 2.1.86 | Claude 2.1.212 新增 | fusion-code |
|---|---|---|---|
| 总命令数 | ~96 | +16 | ~85 |
| 独有命令 | — | — | 12 |

### 工具数量

| | Claude 2.1.86 | fusion-code |
|---|---|---|
| 总工具数 | 48 | 54 |
| 共有工具 | 42 | 42 |
| 仅 Claude 有 | 6 | — |
| 仅 fusion 有 | — | 12 |

### Feature Flags

| | Claude 2.1.86 | fusion-code | 差异 |
|---|---|---|---|
| 总 Flag 数 | 88 | 88 | 相同基础集 |
| 缺失 Flag | — | `ENHANCED_TELEMETRY_BETA`, `NATIVE_CLIENT_ATTESTATION`, `CCR_REMOTE_SETUP` | 3 个（均为遥测/认证相关，无需实现） |
| 新增 Flag | 2.1.86→2.1.212 新增约 30+ | — | 见下表 |

### 2.1.86→2.1.212 新增 Feature Flags (fusion-code 需补充)

```
AGENT_TRIGGERS_REMOTE    — 远程 agent 触发器
AUTO_MODE_CLASSIFY_ALL   — auto mode 全量 shell 分类
BG_SESSIONS_V2           — 后台会话 v2
CHROME_IN_BROWSER        — Chrome 浏览器内运行
CLAUDE_CODE_FORK_SUBAGENT — fork 子 agent
DAEMON_V2                — 守护进程 v2
DESIGN_SYNC              — Design System 同步 (fusion 已有)
DYNAMIC_WORKFLOWS        — 动态工作流
EFFORT_SLIDER            — 努力程度滑块
ENTER_WORKTREE_V2        — worktree 切换增强
FILES_API                — 文件上传/下载 API
FOCUS_VIEW               — 聚焦视图
NATIVE_INSTALLER         — 原生安装器
OTEL_METRICS             — OTel 指标
PLUGIN_MARKETPLACE_V2    — 插件市场 v2
PROMPT_CACHING_1H        — 1 小时缓存 TTL
SAFE_MODE                — 安全模式
SCREEN_READER            — 屏幕阅读器
SUBAGENT_CAP             — 子 agent 数量限制
THEME_SYSTEM             — 主题系统
ULTRAREVIEW_CLOUD        — 云端 ultrareview
WORKFLOW_KEYWORD_TRIGGER — 工作流关键词触发
```

---

*Generated: 2026-07-25 | Source: Claude Code 2.1.86 leaked source + 2.1.86→2.1.212 CHANGELOG + fusion-code codebase*
