---
doc_id: fusion-code/troubleshooting
product: fusion-code
class: app
entry: guided-ui
doc_type: troubleshooting
title: { zh: "故障排查", en: "Troubleshooting" }
audience: engineer
status: draft
version: 0.5.22
updated: 2026-11-07
owner: @dahai
source_of_truth:
  - README.md
---

# 故障排查 / Troubleshooting

先跑 `/doctor`(REPL 内)或 `./fusion-code /doctor`——它覆盖下面大部分检查。

## 启动与构建

**`bun run build` 失败**

1. 确认 Bun 版本:`bun --version` 必须 >= 1.3.11(`engines` 字段强制)。
2. 依赖不完整时重装:`rm -rf node_modules && bun install`。
3. TypeScript 报错:`bun run typecheck` 单独看错误;`bun run check` 是 typecheck + lint + 分层检查 + 构建的全量门禁。

**`./fusion-code` 启动即崩溃(Ink 报错)**

- `Text string " " must be rendered inside <Text>` 这类报错历史上由 REPL 首屏片段裸字符串引起(见 README v0.3.4 补丁记录)。用 `bun run build` 重新构建后再试;若复现,带 `bun run build:dev` 产物 `./fusion-code-dev --version` 的输出发 issue。

## 模型连接

**启动提示 provider 认证错误**

- 供应商选择优先级:设置了 `FUSION_CLIENT_KEY`(或合法 `ANTHROPIC_API_KEY`)→ 直连;设置了 `FUSION_MLX_ENABLED=1` / `FUSION_GATEWAY_URL` / `FUSION_MLX_BASE_URL` → 本地 MLX(`127.0.0.1:11432`);都没有 → 报认证错误。启动调试行会打印激活的 provider、base URL 和凭据**名称**(不打印值)。
- 本地 MLX 模式下 `ANTHROPIC_API_KEY` 被忽略(shell 残留的云端 token 不会打到本地网关,#221)。确要复用设 `FUSION_ALLOW_ANTHROPIC_TOKEN_LOCAL=1`。

**本地 MLX 连不上**

```bash
# 1. 服务是否在监听 11432
curl -s http://127.0.0.1:11432/api/tags | head
# 2. 远程 MLX:显式指定地址
export FUSION_MLX_BASE_URL="http://192.168.1.10:11432"
```

- 11432 是 Ollama 兼容端口,本机 Ollama 也可直接服务。
- 模型未加载时 `/model-status` 查看已加载模型与显存。

**流式响应卡死后自动中断**

- 流空闲看门狗默认 5 分钟(`FUSION_STREAM_IDLE_TIMEOUT_MS`)后中止挂起连接。长思考模型可调大或 `FUSION_DISABLE_STREAM_WATCHDOG=1` 关闭。
- 429/529 时自动回退到 fallback 模型(opus→sonnet→haiku),可用 `FUSION_FALLBACK_MODEL` 覆盖。

## 权限与安全

**Auto 模式下命令仍被询问**:`classifyAllShell` 是确定性分类器,未知命令默认要求确认,`rm -rf`/`sudo`/`git push` 等永远询问,`git push --force` 等不可逆命令硬拒绝。这不是 bug;会话内放行用 `/approve-session <tool>`。

**读取敏感文件被拒**:`.env`、SSH 私钥、`.pem`、`.key`、AWS 凭据等全局封禁,任何 FUSION.rules 都不能覆盖(README v0.4.4 §5)。

**操作被限流**:写操作 50 次/分、执行 50 次/分;API 服务 120 req/min/IP(429)。等待窗口或拆分任务。

**FUSION.rules 没生效**:优先级为 全局 `~/.fusion-code/FUSION.rules` → 项目 `FUSION.rules` → `CLAUDE.md` → `.fusion-code/rules/*.md` → `CLAUDE.local.md`;确认文件位置与 frontmatter(`denied_tools`、`default_template`)写法(见 `FUSION.rules.example`)。

## Web 工作台(11482)与服务模式(11441)

**`web/start.sh start` 拒绝启动**:端口注册表自检失败——确认 `~/fusion/architecture/port-registry.yaml` 中 `fusion-code-web` 声明了 11482,或临时 `FUSION_SKIP_REGISTRY_CHECK=1`。

**`--serve` 401**:服务默认 fail-closed,token 在 `~/.fusion-code/server.token`;显式传 `--auth=<token>` 或 `FUSION_CODE_AUTH_TOKEN`。仅开发环境可 `FUSION_CODE_NO_AUTH=1`。

## 诊断数据去哪了

| 数据 | 位置 |
|---|---|
| 审计日志 | `~/.fusion-code/audit/`(JSONL,`/audit --last N --tool NAME --op read\|write\|execute\|denied`) |
| 会话轨迹 | `~/.fusion/trajectories`(`trajectory manifest` 查看) |
| 运行日志 | `logs/stdout.log`、`logs/stderr.log` |
| 工作流模板 | `~/.fusion-code/templates/`(全局)、`.fusion/templates/`(项目) |

仍未解决:开 issue 时附上 `/doctor` 输出、`/env` 输出(确认无 key 值)与对应时间段的 `logs/stderr.log` 片段。
