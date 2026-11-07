---
doc_id: fusion-code/guide
product: fusion-code
class: app
entry: guided-ui
doc_type: guide
title: { zh: "fusion-code 开发者指南", en: "fusion-code developer guide" }
audience: engineer
status: draft
version: 0.5.22
updated: 2026-11-07
owner: @dahai
source_of_truth:
  - CLAUDE.md
---

# CLAUDE.md

This file provides guidance to Fusion-Code when working with code in this repository.

## Common commands

```bash
# Install dependencies
bun install

# Standard build (./fusion-code, only VOICE_MODE enabled)
bun run build

# Dev build (./fusion-code-dev, only VOICE_MODE enabled)
bun run build:dev

# Dev build with all experimental features (./fusion-code-dev)
bun run build:dev:full

# Compiled build (./dist/fusion-code)
bun run compile

# Run from source without building
bun run dev

# Custom feature flags
bun run ./scripts/build.ts --feature=ULTRAPLAN --feature=ULTRATHINK
bun run ./scripts/build.ts --dev --feature=BRIDGE_MODE
```

Run the built binary with `./fusion-code` or `./fusion-code-dev`. Configure `FUSION_BASE_URL` (Anthropic-compatible endpoint) + `FUSION_CLIENT_KEY` for LLM access — that is the only required setup. Local MLX is opt-in via `FUSION_MLX_ENABLED=1` (no auto-detection).

## Tests / lint / typecheck

- Tests: `bun test src/__tests__/` (the `bun run test` target). Tests live in `src/__tests__/` (unit: `fusionRules`, `sensitiveFiles`, `trajectory/`) and `tests/` (integration, mirrored by subsystem: `cli/`, `commands/`, `components/`, `hooks/`, `lib/`, `server/`, `services/`, `tools/`, `utils/`).
- E2E acceptance: `bun run test:e2e` (Playwright, `tests/e2e/`) — real Chromium + real projectApiServer (11441, started by config `webServer`) + real MLX model via WS chat. E2e files use the `.e2e.ts` suffix (NOT `.spec.ts` — bun test also matches `*.spec.ts` and crashes on Playwright's `test.beforeAll`). Requires built `./fusion-code` + running fusion-mlx. See `docs/e2e-acceptance.md` (incl. pitfalls: about:blank opaque origin breaks browser fetch/WS — use server/fixture origin pages; ACAO not readable from browser JS).
- Single test file: `bun test src/__tests__/trajectory/trajectory.test.ts`
- Single test: `bun test src/__tests__/trajectory/trajectory.test.ts -t "<test name>"`
- Lint: `bun run lint` (Biome, covers `src/` + `scripts/`); autofix with `bun run lint:fix`. Currently green at error level. `biome.json` carries per-file override lists (ratchet) that relax rules for legacy/vendored/UI files — new code must pass the full `recommended` preset; never add files to the override lists (they only shrink over time).
- Typecheck: `bun run typecheck` (`tsc --noEmit`)
- All checks: `bun run check` (typecheck + lint + lint:layers + lint:flags + build)
- Feature-flag consistency: `bun run lint:flags` (`scripts/check-feature-flags.ts`) — diffs `src/` `feature('X')` call sites against `scripts/build.ts` `fullExperimentalFeatures`; fails on orphan/miss (audit P1-4 R10). Integrated into `bun run check`.

## High-level architecture

- **Entry point**: `src/entrypoints/cli.tsx` bootstraps the CLI. It sets `FUSION_CODE_CONFIG_DIR=~/.fusion-code`, maps `FUSION_*` env vars to `ANTHROPIC_*` equivalents for SDK compatibility, and dispatches fast-path subcommands (`--version`, `--dump-system-prompt`, bridge/daemon/ps modes) before falling through to the full REPL via `src/main.js` → `cliMain()`.
- **Main UI**: `src/screens/REPL.tsx` is a React/Ink terminal UI. One `QueryEngine` per conversation; `submitMessage()` starts a new turn. Handles keybindings, voice input, task lists, compaction, tool permissions, and session management. **God-module split in progress** (audit §1.1.1): leaf components extracted to `src/components/` (`AnimatedTerminalTitle`, `TranscriptModeFooter`, `TranscriptSearchBar`) + `median()` to `src/utils/array.ts`; further cohesive-subsystem extractions continue in follow-up PRs.
- **Command/tool registries**: `src/commands.ts` registers ~40+ slash commands; `src/tools.ts` registers 30+ agent tools. Implementations live in `src/commands/` and `src/tools/`. Feature-gated tools/commands are dead-code-eliminated when their flag is off.
- **LLM query pipeline**: `src/QueryEngine.ts` coordinates message flow, tool use, and model invocation. Owns session state (`mutableMessages`, `abortController`, `totalUsage`). Tool-error circuit breaker (#227, `src/utils/toolErrorCircuitBreaker.ts`): after N consecutive tool calls fail with an identical error signature (default 5 non-interactive, env `FUSION_CODE_MAX_CONSECUTIVE_TOOL_ERRORS`), the query loop aborts with result subtype `error_tool_error_loop`; `--max-duration <seconds>` aborts with `error_max_duration`.

## Core subsystems

- `src/services/api/` — API clients. `claude.ts` is the main Anthropic-protocol client (any compatible endpoint via `FUSION_BASE_URL`); `fusion-mlx-adapter.ts` + `fusion-mlx-stream.ts` handle local MLX inference (opt-in via `FUSION_MLX_ENABLED=1`). OAuth browser login flows removed (1102 cleanup — API-key/token auth via `FUSION_CLIENT_KEY` only).
- `src/services/oauth/` — remaining OAuth surface: profile reader (`getOauthProfile`), token-file types, MCP OAuth client metadata (login/token-exchange flows removed).
- `src/services/mcp/` — Model Context Protocol integration.
- `src/services/lsp/` — Language Server Protocol integration.
- `src/services/executor/` — fusion-executor (Layer B "hands") integration. UDS NDJSON-RPC client routing foreground bash commands to the executor subprocess. Default-off (`FUSION_CODE_EXECUTOR_ENABLED`), fail-open to in-process `runShellCommand`. Phase 2 (PR #139) preserves server-side diagnostics slice to cut model tokens on failure; Phase 3 (PR #139) adds in-band git snapshot + atomic rollback, opt-in via `FUSION_CODE_EXECUTOR_AUTO_ROLLBACK` (default off — protects edit-test-fail coding loop); Phase 3b (PR #152) adds caller-owned turn-boundary snapshot + `/rollback` manual command, opt-in via `FUSION_CODE_EXECUTOR_TURN_SNAPSHOT` (default off — two layers complementary: in-band = single-call self-contained, turn-boundary = caller owns the snapshot, model/user decides). See `docs/model-providers.md` § "Executor seam".
- `src/state/` — App state store.
- `src/hooks/` — React hooks used by UI/flows.
- `src/components/` — Terminal UI components (Ink).
- **Layer enforcement (audit §1.1.3 + #203 Phase B):** `src/services/**` must not import `react` — service layer stays UI-free. Enforced by `bun run lint:layers` = `scripts/layer-lint.ts` (Biome `noRestrictedImports` scoped to `src/services/**`) + `scripts/layer-lint-reverse.ts` (reverse boundary: consumers outside `src/services/**` may reach a migrated service subdir only through its barrel `src/services/<subdir>/index`, never a deep file; allowlist-driven via `scripts/layer-lint-reverse.json`). React hooks/components live in `src/hooks/` or `src/components/`. Integrated into `bun run check`.
- `src/skills/` — Skill system.
- `src/plugins/` — Plugin system. `/plugins` slash command (`src/commands/plugins/`) lists installed (`list`), previews one (`preview <name>`), discovers installable plugins from a curated registry index (`discover [query] [--source=official|community|git|archive]`, PR #5), or checks updates (`update`). The registry fetch (`src/utils/plugins/registryIndex.ts`) pulls a `registry.json` index with a 1h cache under `~/.fusion-code/marketplace-cache`; `FUSION_OFFLINE=1` skips the fetch (offline builtin plugins stay usable), `FUSION_CODE_PLUGIN_REGISTRY_URL` overrides the index URL. `MarketplaceSourceSchema` (`src/utils/plugins/schemas.ts`) is a discriminatedUnion over source variants (url/github/git/npm/file/directory/command/registry/…). `.fusion-plugin` format: manifest carries an optional `schemaVersion` (附录 B: odd=experimental/even=stable; missing=undefined=pre-E2, accepted during compat window, warn-logged) on `PluginManifestMetadataSchema`; archive sources pin `sha256` for supply-chain integrity — missing sha256 throws under `FUSION_CODE_PLUGIN_SHA256_STRICT=1` (fail-visible), else byte-identical fail-open; git/github sources lock a commit via `sha` (gitClone shallow fetch). Author guide: `docs/plugin-authoring.md` (PR #6).
- `src/bridge/` — IDE bridge (VS Code, JetBrains).
- `src/voice/` — Voice input.
- `src/tasks/` — Background task management.
- `src/tools/WorkflowTool/` — Workflow script runtime (`agent()`/`parallel()`/`pipeline()`/`phase()` primitives). Double-gated default-off: compile-time `feature("WORKFLOW_SCRIPTS")` (dev-full only, DCE'd from standard builds) + runtime `FUSION_WORKFLOW_RUNTIME_ENABLED=1`; either off = returns the `started` stub, byte-identical. See `docs/workflow-runtime.md`.
- `src/utils/model/` — Model configs, providers, validation. `providers.ts` defines `APIProvider`: `firstParty | bedrock | vertex | foundry | openai | fusionMlx`.

## Model provider system

The provider is selected by `getAPIProvider()` in `src/utils/model/providers.ts` — **endpoint-unified semantics**: the client never guesses where the LLM runs; protocol-compatible endpoint + key = direct connect.

1. If the model name is clearly an MLX model (`mlx-*`) → `fusionMlx` (removed — no name sniffing)
2. If `FUSION_CODE_USE_OPENAI=1` → `openai` (throws: direct connect removed)
3. If `FUSION_CODE_USE_FOUNDRY=1` → `foundry` (throws: direct connect removed)
4. If `FUSION_CODE_USE_BEDROCK=1` → `bedrock` (throws: direct connect removed)
5. If `FUSION_CODE_USE_VERTEX=1` → `vertex` (throws: direct connect removed)
6. If `FUSION_CLIENT_KEY` set, or `ANTHROPIC_API_KEY` is a valid `sk-ant-` key → `firstParty` (direct connect to `FUSION_BASE_URL`, default `api.anthropic.com`) — **highest priority, wins over everything**
7. If local inference explicitly opted in (`FUSION_GATEWAY_ENABLED=1` / `FUSION_MLX_ENABLED=1` / `FUSION_MLX_BASE_URL` / `FUSION_GATEWAY_URL` set) → `fusionMlx` (default `127.0.0.1:11432`)
8. If `FUSION_BASE_URL`/`ANTHROPIC_BASE_URL` points to a non-Anthropic host (third-party proxy inference) → `firstParty`
9. Otherwise → `firstParty` — **no implicit local-MLX fallback, no port auto-detection, no model-name sniffing**; a missing key surfaces a clear auth error.

Auth is unified: `FUSION_CLIENT_KEY` / `FUSION_AUTH_TOKEN` work for ANY endpoint (cloud or local inference); legacy `FUSION_GATEWAY_API_KEY` / `GATEWAY_API_KEY` remain as gateway-side compatibility fallbacks only — the engine-local env aliases (`FUSION_MLX_API_KEY`, `MLX_API_KEY`) were removed in #226; engine-side fallback is `~/.fusion-mlx/settings.json` `auth.api_key`.

Model resolution priority: session override (`/model`) > `--model` flag > `FUSION_MODEL` / `FUSION_MLX_MODEL` env > saved settings.

## LLM Adapter Seam (div-anthropic)

`src/services/llm/` implements a provider-neutral seam that has **fully replaced** `@anthropic-ai/sdk` — the dependency is removed from `package.json` and the compiled binary has 0 functional SDK references (branch `feat/div-anthropic`). See `docs/model-providers.md` § "LLM Adapter 接缝".

- `src/services/llm/client.ts` — `LlmClient` (5 methods: `streamMessages`/`createMessage`/`createMessageRaw`/`countTokens`/`listModels`) replacing all `anthropic.beta.messages.*` / `anthropic.models.list` call sites. `createSeamClient(model, fetchOverride, defaultHeaders)` constructs the firstParty+fusionMlx client. `createMessage` injects `_request_id` (SDK `response._request_id` convention).
- `src/services/llm/seam.ts` — `streamViaSeam()` returns `{ stream, requestId, response }`: POST `/v1/messages` directly, translate SSE→StreamChunk→SDK parts, fill `streamRequestId`/`streamResponse` (preserves `.withResponse()` semantics). Zero changes to the downstream switch.
- `src/services/llm/errors.ts` — duck-typing bridge (`isApiErrorLike`/`isConnectionErrorLike`/`isTimeoutErrorLike`/`isAbortError`) replacing all `instanceof APIError`/`APIUserAbortError`. Judges by shape (status/headers/requestID/name/message), accepts seam `LlmRequestError`.
- `src/services/llm/streamResume.ts` — **Stream Resume seam** (PR #163, gw#123 client half). Local MLX stream drops mid-generation (timeout-class, NOT user abort) → reconnect `GET /v1/messages/{sid}/events` with `Last-Event-ID: <sid>:<seq>` and merge replayed frames + live tail via STATE-CONTINUATION (deep-clone pre-drop `StreamState` seeds resumed `transformMLXStreamToAnthropic`), instead of restarting the turn. `teeCursor` side-channel captures the per-event cursor the MLX translation layer strips (transform parses `data:` only); sid read from `X-Fusion-Stream-ID` header. Default-off (`FUSION_CODE_STREAM_RESUME_ENABLED`), env-gate not `feature()` (PR #9 build bug), off = byte-identical. See `docs/model-providers.md` § "Stream Resume seam".
- `src/services/api/client.ts` — `getAnthropicClient()` returns `LlmClient`; bedrock/vertex/foundry/openai all throw Errors directing users to direct-connect via `FUSION_BASE_URL` + `FUSION_CLIENT_KEY` (any Anthropic-compatible endpoint; cloud signing moved out-of-process). P0-4 (audit R6): openai branch added — previously `FUSION_CODE_USE_OPENAI=1` silently fell through to firstParty (semantic mismatch, 401/404).
- `src/services/llm/capability.ts` + `ctx.ts` — **ctx.llm capability seam** (ar-plan PR #3). Provider-neutral `LlmCapability` interface (8 methods: `supportsStreaming/Vision/ToolCalling/StructuredOutput/Thinking`, `maxInputTokens/maxOutputTokens`, `provider`, `modelId`) + 3 providers (`MlxCapabilityProvider`/`FirstPartyCapabilityProvider`/`GatewayCapabilityProvider`) + async `createLlmCapability(modelId)`. `Ctx` envelope via async `createCtx(modelId, cwd, sessionId)`. Migrated `modelSupportsStructuredOutputs` (betas.ts) + `modelSupportsThinking` (thinking.ts) with optional `ctx?` param — ctx-optional with `ctx.llm.modelId === model` guard = byte-identical fallback (all current callers pass no ctx). Future home for the 9 provider-conditional capability branches.
- `src/services/llm/capabilities/` — **ctx.fs + ctx.tools + ctx.exec + ctx.sandbox capability seams** (ar-plan PR #4, S1.b-e). Extends `Ctx` with 4 provider-neutral facades, each wrapping an EXISTING primitive (not a rewrite): `fs.ts` `LocalFsCapability` (node:fs/promises read/write/glob + rg grep), `tools.ts` `BaseToolsCapability` (`getAllBaseTools`+`findToolByName`+`isToolDenied`), `exec.ts` `InProcessExecCapability` (node:child_process spawn) + `ExecutorExecCapability` (drain `callBashViaExecutor`), `sandbox.ts` `NoneSandboxProvider` no-op stub. Default-off + byte-identical: `fs`+`tools` always present but invoked by 0 migrated prod consumers (demo in tests only, gradual migration later); `exec` env-gated `FUSION_CODE_CTX_EXEC_ENABLED`; `sandbox` not injected. Existing `BashTool` routing + `runShellCommand` UNTOUCHED — exec seam for future one-shot consumers. Solves arch-ecosystem A3.
- **Done**: SDK removed from `package.json`; all 8 SDK method call sites migrated; typecheck 0 errors; build + build:dev:full pass; 514 tests pass. **Remaining**: bedrock/vertex/foundry cloud providers need an out-of-process Anthropic-compatible endpoint (`FUSION_BASE_URL` direct connect; in-process signing stays removed).

## Build system

`scripts/build.ts` uses Bun's native bundler (`bun build --compile`). Feature flags are passed via `--feature=NAME` and used as `feature('X')` calls (imported from `bun:bundle`) for dead-code elimination - disabled features never enter the bundle. 88 feature flags are referenced in the source (see `docs/feature-flags.md`); only `VOICE_MODE` is enabled by default. `--feature-set=dev-full` enables the full experimental list. `src/` `feature('X')` call sites are kept in sync with `scripts/build.ts` `fullExperimentalFeatures` by `bun run lint:flags` (audit P1-4 R10).

Build-time macros: `MACRO.VERSION`, `MACRO.BUILD_TIME`, `process.env.USER_TYPE` (set to `"external"`). In dev builds, `process.env.FUSION_CODE_EXPERIMENTAL_BUILD` is set. `--bytecode` (V8/JSC bytecode precompile, the main binary-size lever) is default-off; opt in with `FUSION_CODE_BYTECODE=1`.

Native modules excluded from bundle: `@ant/*`, `audio-capture-napi`, `image-processor-napi`, `modifiers-napi`, `url-handler-napi`.

## Environment variable mapping

`FUSION_*` env vars are mapped to `ANTHROPIC_*` at startup for SDK compatibility:

| Fusion env | Anthropic equivalent |
|---|---|
| `FUSION_CLIENT_KEY` | `ANTHROPIC_API_KEY` |
| `FUSION_BASE_URL` | `ANTHROPIC_BASE_URL` |
| `FUSION_AUTH_TOKEN` | `ANTHROPIC_AUTH_TOKEN` |
| `FUSION_GATEWAY_ENABLED` | (optional local-inference toggle, opt-in only — never auto-set) |
| `FUSION_GATEWAY_URL` | (local-inference base URL, supersedes `FUSION_MLX_BASE_URL`, default `127.0.0.1:11432`) |
| `FUSION_MODEL` | `ANTHROPIC_MODEL` |
| `FUSION_BETAS` | `ANTHROPIC_BETAS` |
| `FUSION_LOG` | `ANTHROPIC_LOG` |

## FUSION.rules — Enhanced Rule System

FUSION.rules is an enhanced rule file with priority above CLAUDE.md. It supports frontmatter fields for project-level constraints:

- `denied_tools`: string[] — tool names blocked for this project (e.g., `WebSearch`, `Bash`)
- `default_template`: string — workflow template auto-assigned to new sessions

### File locations

- Global: `~/.fusion-code/FUSION.rules`
- Project: `<project-root>/FUSION.rules`

### Priority order (highest → lowest)

1. `~/.fusion-code/FUSION.rules` (global)
2. `<project-root>/FUSION.rules` (project)
3. `CLAUDE.md` (project)
4. `.fusion-code/CLAUDE.md`
5. `.fusion-code/rules/*.md`
6. `CLAUDE.local.md`

### Implementation

- `src/utils/fusionRules.ts` — Runtime registry: `isToolDenied()`, `parseFusionRulesFrontmatter()`, `mergeFusionRulesConfigs()`
- `src/utils/memory/types.ts` — `FusionRules` added to `MemoryType`
- `src/utils/claudemd.ts` — Loads FUSION.rules before CLAUDE.md in `getMemoryFiles()`
- `src/utils/claudemdPortable.ts` — Same loading for API server context
- `src/services/tools/toolExecution.ts` — Denied-tools gate before `validateInput()`

## Gateway Audit & Security

- `src/services/audit/auditLog.ts` — Persistent JSONL audit log at `~/.fusion-code/audit/`. Logs all tool calls (read/write/execute/denied) with session ID, duration, success/error. Auto-rotates at 10MB, keeps 30 files. Includes operation rate limiter (50 ops/min per type).
- `src/commands/audit/` — `/audit` slash command to view audit log. Supports `--last N`, `--tool NAME`, `--op read|write|execute|denied` filters.
- `src/utils/sensitiveFiles.ts` — Global sensitive file protection. Blocks AI from reading `.env`, SSH keys, credentials, `.pem`, `.key`, etc. Cannot be overridden by any rule.
- API server rate limiting: 120 req/min per IP, returns 429 when exceeded.
- **Enterprise hardening**: `docs/enterprise-hardening.md` — sandbox posture (opt-in 4th-layer enhancement, not sole defense), 3-layer defense-in-depth, enterprise `managed-settings.json` config template (`sandbox.enabled`/`failIfUnavailable`/`allowUnsandboxedCommands`). Schema semantics sourced from `src/entrypoints/sandboxTypes.ts`.

## Trajectory Flywheel (D1)

`src/services/trajectory/` implements the session-to-training-data pipeline (see `docs/trajectory-pipeline.md`):

```
~/.fusion-code/projects/<cwd-slug>/<session-id>.jsonl   (source)
  --collect-->  ~/.fusion/trajectories/  (manifest.json + raw/<product>-<session>.jsonl)
  --export -->  ~/.fusion/trajectories/{sft,dpo,grpo}.jsonl  (consumed by fusion-trainer)
```

- `collector.ts` scans session jsonl, pairs tool_use ↔ tool_result, and labels each session: `positive` (no `is_error`) or `self_correction` (error then recovery).
- `exporters.ts` converts to training formats: SFT (positive only), DPO pairs and GRPO samples (self_correction only).
- `trainerCli.ts` shells out to the `fusion-trainer` CLI (binary resolution: `opts.venvBin` > `FUSION_TRAINER_BIN` env > PATH lookup) to train on exported datasets: `sft` subcommand, or `rlsl --method dpo|grpo`.

Exposed as a top-level fast-path subcommand (no REPL) in `src/entrypoints/cli.tsx` -> `src/cli/handlers/trajectory.ts`:

```bash
fusion-code trajectory collect [--source DIR] [--dest DIR] [--product NAME]
fusion-code trajectory export --format sft|dpo|grpo [--dest DIR] [--session ID]
fusion-code trajectory train --format sft|dpo|grpo [--dest DIR] [--model NAME] [--output-dir DIR]
fusion-code trajectory manifest [--dest DIR]
fusion-code trajectory list [--source DIR]
```

## Event Sourcing (S2.1)

`src/services/events/SessionEvent.ts` + `eventLog.ts` implement the渐进 event-sourcing migration (ar-plan §4 P3). S2.1 (PR #160) ships event types + shadow write:

- `SessionEvent` (seq/type/data/surfaceOp/sourceEventSeqs) + `SessionEventLog` — pure types, 8 event types (user_message/assistant_message/tool_use/tool_result/compact/error/turn_start/turn_end).
- `SessionEventRecorder` — per-QueryEngine instance, monotonic seq, fail-open try/catch+log. Shadow-writes 8 `mutableMessages.push` points + turn boundaries. **mutableMessages stays truth source**; event log = write-only shadow (no read switch, no assertions yet — those are S2.2/PR #8).
- **Default-off** (`FUSION_CODE_EVENT_SOURCING=1`): off = `NOOP_RECORDER` (unconditional no-op subclass), empty log, byte-identical. In-memory only (persistence = S2.3 later).

## Web GUI (web/)

`web/` is the session-centric web workbench over the kernel (issue #228): own package (Bun + Vite + React + TS + Tailwind, vendored `@fusion/web-sdk`/`@fusion/web-ui`), backend on port 11482 (port-registry `fusion-code-web`). Backend (`web/server/`) serves the built SPA + `/api` + `/ws` + `/manifest.json`; orchestrates kernel subprocesses per run (`fusion-code -p --output-format stream-json --verbose [--resume <kernelSessionId>] [--allowedTools ...]`, cwd = repo path); runs are server-owned (browser disconnect does not kill them; events ring-buffer per session and replay on WS reconnect); first run links web session id → kernel session id. Gateway self-registration env-gated (`FUSION_SHELL_GATEWAY_URL` + `FUSION_ADMIN_KEY`, Bearer auth, 15s heartbeat → sidebar `⌨ Code`, proxy `/shell/fusion-code/`). Store at `~/.fusion-code/web` (repos/sessions/permissions; permissions = per-session allowlist, read-only default). Commands: `cd web && bun install && bun run build|dev|start|test`. Tests (`web/tests/`) use a mock kernel fixture + real temp git repos. See `web/README.md`.

## Docs

`docs/` holds in-repo deep-dives - consult these before changing related subsystems: `architecture.md`, `development.md`, `developer-guide.md`, `feature-flags.md`, `model-providers.md`, `trajectory-pipeline.md`, `workflow-runtime.md`, `enterprise-hardening.md`, `plugin-authoring.md`. `FUSION.rules.example` documents the enhanced rule file format.
