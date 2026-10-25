# Upstream Provenance & Residue Inventory

Issue #220 compliance record. fusion-code is derived from Claude Code
(AGPL-3.0). Source availability in this repository satisfies AGPL-3.0
disclosure; this document inventories every residual upstream reference and
its justification.

Telemetry decision is in §3. Acceptance grep:
`grep -ri "ant.dev\|claude.com\|claude-ai" src/ --include="*.ts" -l` —
remaining hits map 1:1 to the tables below.

## 1. Removed in #220

| Site | Before | Action |
|---|---|---|
| `src/constants/product.ts` | `PRODUCT_URL = https://claude.com/claude-code` | Points to this repository |
| `src/constants/product.ts` | `CLAUDE_AI_STAGING_BASE_URL = https://claude-ai.staging.ant.dev` | Deleted — Anthropic-internal staging domain, unreachable from fusion builds; staging branch of `getClaudeAiBaseUrl` removed |
| `src/cli/print.ts` (~5450) | `Usage: claude -p --resume <session-id>` | De-branded to `fusion-code` |
| `src/utils/fastMode.ts` | Install URL to `claude.com/product/claude-code` | Points to this repository |
| `src/utils/completionCache.ts` | `Run manually: claude completion ...`, fallback binary `claude` | `fusion-code completion`, fallback `fusion-code` |
| `src/utils/claudemd.ts` header comment | `~/.claude/CLAUDE.md` user memory path | Corrected to `~/.fusion-code/CLAUDE.md` (actual config dir) |

## 2. Justified residue (compatibility shims & functional upstream surfaces)

| Category | Sites | Justification |
|---|---|---|
| `.claude/` project config paths | `utils/markdownConfigLoader.ts`, `utils/permissions/filesystem.ts`, `utils/skills/skillChangeDetector.ts`, `utils/sandbox/sandbox-adapter.ts` | Projects in the wild carry `.claude/commands`, `.claude/agents`, `.claude/settings.json`; reading them is a documented compatibility shim (issue #220 explicitly allows this class) |
| Managed settings path | `utils/settings/managedPath.ts` → `/etc/claude-code` | Enterprise deployments already place managed settings there; path change would silently break MDM deployments. Documented, not changed |
| Anthropic OAuth endpoints | `constants/oauth.ts`, `components/ConsoleOAuthFlow.tsx` | Functional: firstParty cloud auth against Anthropic's real OAuth flow. Not branding — live credential endpoints |
| Upstream docs links in UI copy | `components/**` (sandbox, MCP, hooks, trust, cost dialogs), `utils/preflightChecks.tsx`, `commands/ide/ide.tsx` (JetBrains), `commands/memory/memory.tsx` | Features behave identically to upstream; links point at accurate upstream documentation for that behavior. fusion hosts no docs site |
| `platform.claude.com` docs fetch | `tools/AgentTool/built-in/claudeCodeGuideAgent.ts`, `tools/WebFetchTool/preapproved.ts` | Guide agent answers questions about Claude Code compatibility; preapproved-fetch domain list is a functional allowlist |
| Model pricing source comments | `utils/modelCost.ts` | Prices are sourced from upstream pricing docs; comment is a provenance citation |
| `"claude-ai"` availability tags | `types/command.ts`, `commands.ts`, `commands/upgrade/index.ts`, `commands/fast/index.ts` | Internal command-surface enum for the upstream web host; fusion builds never mount that surface |
| Remote session URLs | `constants/product.ts` `CLAUDE_AI_BASE_URL` (`https://claude.ai`) | Functional: remote-session feature builds URLs on the real claude.ai host. Not a brand leak — the sessions live there |
| Anthropic-internal gated code | `utils/ide.ts` (artifactory VSIX), `utils/nativeInstaller/download.ts` (artifactory npm), `commands/insights.ts` (S3 upload, gated `USER_TYPE === "ant"`) | Dead for external builds: build sets `USER_TYPE="external"`; internal artifact servers are unreachable. Removal is a behavior change deferred to a dedicated cleanup |
| `claude-ai-external-token` notice id | `utils/statusNoticeDefinitions.tsx` | Stable string identifier for a status notice about the upstream external-token flow; renaming breaks user ignore-lists |
| Comments mentioning upstream internals | `utils/auth.ts`, `utils/autoRunIssue.tsx` | Code comments citing upstream source of mirrored logic |
| `claudeCodeGuideAgent`, `ClaudeInChromeOnboarding` | `src/tools/AgentTool/`, `src/components/` | Feature-gated (`feature("CHROME")`, default OFF, DCE'd from standard builds — see audit 0903); upstream-compat surfaces |

## 3. Telemetry decision: inert, documented, kept as types

**No event ever leaves the process.** Verified end to end:

- `services/analytics/index.ts` — `logEvent`/`logEventAsync` are unconditional
  no-ops; `attachAnalyticsSink` is a no-op; the sink is never initialized
  (`sink.ts`).
- `services/analytics/firstPartyEventLogger.ts` — 1P logging disabled;
  `is1PEventLoggingEnabled()` returns `false`.
- `services/analytics/growthbook.ts` — GrowthBook client creation is
  compile-time eliminated behind `feature("TELEMETRY")` (off in every build
  profile; see audit P0-2).
- `src/types/generated/events_mono/` (the CC internal event schema, 28.5K) —
  consumed **type-only** by `services/analytics/metadata.ts`
  (`import type`, erased at build; zero runtime emission, zero network
  endpoints). Kept because `metadata.ts` structures its environment/auth
  metadata on those types; deleting them is a metadata.ts rewrite with no
  privacy gain (the types ship no strings into the binary). If a future
  cleanup rewrites `metadata.ts`, the schema should be deleted with it.

Data flow: **producer call sites → `logEvent()` no-op → nothing.** There is
no sink, no batcher, no exporter, and no Anthropic-shaped endpoint anywhere
in the runtime path.

## 4. AGPL-3.0 obligations

- License: full AGPL-3.0 text in `LICENSE`.
- Corresponding source: this repository (the derivative itself).
- Provenance disclosure: README § Provenance names Claude Code as upstream.
- Modification visibility: de-branding commits are ordinary history
  (referenced from issue #220).

Maintainer acknowledgment: AGPL-3.0 obligations for this derivative are
understood and met by source availability + provenance disclosure (issue
#220 acceptance criterion 4).
