# projectApiServer Playwright E2E Acceptance

端到端验收套件: 真实浏览器 (Chromium) 驱动真实 projectApiServer (11441), WS chat 起真实 fusion-code CLI 子进程连真实 MLX 模型。无 mock,全链路。

## 运行

```bash
bun run test:e2e        # = bunx playwright test --config tests/e2e/playwright.config.ts
```

前置条件:

- `./fusion-code` 已构建 (`bun run build`) — WS chat spawn 的是该二进制
- fusion-mlx 已启动 (`~/fusion/fusion-mlx/start.sh start`), `~/.fusion-mlx/settings.json` 的 `auth.api_key` 存在 (config 自动读取注入)
- Playwright Chromium 已安装 (`bunx playwright install chromium`)

套件自管服务生命周期 (`webServer` 数组):

1. **11441 真实服务** — `start.sh start` 幂等拉起, 内联注入 `FUSION_CODE_AUTH_TOKEN` (固定 e2e token) + `FUSION_MLX_ENABLED=1` + MLX key + 模型; 已在跑则复用 (`reuseExistingServer`)
2. **11496 夹具 origin** — `tests/e2e/fixture-origin-server.mjs`, 只提供第二个 origin 供真实跨源 CORS 测试

## 覆盖面 (29 用例)

| 类别 | 内容 |
|---|---|
| 认证 | 无 token / 错 token 401 (fail-closed) |
| HTTP 契约 | project/context, projects, sessions (含 400/404), memory (GET/POST/校验/路径穿越), model/status (connected:true 真连 MLX), templates, kb, code/generate, lsp, 未知路由 404 |
| CORS | OPTIONS preflight 回显 Origin; 浏览器同源 fetch; 浏览器真实跨源 fetch (Authorization 触发 preflight + ACAO 回显) |
| WS 协议 | 非法 JSON / 缺 message / 未知 action 报错; 错 token 拒绝握手; chat.cancel 无会话不崩 |
| WS 真实模型 | chat.stream 全链路: 真实 CLI 子进程 + 真实 MLX 推理, 断言收到 chat_event 流 + chat_done |

## 设计约束 (踩坑记录)

- **`.e2e.ts` 后缀隔离 runner**: bun test 的文件模式也匹配 `*.spec.ts`, 会把 Playwright spec 当 bun 用例跑并在 `test.beforeAll` 处抛错。e2e 文件统一 `.e2e.ts` + Playwright `testMatch` 显式匹配。
- **不要用 `about:blank` 做浏览器用例页**: 不透明 origin (null) 下 fetch/WS 会被浏览器网络栈整体拒绝 (连 example.com 都 Failed to fetch), 是测试假象。改 goto 服务自身 404 页 (同源) 或夹具 origin (跨源)。
- **ACAO 头浏览器 JS 读不到**: 非 CORS-safelisted response header。跨源用例断言 status 200 + body 可读即可 (CORS 失败 fetch 会 reject)。
- **`request.newContext` 继承 config `use.extraHTTPHeaders`**: 造"无认证上下文"须用 Node 原生 `fetch`。
- **start.sh 不透传调用方 env**: `restart` 会丢环境。改 env 须 `stop` 后带 env `start`。

## 验收中修复的缺陷

1. **`/api/model/status` 硬编码网关 11434/11432 不感知 provider env** — `FUSION_MLX_ENABLED=1` 时返回 `connected:false` (401 拿不到模型表)。改为 provider-aware 解析 (gateway 显式配置优先, 其次 MLX env, 裸默认走网关; key 统一 `FUSION_CLIENT_KEY` 优先, legacy 变量兜底)。
2. **WS chat stderr 管道从不读取** — `--verbose` 子进程向 stderr 大量输出, OS 管道缓冲 (~64KB) 写满后子进程阻塞, stdout 停摆, chat 挂死。修复: 逐行排空 stderr 进调试日志。
