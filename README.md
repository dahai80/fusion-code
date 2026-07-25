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
| ☁️ **Cloud LLM Backends** | Anthropic (direct or proxy/LiteLLM), OpenAI Codex, Azure Foundry — plug in an API key and go. |
| 🔒 **Zero Telemetry** | No outbound analytics, crash reporting, or usage tracking. Everything stays on your machine. |
| 🧩 **Builtin Plugins** | GitHub integration, UI/UX Pro Max design assistant, Chrome DevTools — all bundled, user-toggleable. |
| ⚡ **88 Feature Flags** | ULTRAPLAN multi-agent, ULTRATHINK deep reasoning, voice input, IDE bridge, and 80+ more. |
| 🛡️ **Smart Permissions** | Auto mode auto-approves safe ops, prompts only for dangerous commands. No LLM classifier needed. |
| 🧠 **Context Management** | Auto-compact, hard compact (deterministic, zero token cost), MLX memory safety — handles 32K windows. |

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
| **Default** | Ask for every tool use | First-time users, cautious workflows |
| **Auto** ✅ | Auto-approve safe ops; prompt for dangerous ones | Daily coding (recommended) |
| **Accept Edits** | Auto-approve file edits; ask for bash | Refactoring, code generation |
| **Plan** | Read-only — no file/command execution | Code review, exploration |

**Auto mode** uses deterministic rules (no LLM classifier). Safe commands (`ls`, `cat`, `git status`, `npm install`, `make`, etc.) are auto-approved. Dangerous commands (`rm -rf`, `sudo`, `git push`, `docker rm`, `python`, `node -e`) still require confirmation.

### Notable Slash Commands

| Command | Description |
|---|---|
| `/model` | Switch or inspect the active model |
| `/compact` | Compact conversation context to free space |
| `/cost` | Show token usage and cost for the session |
| `/doctor` | Diagnose common setup issues |
| `/env` | Display provider, model, and key environment variables |
| `/ctx_viz` | Visualize context window usage |
| `/summary` | Generate a summary of the current conversation |
| `/workflows` | List and run workflow scripts |
| `/break-cache` | Reset prompt cache break detection |

### Builtin Plugins

| Plugin | Description | Default |
|---|---|---|
| **GitHub** | Issue/PR integration, gh CLI wrapper | Enabled |
| **UI/UX Pro Max** | Design system assistant (auto-installs from uipro-cli) | Enabled |
| **Chrome DevTools** | Browser inspection, screenshots, performance | Enabled |

Toggle with `/plugin` inside the REPL.

### Project Instructions (CLAUDE.md)

Place a `CLAUDE.md` file in your project root to give fusion-code project-specific instructions — coding standards, architecture notes, preferred libraries. It is automatically loaded on startup and committed to version control so your whole team shares the same AI behavior.

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
    compact/              # Context compaction (auto/reactive/micro + hardCompact)
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
