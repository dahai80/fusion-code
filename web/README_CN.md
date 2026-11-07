---
doc_id: fusion-code/readme
product: fusion-code
class: app
entry: guided-ui
doc_type: readme
title: { zh: "fusion-code Web 工作台（中文）", en: "fusion-code web workbench (Chinese)" }
audience: engineer
status: draft
version: 0.5.22
updated: 2026-11-07
owner: @dahai
source_of_truth:
  - web/README_CN.md
---

# Fusion Code Web GUI

fusion-code 内核之上的会话中心 Web 工作台（issue #228 决策 DC-1、#229 检查点/验证/回滚/diff/PR、#230 用量视图）。内核保持跨平台 CLI 不变 —— 本薄壳编排内核子进程，在浏览器中呈现会话、步骤与文件改动。

## 视图

- `/sessions` — 按仓库分组的会话列表 + 新会话输入行（仓库/分支选择，帧 C1）
- `/session/:id` — 对话 + 行内每步命令 + 右栏实时文件改动与单文件 diff 查看器 + 检查点（验证/回滚）+ PR 流程 + 权限面板 + 追加指令输入（帧 C2）
- `/repos` — 仓库连接（本地 git 路径或克隆 URL）+ 分支概览 + 每仓库验证命令
- `/usage` — 按仓库与会话聚合的 token/成本统计（#230）
- `/settings` — 权限模式语义 + 环境模板说明

## 架构

```
浏览器 ── 同源 /api + /ws ──> Web 后端（Bun，端口 11482）
                                ├─ store: 仓库/会话/权限（~/.fusion-code/web）
                                ├─ git: 每仓库 status/diff/branches
                                ├─ runner: 每次运行一个内核子进程
                                │    fusion-code -p <消息> --output-format stream-json
                                │    --verbose [--resume <内核会话 id>]
                                │    [--allowedTools ...]  (cwd = 仓库路径)
                                └─ gateway: manifest 注册 + 15s 心跳
```

关键性质：

- **服务端持有运行** —— 浏览器断开不会杀掉运行；事件按会话环形缓冲，WS 重连后回放。
- **会话连续性** —— 首次运行把 Web 会话与内核会话 id 关联（init 事件）；后续指令以 `--resume` 拉起内核，上下文跨轮保留。
- **内核零改动** —— Web 层只使用既有 CLI 参数与会话 JSONL 布局，未修改内核代码。
- **权限** —— 每会话允许列表（`--allowedTools`），默认只读；“每次确认”模式仅允许只读工具，拒绝会在会话内提示。

## 检查点、验证、回滚、PR（#229）

每条用户指令即一个检查点。runner 以 `FUSION_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1` 拉起内核，内核在每次提交指令时快照工作区；指令 uuid 在每轮结束后从会话 JSONL 同步（真实内核不会在 stream-json 里回显指令文本）。

- **验证** —— 运行仓库的验证命令（在 `/repos` 配置，如 `bun test`），把通过/失败与输出记录到检查点。
- **回滚** —— `fusion-code --resume <内核会话 id> --rewind-files <指令 uuid>` 把已跟踪文件还原到该指令提交时的状态（独立内核操作，不调模型），完成后改动栏刷新。
- **Diff 查看器** —— 点击任一改动文件查看 unified diff（已跟踪：vs HEAD；未跟踪：按新文件渲染）。
- **PR 流程** —— 建分支（`fusion-code/web-<会话前缀>`）+ `git add -A` + commit + push + `gh pr create`，PR URL 落到会话上。干净工作区在 commit 前即被拒绝（用与 locale 无关的 `git diff --cached --quiet` 判断）。

## 用量（#230）

每轮结果消息携带 `usage` + `total_cost_usd`；服务端记录每轮 `TurnUsage`，`GET /api/usage` 按仓库与会话聚合出 `/usage` 视图。本地模型成本为 0。

## API

在 #228（`/health`、`/manifest.json`、`/api/repos`、`/api/sessions`、`/api/sessions/:id/{,/permissions,/run}`、`/ws/:id`）之上新增：

| 端点 | 用途 |
|---|---|
| `PATCH /api/repos/:id` | 更新名称 / 验证命令 / 环境 |
| `GET /api/sessions/:id/diff?path=` | 单个改动文件的 unified diff |
| `POST /api/sessions/:id/checkpoints/:uuid/verify` | 运行仓库验证命令 |
| `POST /api/sessions/:id/checkpoints/:uuid/rollback` | 内核 `--rewind-files` 还原 |
| `POST /api/sessions/:id/pr` | 建分支 + commit + push + `gh pr create` |
| `GET /api/usage` | token/成本聚合（#230） |

## 命令

```bash
cd web
bun install
bun run dev        # Vite 开发服务器 11482（/api + /ws 代理到后端）
bun run start      # 生产：后端直服 dist + API + WS，端口 11482
bun run build      # typecheck + vite build -> dist/
bun run typecheck  # tsc --noEmit
bun run lint       # biome check src server
bun test tests     # 单测 + 链路测试（mock 内核 + 真实 git 仓库）
```

开发模式：先 `FUSION_CODE_WEB_PORT=11483 bun run start` 起后端，再 `bun run dev`（Vite 把 `/api` + `/ws` 代理到 `FUSION_DEV_BACKEND`，默认 `http://127.0.0.1:11483`）。

## 环境变量

| 变量 | 默认值 | 用途 |
|---|---|---|
| `FUSION_CODE_WEB_PORT` | `11482` | 后端端口（port-registry 属主 `fusion-code-web`） |
| `FUSION_CODE_WEB_BIND` | `127.0.0.1` | 绑定地址 |
| `FUSION_CODE_WEB_DATA_DIR` | `~/.fusion-code/web` | 存储位置（仓库/会话/权限） |
| `FUSION_CODE_WEB_KERNEL_BIN` | 仓库内 `./fusion-code` 二进制 | 内核二进制（可为带空格的命令） |
| `FUSION_CODE_WEB_CLONE_DIR` | `~/fusion-code-repos` | git URL 连接的克隆目标目录 |
| `FUSION_CODE_WEB_GH_BIN` | `gh` | PR 流程使用的 `gh` 二进制（测试可用 shim 覆盖） |
| `FUSION_SHELL_GATEWAY_URL` | 未设 | Gateway 地址 —— 设置后启用 manifest 注册 |
| `FUSION_ADMIN_KEY` | 未设 | Gateway 管理密钥（Bearer），用于注册 + 心跳 |

内核所需环境（模型端点、密钥）从服务进程继承 —— `bun run start` 前导出 `FUSION_BASE_URL` / `FUSION_CLIENT_KEY`（或 gateway 相关变量）。

## Gateway 注册

设置 `FUSION_SHELL_GATEWAY_URL` + `FUSION_ADMIN_KEY` 后，服务启动时把 `manifest.json` POST 到 gateway（`POST /api/v1/shell/manifests`）并维持 15s 心跳；shell 侧栏出现 `⌨ Code` 菜单，`/shell/fusion-code/` 代理到本后端。

## 测试

`bun test tests` 覆盖：store 持久化 + 会话/内核 id 关联、真实临时仓库上的 git 辅助函数、mock 内核下的 runner 编排（事件、无订阅者缓冲、并发运行拒绝）、检查点捕获与回滚 argv、验证命令通过/失败、裸 origin + gh shim 下的 PR 流程、用量聚合、以及全链路 HTTP+WS 冒烟（health、manifest、UC-C1 步骤 2-5、diff/验证/用量/回滚走真实链路）。
