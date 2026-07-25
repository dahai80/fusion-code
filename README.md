<h1 align="center">fusion-code</h1>

<p align="center">
  <strong>A terminal-native AI coding agent with deep local MLX integration.</strong><br>
  Cloud telemetry stripped. Experimental features unlocked. Local-first.<br>
  One binary, zero callbacks home.
</p>

<p align="center">
  <a href="#install"><img src="https://img.shields.io/badge/install-bun-blue?style=flat-square" alt="Install" /></a>
  <a href="https://github.com/dahai80/fusion-code/stargazers"><img src="https://img.shields.io/github/stars/dahai80/fusion-code?style=flat-square" alt="Stars" /></a>
  <a href="https://github.com/dahai80/fusion-code/issues"><img src="https://img.shields.io/github/issues/dahai80/fusion-code?style=flat-square" alt="Issues" /></a>
  <a href="./FEATURES.md"><img src="https://img.shields.io/badge/features-88%20flags-green?style=flat-square" alt="Feature Flags" /></a>
</p>

---

## What is this

fusion-code is a terminal-native AI coding agent built for local-first development. It ships as a single binary with deep local MLX integration, and supports cloud providers (Anthropic direct or via proxy/LiteLLM, OpenAI, Foundry) as optional backends.

Three things set it apart:

### Local inference first

Deeply integrated with [fusion-mlx](https://github.com/fusion-mlxs/fusion-mlx) local MLX inference at `127.0.0.1:11434`. When no cloud API key is set, a local model is auto-selected so data never leaves the machine. The streaming adapter suppresses `<tool_call>` markup leakage and supports prefix-cache reuse.

### No cloud telemetry

No outbound telemetry, analytics, or crash reporting. Feature flag evaluation runs locally for runtime gates but never reports back -- no usage tracking, no session fingerprinting, no error reporting.

### Experimental features unlocked

88 feature flags gated behind `bun:bundle` compile-time switches. This build unlocks all 54 flags that were already clean, plus the 34 flags that previously failed to bundle -- all 34 were fixed on 2026-07-23. See [FEATURES.md](FEATURES.md) for the full audit.

---

## Model Providers

fusion-code supports **four active API providers**. The provider is selected by `getAPIProvider()` in `src/utils/model/providers.ts`:

1. **fusionMlx (local, default)** -- `FUSION_MLX_ENABLED=1` or no cloud key set -> local MLX inference at `127.0.0.1:11434`
2. **firstParty (Anthropic)** -- `FUSION_API_KEY` / `ANTHROPIC_API_KEY` (direct API, or via a proxy/LiteLLM with `FUSION_BASE_URL`)
3. **openai** -- `FUSION_CODE_USE_OPENAI=1`
4. **foundry** -- `FUSION_CODE_USE_FOUNDRY=1`

> **Note:** AWS Bedrock and Google Vertex AI providers are disabled in this build (the detection branches are permanently short-circuited in `providers.ts`). They are intentionally not selectable; use the Anthropic firstParty path with a proxy if you need a managed Anthropic endpoint.

Fusion-MLX auto-detection: `shouldAutoUseFusionMlx()` checks port 11434 availability and auto-selects a code-capable text model.

Model resolution priority: session override (`/model`) > `--model` flag > `FUSION_MODEL` / `FUSION_MLX_MODEL` env > saved settings.

### FUSION_* env mapping

`FUSION_*` env vars are mapped to `ANTHROPIC_*` at startup for SDK compatibility:

| Fusion env | Anthropic equivalent |
|---|---|
| `FUSION_API_KEY` | `ANTHROPIC_API_KEY` |
| `FUSION_BASE_URL` | `ANTHROPIC_BASE_URL` |
| `FUSION_AUTH_TOKEN` | `ANTHROPIC_AUTH_TOKEN` |
| `FUSION_MODEL` | `ANTHROPIC_MODEL` |
| `FUSION_BETAS` | `ANTHROPIC_BETAS` |

### Cloud LLM Configuration

When local MLX is unavailable (traveling, remote fusion-mlx host, or you just want a cloud model), fusion-code can route to a cloud provider. Set the relevant env vars before launching `./fusion-code`. The first cloud provider whose flag is set wins; otherwise local MLX is auto-detected on port 11434.

#### 1. Anthropic direct (firstParty)

The simplest cloud path. Set an API key:

```bash
export FUSION_API_KEY="sk-ant-..."
# Optional: pin a model
export FUSION_MODEL="claude-sonnet-5"
./fusion-code
```

OAuth login (no key) also works via the in-app login flow.

#### 2. Anthropic via proxy / LiteLLM (firstParty + custom base URL)

Route Anthropic API calls through a gateway (LiteLLM, OpenRouter, an internal proxy). This is the recommended way to reach cloud models from a host that also runs local fusion-mlx:

```bash
export FUSION_BASE_URL="http://your-proxy:4000/litellm"
export FUSION_API_KEY="sk-..."          # key accepted by the proxy
# Optional, if the proxy expects a bearer token instead of x-api-key:
export FUSION_AUTH_TOKEN="sk-..."
# Optional, extra headers (e.g. gateway routing):
export FUSION_CUSTOM_HEADERS='{"X-Routing-Key":"abc"}'
./fusion-code
```

`FUSION_*` env vars are mapped to `ANTHROPIC_*` at startup (see table above), so the underlying SDK sends them as standard Anthropic request fields. With `FUSION_BASE_URL` set, `getAPIProvider()` still returns `firstParty` and all Anthropic-compatible endpoints are used unchanged.

#### 3. OpenAI (Codex)

```bash
export FUSION_CODE_USE_OPENAI=1
./fusion-code   # then complete the OpenAI OAuth login in-app
```

Auth is OAuth-based; an API key is not required for the Codex adapter.

#### 4. Foundry (Azure AI Foundry / Anthropic on Foundry)

```bash
export FUSION_CODE_USE_FOUNDRY=1
export FUSION_FOUNDRY_RESOURCE="my-foundry"   # or FUSION_FOUNDRY_BASE_URL
export FUSION_FOUNDRY_API_KEY="..."           # key auth (note: FUSION_, not ANTHROPIC_)
./fusion-code
```

Alternatives: Azure AD `DefaultAzureCredential` is used if no key is set; set `FUSION_CODE_SKIP_FOUNDRY_AUTH=1` for an unauthenticated test endpoint.

#### 5. Remote fusion-mlx (local provider, remote host)

Run fusion-mlx on another machine and point fusion-code at it. This keeps the local-MLX provider (no cloud key, local latency optimizations) while the model runs elsewhere:

```bash
export FUSION_MLX_BASE_URL="http://192.168.1.10:11434"
# Optional, if the remote fusion-mlx requires a key:
export FUSION_MLX_API_KEY="..."
./fusion-code
```

#### Provider summary

| Provider | Selector | Required env | Auth |
|---|---|---|---|
| fusionMlx (local, default) | none / `FUSION_MLX_ENABLED=1` | (port 11434) | local |
| Anthropic direct | `FUSION_API_KEY` | `FUSION_API_KEY` | API key / OAuth |
| Anthropic via proxy | `FUSION_BASE_URL`+`FUSION_API_KEY` | `FUSION_BASE_URL`, `FUSION_API_KEY` | API key or `FUSION_AUTH_TOKEN` |
| OpenAI Codex | `FUSION_CODE_USE_OPENAI=1` | -- | OAuth |
| Foundry | `FUSION_CODE_USE_FOUNDRY=1` | `FUSION_FOUNDRY_RESOURCE`/`_BASE_URL` | `FUSION_FOUNDRY_API_KEY` / Azure AD |
| Remote fusion-mlx | `FUSION_MLX_BASE_URL` | `FUSION_MLX_BASE_URL` | local (optional `FUSION_MLX_API_KEY`) |

> **Model selection priority:** session override (`/model`) > `--model` flag > `FUSION_MODEL` / `FUSION_MLX_MODEL` env > saved settings.

### MLX Prompt Tier System

Local models have limited context windows (32K vs 200K for cloud). The system prompt and tool set are automatically scaled by model size and context window to avoid consuming the entire context:

| Tier | Model Size | Context Window | ~System Tokens | Tools | Sections |
|---|---|---|---|---|---|
| `mini` | ≤3B | any | ~2K | 5 core | 5 (env, identity, tools, style, reasoning) |
| `compact` | 32B+ | ≤32K | ~3K | 5 core | 7 (mini + coding standards, error recovery) |
| `standard` | 7B-9B | any | ~8K | 9 std | 23 (mini + protocols, examples, coding standards) |
| `extended` | 14B | any | ~12K | 15 ext | 50 (standard + security, testing, workflows) |
| `full` | 32B+ | >32K | ~24K | all | 89 (all sections including language-specific guides) |

**Compact tier** is designed for large models on tight 32K windows. It keeps system prompt to ~3K tokens and restricts tools to the 5 core tools (Read, Edit, Bash, Glob, Grep), leaving ~24K tokens for conversation. Memory prompts are truncated to 3K chars in this tier.

Tool tiers for MLX:
- **core** (≤32K window): Read, Edit, Bash, Glob, Grep + MCP tools
- **standard** (≤64K window): core + Write, LS
- **extended** (>64K window): standard + TodoRead/Write, TaskCreate/Get/Update/List, WebSearch/Fetch

AutoCompact triggers at 60% of the effective context window for MLX, with a minimum floor of `effectiveWindow - 4000` tokens to prevent firing before any conversation tokens are added.

### MLX Memory Safety

On 32K context windows, the system prompt (~3K) + tool definitions (~5K) consume ~8K tokens before any conversation. The MLX preflight check (`preflightMlxQueryCheck`) accounts for this overhead and forces compact when total tokens exceed the safe budget. Four safety layers prevent memory leaks:

1. **Hard compact**: When the MLX provider is active, compact uses deterministic tool-output truncation instead of LLM summarization. Old `tool_result` blocks are truncated to head 200 + tail 100 chars; long assistant texts are shortened. Recent 3 API rounds are preserved intact. Zero token cost — no LLM call needed.
2. **Catastrophic abort**: If estimated tokens exceed 10x the safe budget, compact is skipped and the query aborts immediately with a clear error. This prevents 25M+ token arrays that consume 100GB+ RSS.
3. **No recursive compact**: Compact's forked agent (`querySource === 'compact'`) is blocked from triggering forced compact. Without this guard, compact → forked agent → forced compact → infinite loop.
4. **Compact tool stripping**: MLX compact agents cannot use tools (`canUseTool` denies everything), but tool definitions were still sent (~5K tokens wasted). Now stripped to `tools: []` for MLX compact calls.
5. **One-shot forced compact**: `mlxForcedCompactDone` flag persists across loop iterations (reset on new user turn), ensuring forced compact is attempted at most once per query. After the attempt, a 20% tolerance allows the model call to proceed even if still slightly over budget.
6. **Post-compact GC**: After compact (both hard and LLM paths), the MLX backend is asked to release stale KV cache via `POST /api/v1/gc`. This prevents memory spikes when new Prefill overlaps with old cache.

### Reliability Improvements (Audit Remediation)

Based on a full codebase audit (2026-07-25), the following fixes were applied:

| Priority | Fix | Impact |
|---|---|---|
| P0 | Create missing `src/query/transitions.ts` | Resolved compilation blocker — `Terminal` and `Continue` union types |
| P0 | `stdout.isTTY` via `Object.defineProperty` | Reliable TTY override; preserves original value for restoration |
| P0 | `asyncMemoize` for all memoized async functions | Rejected promises no longer permanently cached; 9 call sites fixed |
| P0 | Startup error capture instead of silent `.catch(() => {})` | Pre-setup command/agent errors are now logged for diagnosis |
| P1 | `FUSION_BASE_URL` guard consistency | Now respects existing `ANTHROPIC_BASE_URL` like all other env vars |
| P1 | MLX health check non-blocking | Fire-and-forget with await before first API call; faster startup |
| P1 | `mutableMessages` mutex lock | Prevents concurrent `submitMessage` race conditions |
| P1 | `init()` async memoize | Initialization failure no longer permanently blocks retries |
| P2 | `gracefulShutdownSync` replaces `process.exit` | Cleanup registry (LSP, tmux, terminal mode) now runs on exit |
| P1 | Tree-Sitter AST index (`/ast`) | Real-time incremental symbol index with regex fallback |
| P2 | Prefix cache preservation | System prompt kept stable across compaction for MLX KV reuse |
| P3 | Deterministic fast-path engine (`/fastpath`) | Rule engine intercepts simple queries before model invocation |
| P4 | BM25 local search (`/search`) | Classic BM25 scoring for local code search without vector DB |

---

## Install

```bash
git clone https://github.com/dahai80/fusion-code.git
cd fusion-code
bun install
bun run build
./fusion-code
```

Set `FUSION_API_KEY` or `ANTHROPIC_API_KEY` for cloud providers, or use local MLX via `fusion service start mlx` (auto-detected on port 11434).

### Requirements

- **Runtime**: [Bun](https://bun.sh) >= 1.3.11
- **OS**: macOS, Linux, or Windows (native). Local MLX inference is macOS-only; on Linux/Windows run fusion-mlx on a Mac and connect over the network with `FUSION_MLX_BASE_URL`, or use a cloud provider instead.
- **Auth**: An API key / OAuth login for cloud, or fusion-mlx running locally (or remotely via `FUSION_MLX_BASE_URL`)

```bash
# Install Bun if you don't have it
curl -fsSL https://bun.sh/install | bash
```

---

## Build

```bash
bun run build        # ./fusion-code (VOICE_MODE only)
./fusion-code
```

### Build Variants

| Command | Output | Features | Description |
|---|---|---|---|
| `bun run build` | `./fusion-code` | `VOICE_MODE` only | Production-like binary |
| `bun run build:dev` | `./fusion-code-dev` | `VOICE_MODE` only | Dev version stamp |
| `bun run build:dev:full` | `./fusion-code-dev` | All experimental flags | Full unlock build |
| `bun run compile` | `./dist/fusion-code` | `VOICE_MODE` only | Alternative output path |

### Custom Feature Flags

Enable specific flags without the full bundle:

```bash
# Enable just ultraplan and ultrathink
bun run ./scripts/build.ts --feature=ULTRAPLAN --feature=ULTRATHINK

# Add a flag on top of the dev-full build
bun run ./scripts/build.ts --dev --feature-set=dev-full --feature=BRIDGE_MODE
```

Build-time macros: `MACRO.VERSION`, `MACRO.BUILD_TIME`, `process.env.USER_TYPE` (set to `"external"`). Native modules excluded from bundle: `@ant/*`, `audio-capture-napi`, `image-processor-napi`, `modifiers-napi`, `url-handler-napi`.

---

## Usage

```bash
# Interactive REPL (default)
./fusion-code

# One-shot mode
./fusion-code -p "what files are in this directory?"

# Specify a model
./fusion-code --model <model-id>

# Run from source (slower startup)
bun run dev
```

---

## Experimental Features

The `bun run build:dev:full` build enables all working feature flags. Highlights:

### Interaction & UI

| Flag | Description |
|---|---|
| `ULTRAPLAN` | Remote multi-agent planning (Opus-class) |
| `ULTRATHINK` | Deep thinking mode -- type "ultrathink" to boost reasoning effort |
| `VOICE_MODE` | Push-to-talk voice input and dictation |
| `TOKEN_BUDGET` | Token budget tracking and usage warnings |
| `HISTORY_PICKER` | Interactive prompt history picker |
| `MESSAGE_ACTIONS` | Message action entrypoints in the UI |
| `QUICK_SEARCH` | Prompt quick-search |

### Agents, Memory & Planning

| Flag | Description |
|---|---|
| `BUILTIN_EXPLORE_PLAN_AGENTS` | Built-in explore/plan agent presets |
| `VERIFICATION_AGENT` | Verification agent for task validation |
| `EXTRACT_MEMORIES` | Post-query automatic memory extraction |
| `COMPACTION_REMINDERS` | Smart reminders around context compaction |
| `CACHED_MICROCOMPACT` | Cached microcompact state through query flows |

### Tools & Infrastructure

| Flag | Description |
|---|---|
| `BRIDGE_MODE` | IDE remote-control bridge (VS Code, JetBrains) |
| `BASH_CLASSIFIER` | Classifier-assisted bash permission decisions |
| `PROMPT_CACHE_BREAK_DETECTION` | Cache-break detection in compaction/query flow |
| `MONITOR_TOOL` | Background MCP task monitor |
| `WORKFLOW_SCRIPTS` | Local workflow task scripting |
| `WEB_BROWSER_TOOL` | Headless browser tool |

All 34 historically-broken flags were fixed on 2026-07-23 and now bundle cleanly. See [FEATURES.md](FEATURES.md) for the complete audit of all 88 flags.

---

## Project Structure

```
scripts/
  build.ts                # Build script with feature flag DCE system

src/
  entrypoints/cli.tsx     # CLI entrypoint, FUSION_* env mapping, fast-path dispatch
  main.js -> cliMain()    # Full REPL bootstrap
  screens/REPL.tsx        # Main interactive UI (Ink/React)
  QueryEngine.ts          # LLM query engine, session state
  commands.ts             # ~40+ slash command registry
  tools.ts                # 30+ agent tool registry

  commands/               # /slash command implementations
  tools/                  # Agent tool implementations (Bash, Read, Edit, etc.)
  components/             # Ink/React terminal UI components
  hooks/                  # React hooks
  services/
    api/                  # claude.ts + fusion-mlx adapter/stream + codex adapter
    oauth/                # OAuth flows (Anthropic + OpenAI)
    mcp/                  # Model Context Protocol integration
    lsp/                  # Language Server Protocol integration
    compact/              # Context compaction (auto/reactive/micro + hardCompact + postCompactCleanup)
  state/                  # App state store
  utils/
    model/providers.ts    # Provider selection (getAPIProvider)
    cwd.ts                # AsyncLocalStorage cwd override for concurrent agents
    path.ts               # Path expansion + NFC normalization
  skills/                 # Skill system
  plugins/                # Plugin system
  bridge/                 # IDE bridge (VS Code, JetBrains)
  voice/                  # Voice input
  tasks/                  # Background task management
```

### Notable Slash Commands

| Command | Description |
|---|---|
| `/break-cache` | Reset prompt cache break detection state |
| `/ctx_viz` | Visualize context window usage with progress bar |
| `/env` | Display provider, model, and key environment variables |
| `/summary` | Generate a summary of the current conversation session |
| `/workflows` | List and run workflow scripts from `~/.claude/workflows/` |
| `/compact` | Compact conversation context to free space |
| `/cost` | Show token usage and cost for the session |
| `/doctor` | Diagnose common setup issues |
| `/model` | Switch or inspect the active model |

---

## Tech Stack

| | |
|---|---|
| **Runtime** | [Bun](https://bun.sh) |
| **Language** | TypeScript |
| **Terminal UI** | React + [Ink](https://github.com/vadimdemedes/ink) |
| **CLI Parsing** | [Commander.js](https://github.com/tj/commander.js) |
| **Schema Validation** | Zod v4 |
| **Code Search** | ripgrep (bundled) |
| **Protocols** | MCP, LSP |
| **Local Inference** | [fusion-mlx](https://github.com/fusion-mlxs/fusion-mlx) (MLX) |
| **Cloud APIs** | Anthropic Messages (direct or via proxy/LiteLLM), OpenAI Codex, Anthropic Foundry |

---

## Contributing

Contributions are welcome.

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes (`git commit -m 'feat: add something'`)
4. Push to the branch (`git push origin feat/my-feature`)
5. Open a Pull Request

For upstream `fusion-mlx` issues: file an issue first, then a PR, following the upstream contribution flow. Do not modify fusion-mlx local code directly -- only via PRs.

---

## License

Use at your own discretion. See the project license terms for details.
