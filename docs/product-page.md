---
doc_id: fusion-code/product-page
product: fusion-code
class: app
entry: guided-ui
doc_type: product-page
title: { zh: "产品页", en: "Product Page" }
audience: engineer
status: draft
version: 0.5.22
updated: 2026-11-07
owner: @dahai
source_of_truth:
  - README.md
---

# fusion-code

一个运行在终端里的本地优先 AI 编码代理。你不再需要在浏览器、云端会话和本地编辑器之间搬运上下文：代理直接在你的仓库、你的 shell、你的模型上工作。

## 它解决什么问题

| 你过去要做的 | fusion-code 接管后 |
|---|---|
| 把代码片段粘贴到网页聊天里,再手工搬回文件 | `./fusion-code` 直接读写仓库文件（Read/Edit/MultiEdit 工具,受权限模式约束） |
| 手动切窗口跑构建、看报错 | 代理通过 Bash 工具执行命令,Auto 模式自动放行安全命令（`classifyAllShell` 确定性分类器） |
| 为不同模型维护多套客户端配置 | 一个 `FUSION_CLIENT_KEY` 覆盖云端直连、代理网关与本地 fusion-mlx（`127.0.0.1:11432`） |
| 小上下文模型动辄溢出 | 按模型规模自动分档（mini/compact/standard/extended/full）,32K 窗口用零 token 成本的硬压缩 |
| 事后无法追溯 AI 改了什么 | JSONL 审计日志写入 `~/.fusion-code/audit/`,自动轮转（10MB × 30 个文件）,`/audit` 可查 |

## 核心能力与边界

- **终端交互界面（Ink/React TUI）**：会话、slash 命令、权限提示都在终端完成。约束：需要支持 ANSI 的终端;不提供 GUI 之外的桌面客户端。
- **本地 MLX 推理**：显式设置 `FUSION_MLX_ENABLED=1` 或 `FUSION_GATEWAY_URL` 才启用,从不自动探测。约束:仅 Apple Silicon 本机或可达的远程 MLX 节点;模型分档由模型规模决定,不可手工覆盖档位表。
- **Web 工作台（`web/`,端口 11482）**：会话列表、逐步命令、文件变更、diff 视图、checkpoint 回滚、PR 流程。约束:浏览器断开后内核会话继续,但 Web 端不替代 TUI 的全部 slash 命令。
- **服务模式（`--serve`,端口 11441）**：HTTP + WebSocket 接口供 fusion-studio 集成,带 Bearer token 认证与 120 req/min/IP 限流。约束:面向本机集成,不是公开 API。
- **轨迹导出**：`trajectory export --format sft|dpo|grpo` 产出训练集,供 fusion-trainer 消费。约束:只汇聚本机 `~/.fusion/trajectories`,不做遥测上传。
- **零遥测**：无外发分析、无崩溃上报。约束:因此问题定位依赖本地日志（`logs/`、`/doctor`）。

## 入口

- 终端: `./fusion-code`（REPL）、`./fusion-code -p "<task>"`（一次性任务）,见 [get-started.md](get-started.md)。
- Web: `web/start.sh`（端口 11482）,见 [web/README.md](../web/README.md)。
- 服务: `./start.sh`（端口 11441）,见 [docs/architecture.md](architecture.md)。

## 适用与不适用

- 适用:本地代码修改、代码审查、重构、测试补齐、会话轨迹沉淀。
- 不适用:需要多人实时共享会话的云端协作;非 Anthropic 兼容协议的模型供应商(OpenAI/Bedrock/Vertex 直连已移除,统一走 `FUSION_BASE_URL`)。
