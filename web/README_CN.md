# Fusion Code Web GUI

fusion-code 内核之上的会话中心 Web 工作台（issue #228，决策 DC-1）。内核保持跨平台 CLI 不变 —— 本薄壳编排内核子进程，在浏览器中呈现会话、步骤与文件改动。

## 视图

- `/sessions` — 按仓库分组的会话列表 + 新会话输入行（仓库/分支选择，帧 C1）
- `/session/:id` — 对话 + 行内每步命令 + 右栏实时文件改动 + 权限面板 + 追加指令输入（帧 C2 v1）
- `/repos` — 仓库连接（本地 git 路径或克隆 URL）+ 分支概览
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
| `FUSION_SHELL_GATEWAY_URL` | 未设 | Gateway 地址 —— 设置后启用 manifest 注册 |
| `FUSION_ADMIN_KEY` | 未设 | Gateway 管理密钥（Bearer），用于注册 + 心跳 |

内核所需环境（模型端点、密钥）从服务进程继承 —— `bun run start` 前导出 `FUSION_BASE_URL` / `FUSION_CLIENT_KEY`（或 gateway 相关变量）。

## Gateway 注册

设置 `FUSION_SHELL_GATEWAY_URL` + `FUSION_ADMIN_KEY` 后，服务启动时把 `manifest.json` POST 到 gateway（`POST /api/v1/shell/manifests`）并维持 15s 心跳；shell 侧栏出现 `⌨ Code` 菜单，`/shell/fusion-code/` 代理到本后端。

## 测试

`bun test tests` 覆盖：store 持久化 + 会话/内核 id 关联、真实临时仓库上的 git 辅助函数、mock 内核下的 runner 编排（事件、无订阅者缓冲、并发运行拒绝）、以及全链路 HTTP+WS 冒烟（health、manifest、UC-C1 步骤 2-5 走真实链路）。
