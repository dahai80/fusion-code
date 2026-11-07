---
doc_id: fusion-code/get-started
product: fusion-code
class: app
entry: guided-ui
doc_type: get-started
title: { zh: "快速开始", en: "Get Started" }
audience: engineer
status: draft
version: 0.5.22
updated: 2026-11-07
owner: @dahai
source_of_truth:
  - README.md
---

# 快速开始 / Get Started

前提:Bun >= 1.3.11(`curl -fsSL https://bun.sh/install | bash`);macOS Apple Silicon 用于本地 MLX,其他平台走云端供应商。

## 1. 构建一次

```bash
git clone https://github.com/dahai80/fusion-code.git
cd fusion-code
bun install
bun run build
```

产出二进制 `./fusion-code`。升级:`git pull && bun install && bun run build`。

## 2. 选择模型供应商(二选一)

本地 MLX(无需云端 key,Apple Silicon):

```bash
export FUSION_MLX_ENABLED=1
# 可选:固定模型
export FUSION_MLX_MODEL="qwen2.5-coder-7b-instruct"
```

云端/代理(任何 Anthropic 兼容端点):

```bash
export FUSION_CLIENT_KEY="sk-..."          # 直连时唯一必填项
# 可选:代理/LiteLLM
export FUSION_BASE_URL="http://your-proxy:4000/v1"
```

凭据只有一个规范名:`FUSION_CLIENT_KEY`(`FUSION_AUTH_TOKEN` 等价)。旧名 `FUSION_GATEWAY_API_KEY` 已废弃,会话内会告警一次。

## 3. 启动并走完第一个回合

```bash
./fusion-code
```

界面出现后(截图见 [img/](img/)):

1. 顶部状态栏确认供应商与模型;`/env` 可随时查看。
2. 输入一个任务,例如 `修复 tests/utils/tool.test.ts 中失败的用例并解释原因`。
3. 按 **Shift+Tab** 把权限模式切到 **Auto**:安全命令自动放行,危险命令(`rm -rf`、`git push --force` 等)仍会询问,不可逆命令硬拒绝。
4. 每次工具调用出现提示时逐条批准;文件改动可在 diff 视图中确认。
5. 结束后 `/usage` 看本次 token 消耗,`/undo` 可回退到锚点。

一次性模式(CI/脚本):`./fusion-code -p "explain this code"`,可用 `--max-turns`、`--max-duration` 设置预算。

## 4. 可选:Web 工作台

```bash
cd web && ./start.sh start   # http://127.0.0.1:11482
```

浏览器中管理仓库、会话、diff 与 checkpoint。停止:`web/start.sh stop`。

## 5. 常用命令速查

| 命令 | 作用 |
|---|---|
| `/model` | 切换/查看模型 |
| `/doctor` | 诊断环境问题 |
| `/env` | 显示供应商与关键环境变量 |
| `/focus on` | 折叠冗长工具输出 |
| `/audit --last 20` | 查看最近 20 条操作审计 |
| `/undo [N]` | 回退 N 个锚点 |

下一步:[troubleshooting.md](troubleshooting.md) 解决启动/连接问题;[docs/model-providers.md](model-providers.md) 有全部供应商细节。
