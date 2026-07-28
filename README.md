<h1 align="center">fusion-code</h1>

<p align="center">
  <strong>A terminal-native AI coding agent — local-first, zero telemetry, one binary.</strong><br>
  Deep local MLX integration. Cloud backends optional. No callbacks home.
</p>

<p align="center">
  <a href="#quick-start"><img src="https://img.shields.io/badge/quick-start-blue?style=flat-square" alt="Quick Start" /></a>
  <a href="https://github.com/dahai80/fusion-code/stargazers"><img src="https://img.shields.io/github/stars/dahai80/fusion-code?style=flat-square" alt="Stars" /></a>
  <a href="https://github.com/dahai80/fusion-code/issues"><img src="https://img.shields.io/github/issues/dahai80/fusion-code?style=flat-square" alt="Issues" /></a>
  <a href="./FEATURES.md"><img src="https://img.shields.io/badge/features-88%20flags-green?style=flat-square" alt="Feature Flags" /></a>
</p>

---

## Features at a Glance

| | |
|---|---|
| 🖥️ **Local MLX Inference** | Deep [fusion-mlx](https://github.com/fusion-mlxs/fusion-mlx) integration at `127.0.0.1:11434`. Auto-detects local models, zero cloud dependency. |
| ☁️ **Cloud LLM Backends** | Anthropic (direct or proxy/LiteLLM), OpenAI Codex, Azure Foundry — plug in an API key and go. Fallback model chain on 429/529 errors. |
| 🔒 **Zero Telemetry** | No outbound analytics, crash reporting, or usage tracking. Everything stays on your machine. |
| 🧩 **Builtin Plugins** | GitHub integration, UI/UX Pro Max design assistant, Chrome DevTools — all bundled, user-toggleable. |
| ⚡ **88 Feature Flags** | ULTRAPLAN multi-agent, ULTRATHINK deep reasoning, voice input, IDE bridge, and 80+ more. |
| 🛡️ **Smart Permissions** | Auto mode auto-approves safe ops, prompts only for dangerous commands. Skill-level `disallowed-tools` for fine-grained control. No LLM classifier needed. |
| 🧠 **Context Management** | Auto-compact, hard compact (deterministic, zero token cost), MLX memory safety — handles 32K windows. Compaction preserves sensitive instructions. |

---

## Quick Start

### Prerequisites

- **Bun** >= 1.3.11 — install with `curl -fsSL https://bun.sh/install | bash`
- **macOS with Apple Silicon** (M1/M2/M3/M4) for local MLX inference; Linux/Windows can use cloud providers or remote MLX

### Install & Run

```bash
git clone https://github.com/dahai80/fusion-code.git
cd fusion-code
bun install
bun run build
```

Now choose your model provider:

#### Option A: Local MLX (no cloud key needed)

```bash
# 1. Install and start fusion-mlx (separate project)
#    See: https://github.com/fusion-mlxs/fusion-mlx
pip install fusion-mlx
fusion-mlx start

# 2. Download a model (use hf-mirror.com in China)
#    Recommended models:
#      - Qwen2.5-Coder-7B-Instruct  (7B, good balance)
#      - Qwen2.5-Coder-14B-Instruct (14B, stronger reasoning)
#      - Qwen2.5-Coder-32B-Instruct (32B, best quality, needs 32GB+ RAM)
#    Example:
export HF_ENDPOINT=https://hf-mirror.com
fusion-mlx pull qwen2.5-coder-7b-instruct

# 3. Launch fusion-code — auto-detects MLX on port 11434
./fusion-code
```

#### Option B: Anthropic Cloud (direct API)

```bash
# Set your API key (persist in ~/.zshrc or ~/.bashrc)
export FUSION_API_KEY="sk-ant-..."

# Optional: pin a specific model
export FUSION_MODEL="claude-sonnet-5"

./fusion-code
```

#### Option C: Anthropic via Proxy / LiteLLM

For regions where `api.anthropic.com` is unreachable, or to share a key through a gateway:

```bash
# Point to your proxy (include the path, e.g. /v1 for OpenAI-compatible proxies)
export FUSION_BASE_URL="http://your-proxy:4000/v1"
export FUSION_API_KEY="sk-..."                    # key accepted by the proxy

# Optional: bearer token instead of x-api-key
export FUSION_AUTH_TOKEN="sk-..."

# Optional: extra headers for gateway routing
export FUSION_CUSTOM_HEADERS='{"X-Routing-Key":"abc"}'

./fusion-code
```

> **Tip:** Persist env vars by adding `export` lines to `~/.zshrc` or `~/.bashrc`, then `source ~/.zshrc`.

### Update

```bash
cd fusion-code
git pull
bun install
bun run build
```

---

## Model Providers

fusion-code supports multiple API backends. The provider is selected automatically by this priority order:

1. **fusionMlx (local)** — if `FUSION_MLX_ENABLED=1` or no cloud key is set → local MLX at `127.0.0.1:11434`
2. **openai** — if `FUSION_CODE_USE_OPENAI=1` → OpenAI Codex (OAuth)
3. **foundry** — if `FUSION_CODE_USE_FOUNDRY=1` → Azure AI Foundry
4. **firstParty (Anthropic)** — if `FUSION_API_KEY` is set → Anthropic API (direct or via proxy)

> The first matching provider wins. If none match, local MLX is auto-detected on port 11434.

**Fallback model**: When the primary model is overloaded (529) or rate-limited (429), fusion-code automatically falls back to a smaller model. The default chain is opus→sonnet→haiku. Override with `FUSION_FALLBACK_MODEL` or the `/config fallbackModel` setting.

### Provider Configuration Summary

| Provider | Required Env | Auth Method | Notes |
|---|---|---|---|
| **fusionMlx (local)** | none (auto on port 11434) | local | Apple Silicon only; use `FUSION_MLX_MODEL` to pin a model |
| **fusionMlx (remote)** | `FUSION_MLX_BASE_URL` | local or `FUSION_MLX_API_KEY` | Run MLX on another Mac, connect over network |
| **Anthropic direct** | `FUSION_API_KEY` | API key / OAuth | Set `FUSION_MODEL` to pin a model |
| **Anthropic via proxy** | `FUSION_BASE_URL` + `FUSION_API_KEY` | API key or `FUSION_AUTH_TOKEN` | LiteLLM, OpenRouter, internal gateway |
| **OpenAI Codex** | `FUSION_CODE_USE_OPENAI=1` | OAuth | In-app login flow on first launch |
| **Foundry** | `FUSION_CODE_USE_FOUNDRY=1` + `FUSION_FOUNDRY_RESOURCE` | API key / Azure AD | `FUSION_FOUNDRY_API_KEY` or Azure DefaultAzureCredential |

### Model Selection Priority

Session override (`/model`) > `--model` CLI flag > `FUSION_MODEL` / `FUSION_MLX_MODEL` env > saved settings.

### FUSION_* Environment Variables

`FUSION_*` vars are mapped to `ANTHROPIC_*` at startup for SDK compatibility:

| Fusion Variable | Anthropic Equivalent | Example |
|---|---|---|
| `FUSION_API_KEY` | `ANTHROPIC_API_KEY` | `sk-ant-api03-...` |
| `FUSION_BASE_URL` | `ANTHROPIC_BASE_URL` | `http://proxy:4000/v1` |
| `FUSION_AUTH_TOKEN` | `ANTHROPIC_AUTH_TOKEN` | `sk-...` (bearer token) |
| `FUSION_MODEL` | `ANTHROPIC_MODEL` | `claude-sonnet-5` |
| `FUSION_MLX_MODEL` | — | `qwen2.5-coder-7b-instruct` |
| `FUSION_MLX_BASE_URL` | — | `http://192.168.1.10:11434` |
| `FUSION_CUSTOM_HEADERS` | — | `{"X-Key":"val"}` |
| `FUSION_BETAS` | `ANTHROPIC_BETAS` | `max-tokens-3-5-sonnet-2024-07-15` |
| `FUSION_FALLBACK_MODEL` | — | `claude-sonnet-5` (auto-derived if unset) |
| `FUSION_CREDENTIAL_SANDBOX` | — | `1` to redact secrets from tool output |
| `FUSION_CODE_USE_BEDROCK` | — | `1` to use AWS Bedrock as provider |
| `FUSION_CODE_USE_VERTEX` | — | `1` to use Google Vertex AI as provider |
| `FUSION_SAFE_MODE` | — | `1` for read-only + no shell + no network |
| `FUSION_CODE_FOCUS_VIEW` | — | `1` to hide verbose tool output (focus mode) |

### Tuning Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CLAUDE_DISABLE_STREAM_WATCHDOG` | unset | Set to `1` to disable the stream idle watchdog (auto-aborts hung connections) |
| `CLAUDE_STREAM_IDLE_TIMEOUT_MS` | `300000` (5 min) | Milliseconds before the watchdog aborts an idle stream |
| `FUSION_CODE_FOCUS_VIEW` | unset | Set to `1` to collapse verbose tool output (focus mode) |

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+↑` | Increase effort level |
| `Ctrl+Shift+↓` | Decrease effort level |
| `/effort <level>` | Set effort level (low/medium/high/max) |
| `/focus on\|off` | Toggle focus view (collapse verbose output) |

### Cloud Configuration Details

#### Anthropic Direct

```bash
export FUSION_API_KEY="sk-ant-..."
# Optional: choose a specific model
export FUSION_MODEL="claude-sonnet-5"
./fusion-code
```

OAuth login (no API key) is also available — launch `./fusion-code` and follow the in-app browser login prompt.

#### Anthropic via Proxy / LiteLLM

Route API calls through a gateway. Useful when:
- `api.anthropic.com` is blocked in your region
- You share a key through a corporate proxy
- You run LiteLLM to unify multiple providers

```bash
export FUSION_BASE_URL="http://your-proxy:4000/v1"
export FUSION_API_KEY="sk-..."
./fusion-code
```

> **URL format:** `FUSION_BASE_URL` should point to the base endpoint. The SDK appends `/messages` automatically. For LiteLLM, use `http://host:4000` (no `/v1` suffix). For OpenAI-compatible proxies, include `/v1`.

#### OpenAI Codex

```bash
export FUSION_CODE_USE_OPENAI=1
./fusion-code   # OAuth login will start automatically
```

#### Azure AI Foundry

```bash
export FUSION_CODE_USE_FOUNDRY=1
export FUSION_FOUNDRY_RESOURCE="my-foundry"   # or FUSION_FOUNDRY_BASE_URL
export FUSION_FOUNDRY_API_KEY="..."
./fusion-code
```

Azure AD `DefaultAzureCredential` is used if no key is set. Set `FUSION_CODE_SKIP_FOUNDRY_AUTH=1` for unauthenticated test endpoints.

#### AWS Bedrock

```bash
export FUSION_CODE_USE_BEDROCK=1
export AWS_REGION="us-east-1"
# AWS credentials via environment, profile, or IAM role
./fusion-code
```

Requires `@anthropic-ai/bedrock-sdk` (`bun add @anthropic-ai/bedrock-sdk`). Set `AWS_PROFILE` for named profiles, `AWS_BEDROCK_MODEL` for model ID.

#### Google Vertex AI

```bash
export FUSION_CODE_USE_VERTEX=1
export GOOGLE_CLOUD_PROJECT="my-project"
export CLOUD_ML_REGION="us-east5"
# ADC or service account credentials
./fusion-code
```

Requires `@anthropic-ai/vertex-sdk` (`bun add @anthropic-ai/vertex-sdk`). Set `VERTEX_MODEL` for model ID.

#### Safe Mode

```bash
./fusion-code --safe-mode
# Equivalent to: FUSION_SAFE_MODE=1 FUSION_CREDENTIAL_SANDBOX=1
```

Read-only mode: Write, Edit, Bash, WebFetch, and network tools are disabled. Credential sandbox auto-enabled.

#### Screen Reader Mode

```bash
./fusion-code --ax-screen-reader
# Equivalent to: FUSION_SCREEN_READER=1
```

Disables animations and spinner effects for screen reader compatibility. Toggle at runtime with `/screen-reader` (alias: `/ax`).

#### MCP Authentication

```bash
fusion-code mcp login <server-name>   # Start OAuth flow for an MCP server
fusion-code mcp logout <server-name>  # Clear stored authentication
```

#### Remote fusion-mlx

Run fusion-mlx on another Mac and connect over the network:

```bash
export FUSION_MLX_BASE_URL="http://192.168.1.10:11434"
# Optional: if the remote requires auth
export FUSION_MLX_API_KEY="..."
./fusion-code
```

---

## Local MLX

### Setup

1. **Install fusion-mlx**: `pip install fusion-mlx` (see [fusion-mlx repo](https://github.com/fusion-mlxs/fusion-mlx))
2. **Start the server**: `fusion-mlx start` — listens on `127.0.0.1:11434`
3. **Download a model** (use HuggingFace mirror in China):

```bash
# In China, set the mirror first
export HF_ENDPOINT=https://hf-mirror.com

# Download a recommended model
fusion-mlx pull qwen2.5-coder-7b-instruct
```

4. **Pin a specific model** (optional):

```bash
export FUSION_MLX_MODEL="qwen2.5-coder-14b-instruct"
./fusion-code
```

### Recommended Models

| Model | Size | RAM Needed | Best For |
|---|---|---|---|
| `qwen2.5-coder-7b-instruct` | 7B | 8 GB | Fast responses, code completion |
| `qwen2.5-coder-14b-instruct` | 14B | 16 GB | Stronger reasoning, balanced |
| `qwen2.5-coder-32b-instruct` | 32B | 32 GB+ | Best quality, complex tasks |

> Port 11434 is Ollama-compatible. If you already run Ollama with a code model, fusion-code can use it directly.

### MLX Prompt Tier System

Local models have limited context windows. The system prompt and tool set are automatically scaled by model size:

| Tier | Model Size | Context | ~System Tokens | Tools |
|---|---|---|---|---|
| `mini` | ≤3B | any | ~2K | 5 core |
| `compact` | 32B+ | ≤32K | ~3K | 5 core |
| `standard` | 7B-9B | any | ~8K | 9 standard |
| `extended` | 14B | any | ~12K | 15 extended |
| `full` | 32B+ | >32K | ~24K | all |

**Compact tier** keeps system prompt to ~3K tokens, restricts tools to 5 core (Read, Edit, Bash, Glob, Grep), leaving ~24K tokens for conversation.

Tool tiers:
- **core** (≤32K window): Read, Edit, Bash, Glob, Grep + MCP tools
- **standard** (≤64K window): core + Write, LS
- **extended** (>64K window): standard + TodoRead/Write, TaskCreate/Get/Update/List, WebSearch/Fetch

AutoCompact triggers at 60% of the effective context window. On 32K windows, hard compact uses deterministic truncation (zero LLM call, zero token cost) instead of summarization.

### MLX User Experience

When using fusion-mlx as the provider, claude.ai-dependent features are automatically hidden or adapted:

- **`/login` and `/logout`** — hidden (MLX doesn't require claude.ai authentication)
- **Voice mode** — hidden (requires claude.ai audio streaming)
- **Channels** — hidden (requires claude.ai infrastructure)
- **Teleport / remote-env** — hidden (requires claude.ai sessions)
- **Remote agent scheduling** — hidden (requires claude.ai infrastructure)
- **Auth error messages** — show "fusion-mlx not available · Run `fusion service start mlx` or set FUSION_API_KEY" instead of "Not logged in · Run /login"

This ensures MLX users never encounter confusing claude.ai login prompts.

### Local Model Behavioral Prompt

When `provider=fusionMlx`, fusion-code automatically appends a **behavioral prompt** (~2.9K tokens) to the system prompt. This prompt covers:

- **Primary priorities** — correctness, usefulness, honesty, clarity
- **Understanding requests** — distinguish facts, assumptions, uncertainty, opinion
- **Reasoning** — think step-by-step, consider edge cases, verify conclusions
- **Communication** — be concise, structure complex answers, admit knowledge limits
- **Coding** — read before writing, match existing style, test what you change
- **Reliability** — never fabricate information, flag contradictions, fail visibly

The prompt is derived from the vendor-neutral Fable 5 system prompt (balanced tier). It only activates for local models — cloud providers already have strong behavioral training. The corresponding **core tier** (~1.4K, 13 principles) is injected by fusion-mlx on the inference side when no system message exists, ensuring even bare API calls get baseline guidance.

### Context Hub Integration

fusion-code auto-detects the [Context Hub](https://github.com/anthropics/context-hub) (`chub`) CLI and injects a hint into researcher, explorer, code-reviewer, and general-purpose sub-agents. When available, agents will:

1. Use `chub search "query"` to find relevant API documentation
2. Use `chub get <id> --lang <py|js|go>` to fetch versioned docs
3. Reduce hallucination by referencing verified, up-to-date documentation

Install Context Hub separately: `npm install -g @aisuite/chub`. No configuration needed — fusion-code detects it automatically.

For MCP-based integration (all agent types, not just sub-agents), add to `~/.fusion-code/settings.json`:

```json
{
  "mcpServers": {
    "chub-mcp": {
      "command": "npx",
      "args": ["-y", "@aisuite/chub-mcp"]
    }
  }
}
```

---

## Build

```bash
bun run build              # ./fusion-code (production, VOICE_MODE only)
bun run build:dev          # ./fusion-code-dev (dev stamp, VOICE_MODE only)
bun run build:dev:full     # ./fusion-code-dev (all experimental flags)
bun run compile            # ./dist/fusion-code (alternative output)
```

### Custom Feature Flags

```bash
# Enable specific flags
bun run ./scripts/build.ts --feature=ULTRAPLAN --feature=ULTRATHINK

# Dev build with all flags + extras
bun run ./scripts/build.ts --dev --feature-set=dev-full --feature=BRIDGE_MODE
```

---

## Usage

```bash
./fusion-code                          # Interactive REPL
./fusion-code -p "explain this code"   # One-shot mode
./fusion-code --model <model-id>       # Override model
bun run dev                            # Run from source
```

### Permission Modes

Press **Shift+Tab** to cycle modes:

| Mode | Behavior | Best For |
|---|---|---|
| **Manual** | Ask for every tool use | First-time users, cautious workflows |
| **Auto** ✅ | Auto-approve safe ops; prompt for dangerous ones; block irreversible ops | Daily coding (recommended) |
| **Accept Edits** | Auto-approve file edits; ask for bash | Refactoring, code generation |
| **Plan** | Read-only — no file/command execution | Code review, exploration |

**Auto mode** uses `classifyAllShell` — a deterministic classifier for every shell command. Safe commands (`ls`, `cat`, `git status`, `npm install`, `make`, etc.) are auto-approved. Dangerous commands (`rm -rf`, `sudo`, `git push`, `docker rm`, `python`, `node -e`) require confirmation. Irreversible commands (`git push --force`, `terraform destroy`, `kubectl delete`, `DROP TABLE`) are hard-denied even in auto mode. Unknown commands default to requiring confirmation.

### Dynamic Workflows (YAML + JS)

Workflows can be defined in YAML or JavaScript. YAML workflows are auto-converted to JS scripts at runtime:

```yaml
# .claude/workflows/review.yaml
name: review-changes
description: Review changed files across dimensions
phases:
  - title: Review
  - title: Verify
steps:
  - agent: Review code for bugs and security issues
    phase: Review
    label: review-bugs
  - agent: Review code for performance problems
    phase: Review
    label: review-perf
  - agent: Verify findings with adversarial checks
    phase: Verify
    label: verify
```

JS workflows use `agent()`, `phase()`, `pipeline()`, and `parallel()` directly (see [Workflow docs](src/tools/WorkflowTool/)).

### Notable Slash Commands

| Command | Description |
|---|---|
| `/model` | Switch or inspect the active model (persists across sessions) |
| `/compact` | Compact conversation context to free space |
| `/usage` | Show token usage, cost, and activity statistics (aliases: `/stats`, `/cost`) |
| `/cd` | Change working directory within the REPL |
| `/code-review` | Review code with optional `--fix` for auto-fix mode (alias: `/review`) |
| `/reload-skills` | Hot-reload commands, plugins, and skills without restart |
| `/doctor` | Diagnose common setup issues |
| `/env` | Display provider, model, and key environment variables |
| `/ctx_viz` | Visualize context window usage |
| `/summary` | Generate a summary of the current conversation |
| `/workflows` | List and run workflow scripts (supports YAML and JS) |
| `/subtask` | Spawn an inline sub-agent to handle a specific task |
| `/fork` | Create a sub-agent fork in the current conversation context |
| `/break-cache` | Reset prompt cache break detection |
| `/goal` | Goal management with budget tracking (`/goal <text> [--budget turns=N,tokens=N]`, `/goal status`, `/goal pause`, `/goal resume`, `/goal cancel`, `/goal replace <text>`, `/goal next <text>`, `/goal clear`) |
| `/undo` (`/rewind`) | Undo N anchor points (`/undo [N]`) with compaction-boundary awareness |
| `/health` | Task health overview and recovery (`/health`, `/health recover`, `/health kill-all`) |
| `/steer` | Inject follow-up input into the current turn (`/steer <text>`) |
| `/btw` | Ask a side question without interrupting the main workflow (`/btw <question>`) |
| `/approve-session` | Auto-approve a tool for the session (`/approve-session <tool>`, `--clear`, `--list`) |
| `/focus` | Toggle focus view — hide verbose tool output (`/focus on\|off`) |
| `/tui` | Toggle flicker-free fullscreen rendering (`/tui on\|off`) |
| `/dataviz` | Generate terminal data visualizations (bar charts, sparklines, tables) |
| `/recap` | Show a recap of the current session (useful when returning after a break) |
| `/plugins` | List installed plugins with scope, version, and install date |
| `/less-permission-prompts` | Suggest allow rules for read-only tools; `--apply` to persist |
| `/screen-reader` (`/ax`) | Toggle screen reader mode (disable animations, plain text status) |
| `/memory-search` | Search saved memories and project context files |
| `/history-search` | Search conversation transcripts with privacy sanitization |
| `/suggest` | Get next-action suggestions based on recent tool usage |
| `/deploy` | Detect project deployment platform and show deploy commands |
| `/preview` | Detect dev server config and show connection info |
| `/scaffold` | Generate framework-specific project scaffolding instructions |
| `/progress` | Show event stream history (checkpoints, actions, plans) |
| `/research` | Deep research mode with multi-step search and synthesis |
| `/run` | Execute code snippets via Bash tool |
| `/tour` | Interactive feature walkthrough and project onboarding |
| `/integrations` | Integration marketplace — list, search, add MCP integrations |
| `/diagram` | Generate diagrams (flowchart, sequence, architecture) from descriptions |
| `/tool-discovery` | Show tool tier classification, deferred tools, and usage metrics |
| `/agent-orchestrator` | Multi-agent orchestrator: spawn, list, merge, and manage agents |

### Builtin Plugins

| Plugin | Description | Default |
|---|---|---|
| **GitHub** | Issue/PR integration, gh CLI wrapper | Enabled |
| **UI/UX Pro Max** | Design system assistant (auto-installs from uipro-cli) | Enabled |
| **Chrome DevTools** | Browser inspection, screenshots, performance | Enabled |

Toggle with `/plugin` inside the REPL.

### Project Instructions (CLAUDE.md)

Place a `CLAUDE.md` file in your project root to give fusion-code project-specific instructions — coding standards, architecture notes, preferred libraries. It is automatically loaded on startup and committed to version control so your whole team shares the same AI behavior.

### Multilingual Session Titles

Session titles are auto-generated in the same language as your first message. Chinese input → Chinese title, English → English, etc.

---

## Experimental Features

The `bun run build:dev:full` build enables all working feature flags. The default `bun run build` includes only `VOICE_MODE`.

### Interaction & UI

| Flag | Description |
|---|---|
| `ULTRAPLAN` | Remote multi-agent planning (Opus-class) |
| `ULTRATHINK` | Deep thinking mode — type "ultrathink" to boost reasoning effort |
| `VOICE_MODE` | Push-to-talk voice input and dictation ✅ (default) |
| `TOKEN_BUDGET` | Token budget tracking and usage warnings |
| `D_MAIL` | Agent-driven context compression (D-Mail checkpoint/revert) |
| `APPROVE_SESSION` | Session-scoped permission approvals with cancel-by-source |
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

All 34 historically-broken flags were fixed on 2026-07-23. See [FEATURES.md](FEATURES.md) for the full audit of all 88 flags.

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
    compact/              # Context compaction (auto/reactive/micro + hardCompact + smartCompactV2)
    privacy/              # Privacy sanitizer (password/secret/token redaction)
    model-router/         # Multi-tier model routing (trivial/standard/complex/safety)
    search-first/         # Search policy engine (when to search the web)
    suggestions/          # Context-aware next-action suggestion engine
    events/               # Event stream (action/progress/checkpoint/plan)
    deploy/               # Deploy platform detection (Netlify/Vercel/CF/GitHub)
    dev-server/           # Dev server detection (Vite/Next/Nuxt/SvelteKit etc.)
    research/             # Deep research engine (plan + multi-step search + synthesize)
    license-check/        # License detection and copyright awareness
    visualizer/           # Diagram generation (Mermaid + ASCII prompts)
    onboarding/           # Project profile detection and feature suggestions
  state/                  # App state store
  utils/
    model/providers.ts    # Provider selection (getAPIProvider)
  skills/                 # Skill system
  plugins/                # Plugin system (builtin: GitHub, UI/UX Pro Max, Chrome DevTools)
  bridge/                 # IDE bridge (VS Code, JetBrains)
  voice/                  # Voice input
  tasks/                  # Background task management
```

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
| **Cloud APIs** | Anthropic Messages, OpenAI Codex, Azure Foundry |

---

## Development

### Build & Lint Status

| Check | Status |
|---|---|
| `tsc --noEmit` | ✅ Zero errors (was 511) |
| `tsc --noEmit --noUnusedLocals` | ✅ Zero real errors (TS6196/TS6192 type warnings remain) |
| `bun run build` | ✅ Passes |
| `bun run build:dev` | ✅ Passes |

### Lint Zeroing History

The `chore/ci-lint-zero` branch fixed all 511 TypeScript errors through:

1. **Build-constant helpers** (`src/utils/buildConstants.ts`) — 91 TS2367 "unreachable comparison" errors replaced with `isInternalBuild()`, `isTestEnv()`, `isDevEnv()` across 27 files
2. **Internal module stubs** — 10 no-op stubs for Anthropic-internal modules that don't exist in the external repo
3. **Unused React imports** — 245+ `import React from 'react'` removed (project uses `jsx: "react-jsx"`)
4. **Unused imports & dead code** — 400+ unused import removals across 329 files, dead functions/constants removed
5. **ProcessEnv widening** — `USER_TYPE?: string` added to `env.d.ts` to prevent future TS2367 errors

### Post-Lint Regression Fixes

The lint-zero merge (`4710056`) introduced a startup regression against local MLX. Fixed in this patch:

1. **REPL first-paint crash** (`src/screens/REPL.tsx`) - the lint rewrite left a bare `{" "}` space string inside a `<>` fragment between `SpinnerWithVerb` and `BriefIdleStatus`. Ink's `createTextInstance` rejects bare strings outside `<Text>`, crashing startup with `Text string " " must be rendered inside <Text> component`. Removed the stray space, restoring the v0.3.2 layout.
2. **Stray `function` stdout** (`src/services/api/fusion-mlx-adapter.ts`) - `checkFusionMlxHealth()` carried a leftover debug `console.error(typeof getOriginalFetch())` that printed `function` to stderr on every MLX health check. Removed.
3. **Dev-mode SDK export** (`src/entrypoints/sdk/coreTypes.ts`) - type-only re-exports were emitted as value exports, causing "export not found" in dev mode. Changed `export {` to `export type {`.

Verified: `bun run dev` against a live fusion-mlx (port 11434) no longer prints `function` and no longer crashes on first paint.

### v0.3.4 Patch Fixes

Two regressions from the permission-prompt refactor, fixed in this patch:

1. **renderToolUseMessage crash** (`src/Tool.ts`, `src/tools/BashTool/UI.tsx`, `src/tools/PowerShellTool/UI.tsx`) - permission prompts called `BashTool.renderToolUseMessage(input, {theme, verbose})` with 2 args, but the `BuiltTool` type resolved the method signature from `TOOL_DEFAULTS` (0-1 params) because `renderToolUseMessage` sits in `DefaultableToolKeys` and `ToolDef` marks it optional. At runtime the implementation destructured `undefined` for the 2nd param, crashing with `Cannot destructure property 'verbose'`. Added an optional `_opts` to the default implementation so the `ToolDefaults` type allows 0-2 params, and made `{verbose, theme}` optional in the UI with `verbose` defaulting to `false`.
2. **Mode hint overlap** (`src/components/PromptInput/PromptInputFooterLeftSide.tsx`) - the `⏵⏵ auto mode on (shift+tab to cycle)` hint rendered beside a 2-item footer and overlapped the input box while typing. Gated it on `showHint` so it hides while the user is typing.

Verified: `bun run typecheck` clean; `bun run build` and `bun run build:dev` pass; `./fusion-code-dev --version` reports `0.3.4-dev`.

### v0.3.5 Patch Fixes

1. **SessionEnd hook crash** (`src/utils/hooks.ts`) - when a SessionEnd hook script exits 0 with no JSON stdout, `parseHookOutput` returns `json=null`. The code `(json as TypedHookJSON).hookSpecificOutput` accessed `.hookSpecificOutput` on `null`, crashing with `undefined is not an object (evaluating 'R.hookSpecificOutput')`. Added null guard so `hso2` is `undefined` when `json` is null. Fixes #9, PR #10.

Verified: `bun run typecheck` clean; `bun run build:dev` passes; exiting fusion-code no longer crashes.

### Build-Time Constants

The bundler replaces `process.env.USER_TYPE` with `"external"` and `process.env.NODE_ENV` with `"production"`. Internal-only code paths use helper functions from `src/utils/buildConstants.ts`:

- `isInternalBuild()` — returns `true` only in Anthropic employee builds
- `isTestEnv()` — returns `true` when `NODE_ENV === "test"`
- `isDevEnv()` — returns `true` when `NODE_ENV === "development"`

### Internal Module Stubs

Some modules only exist in the internal Anthropic repo. The external repo provides no-op stubs:

- `src/utils/ccshareResume.ts`
- `src/utils/eventLoopStallDetector.ts`
- `src/utils/sdkHeapDumpMonitor.ts`
- `src/utils/sessionDataUploader.ts`
- `src/utils/computeTtftText.ts`
- `src/components/AntModelSwitchCallout.tsx`
- `src/components/UndercoverAutoCallout.tsx`
- `src/components/TungstenPill.tsx`
- `src/components/Gates.tsx`

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes (`git commit -m 'feat: add something'`)
4. Push to the branch (`git push origin feat/my-feature`)
5. Open a Pull Request

For upstream `fusion-mlx` issues: file an issue first, then a PR, following the upstream contribution flow.

---

## License

Use at your own discretion. See the project license terms for details.
