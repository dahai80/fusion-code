# Enterprise Hardening Guide

> 企业级硬化配置基线 — 沙箱姿态、三层纵深防御、合规配置模板。
> 对应审计 `~/fusion/audit/fusion-code-audit-result-product-0831.md` P1-1 (R4)。
> Schema 语义权威源: `src/entrypoints/sandboxTypes.ts` (`SandboxSettingsSchema`)。

## 1. 沙箱定位

沙箱 (`sandbox`) 是 **opt-in 增强**, 非唯一防线。

- 默认 `enabled: false` — 沙箱关闭, 命令在主进程环境执行。
- 默认 `allowUnsandboxedCommands: true` — fail-open: 沙箱不可用时命令照常运行 (仅告警)。

这是**有意的渐进姿态**, 非缺陷。风险面已由三层纵深防御 (§2) 默认覆盖; 沙箱为可选的第四层加固, 企业按需启用。直接翻默认值 (强制 fail-closed) 会破坏既有用户工作流且需配套权限提示, 故采用文档化路径: 本指南给出企业启用模板 (§3)。

## 2. 三层纵深防御 (默认生效)

无论沙箱是否启用, 以下三层始终生效, 构成风险面主防线:

1. **敏感文件保护** (`src/utils/sensitiveFiles.ts`) — 全局阻断 AI 读取 `.env`、SSH 密钥、凭据、`.pem`、`.key`、`server.token` 等。不可被任何规则覆盖 (P0-1)。
2. **审计日志** (`src/services/audit/auditLog.ts`) — 持久 JSONL 审计日志 (`~/.fusion-code/audit/`), 记录全部工具调用 (read/write/execute/denied) 含 session ID、耗时、成功/错误。10MB 自动轮转, 保留 30 文件。操作速率限制 50 ops/min/类型。`/audit` 命令可查。
3. **权限分类器** — 工具调用按危险度分类: safe 自动批准、dangerous 需用户确认、irreversible hard-deny。`FUSION.rules` `denied_tools` 可项目级禁用工具。Safe Mode (`--safe-mode`) 注入 10 个 disallowed tools 实现 read-only + no-shell + no-network。

沙箱为**第四层可选加固**: 命令级隔离 (文件系统/网络), 减少误操作爆炸半径。启用后建议配合 `autoAllowBashIfSandboxed: true` (沙箱内 bash 自动批准, 因隔离已限风险)。

## 3. 企业配置模板

企业部署通过 managed-settings (`/Library/Application Support/fusion-code/managed-settings.json` on macOS, 对应各平台 MDM 路径) 下发以下基线。沙箱作为硬门: 不可启动则启动失败 (非 fail-open)。

```json
{
    "sandbox": {
        "enabled": true,
        "failIfUnavailable": true,
        "allowUnsandboxedCommands": false,
        "autoAllowBashIfSandboxed": true,
        "enabledPlatforms": ["macos"]
    }
}
```

| 配置项 | 值 | 语义 |
|---|---|---|
| `enabled` | `true` | 启用沙箱命令隔离 |
| `failIfUnavailable` | `true` | 沙箱无法启动时**启动失败** (硬门), 非告警降级 |
| `allowUnsandboxedCommands` | `false` | `dangerouslyDisableSandbox` 参数被忽略, 全部命令必须沙箱内运行 (fail-closed) |
| `autoAllowBashIfSandboxed` | `true` | 沙箱内 bash 自动批准 (隔离已限风险, 减少确认摩擦) |
| `enabledPlatforms` | `["macos"]` | 仅指定平台启用沙箱 (其他平台沙箱关闭); 渐进铺开用 |

> `enabledPlatforms` 为 `passthrough` 读取的未文档化配置 (见 sandboxTypes.ts:104-111 注释), 限定沙箱启用的平台 (如 `["macos"]`)。NVIDIA 企业铺开用此先只在 macOS 启用 `autoAllowBashIfSandboxed`, 待 Linux/WSL 支持成熟再扩。

非企业/个人用户保持默认即可 (沙箱关, 三层纵深仍生效)。

## 4. 沙箱配置项语义

以下语义引自 `src/entrypoints/sandboxTypes.ts` `SandboxSettingsSchema` 的 `.describe` 文案 (权威源, 改 schema 须同步本文档)。

- **`enabled`** (`boolean`, 默认 `false`) — 启用沙箱命令隔离。
- **`failIfUnavailable`** (`boolean`, 默认 `false`) — 启动时若 `sandbox.enabled` 为 `true` 但沙箱无法启动 (缺依赖、平台不支持、平台不在 `enabledPlatforms`), 则**启动报错退出**。为 `false` (默认) 时仅告警, 命令在非沙箱环境运行。面向要求沙箱为硬门的 managed-settings 部署。
- **`allowUnsandboxedCommands`** (`boolean`, 默认 `true`) — 允许命令通过 `dangerouslyDisableSandbox` 参数在沙箱外运行。为 `false` 时该参数被完全忽略, 全部命令必须沙箱内运行。
- **`autoAllowBashIfSandboxed`** (`boolean`, 默认 `false`) — 沙箱启用时自动批准 bash 命令 (隔离已限风险)。
- **`enableWeakerNetworkIsolation`** (`boolean`, 仅 macOS, 默认 `false`) — 允许沙箱访问 `com.apple.trustd.agent`。Go 系 CLI (gh/gcloud/terraform) 经 MITM 代理 + 自定义 CA 校验 TLS 证书时需要。**降低安全性** — 经 trustd 开放潜在数据外泄通道。
- **`excludedCommands`** (`string[]`, 可选) — 排除特定命令不经沙箱。
- **`network` / `filesystem`** — 网络与文件系统隔离细粒度配置 (见 `SandboxNetworkConfigSchema` / `SandboxFilesystemConfigSchema`)。
- **`ignoreViolations`** (`Record<string, string[]>`, 可选) — 按命令忽略特定沙箱违规。

## 5. 已知限制

沙箱平台支持 (引自 `src/utils/sandbox/sandbox-adapter.ts:489-575`):

- **支持**: macOS、Linux、WSL2+。
- **不支持**: WSL1 (`sandbox.enabled` 为 `true` 时报 "WSL1 is not supported (requires WSL2)")。
- **Linux/WSL glob**: bubblewrap 后端不完全支持 glob, glob 模式可能无法完全生效 (adapter.ts:596-601)。

其他限制:

- 沙箱仅隔离命令执行层, 不替代敏感文件保护与审计日志 (三层纵深始终生效)。
- `enableWeakerNetworkIsolation` 降级安全性, 仅在 Go 系 CLI + MITM 代理场景按需启用。
- 非 macOS 平台沙箱支持较新, 建议先用 `enabledPlatforms: ["macos"]` 渐进铺开。

---

**维护**: 改 `src/entrypoints/sandboxTypes.ts` `SandboxSettingsSchema` 或 `src/utils/sandbox/sandbox-adapter.ts` 平台支持时, 须同步本文档 (§4 语义、§5 限制)。
