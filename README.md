<p align="center">
  <img src="assets/screenshot.png" alt="fusion-code" width="720" />
</p>

<h1 align="center">fusion-code</h1>

<p align="center">
  <strong>A terminal-native AI coding agent with deep local MLX integration.</strong><br>
  A buildable fork of Claude Code. Cloud telemetry stripped. Experimental features unlocked. Local-first.<br>
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

fusion-code is a buildable fork of Anthropic's [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI -- the terminal-native AI coding agent. The upstream source became publicly available on March 31, 2026 through a source map exposure in the npm distribution.

This fork applies three categories of changes on top of that snapshot:

### Local inference first

Deeply integrated with [fusion-mlx](https://github.com/fusion-mlxs/fusion-mlx) local MLX inference at `127.0.0.1:11434`. When no cloud API key is set, a local model is auto-selected so data never leaves the machine. The streaming adapter suppresses `<tool_call>` markup leakage and supports prefix-cache reuse.

### Cloud telemetry stripped

The upstream binary phones home through OpenTelemetry/gRPC, GrowthBook analytics, Sentry error reporting, and custom event logging. In this build:

- All outbound telemetry endpoints are dead-code-eliminated or stubbed
- GrowthBook feature flag evaluation still works locally (needed for runtime feature gates) but does not report back
- No crash reports, no usage analytics, no session fingerprinting

### Experimental features unlocked

Claude Code ships with 88 feature flags gated behind `bun:bundle` compile-time switches. This build unlocks all 54 flags that were already clean, plus the 34 flags that previously failed to bundle -- all 34 were fixed on 2026-07-23. See [FEATURES.md](FEATURES.md) for the full audit.

---

## Model Providers

fusion-code supports **six API providers** out of the box. The provider is selected by `getAPIProvider()` in `src/utils/model/providers.ts`:

1. **fusionMlx (local, default)** -- `FUSION_MLX_ENABLED=1` or no cloud key set -> local MLX inference at `127.0.0.1:11434`
2. **firstParty (Anthropic)** -- `FUSION_API_KEY` / `ANTHROPIC_API_KEY`
3. **openai** -- `FUSION_CODE_USE_OPENAI=1`
4. **foundry** -- `FUSION_CODE_USE_FOUNDRY=1`
5. **bedrock** -- `CLAUDE_CODE_USE_BEDROCK=1`
6. **vertex** -- `CLAUDE_CODE_USE_VERTEX=1`

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

### Cloud provider quick switch

```bash
# OpenAI Codex
export FUSION_CODE_USE_OPENAI=1

# AWS Bedrock
export CLAUDE_CODE_USE_BEDROCK=1
export AWS_REGION="us-east-1"

# Google Vertex AI
export CLAUDE_CODE_USE_VERTEX=1

# Anthropic Foundry
export FUSION_CODE_USE_FOUNDRY=1
export ANTHROPIC_FOUNDRY_API_KEY="..."
```

| Provider | Env Variable | Auth Method |
|---|---|---|
| fusionMlx (default) | `FUSION_MLX_ENABLED=1` or no key | Local (port 11434) |
| Anthropic (default cloud) | -- | `FUSION_API_KEY` or OAuth |
| OpenAI Codex | `FUSION_CODE_USE_OPENAI=1` | OAuth via OpenAI |
| AWS Bedrock | `CLAUDE_CODE_USE_BEDROCK=1` | AWS credentials |
| Google Vertex AI | `CLAUDE_CODE_USE_VERTEX=1` | `gcloud` ADC |
| Anthropic Foundry | `FUSION_CODE_USE_FOUNDRY=1` | `ANTHROPIC_FOUNDRY_API_KEY` |

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
- **OS**: macOS or Linux (Windows via WSL)
- **Auth**: An API key / OAuth login for cloud, or fusion-mlx running locally

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
./fusion-code --model claude-opus-4-6

# Run from source (slower startup)
bun run dev
```

---

## Experimental Features

The `bun run build:dev:full` build enables all working feature flags. Highlights:

### Interaction & UI

| Flag | Description |
|---|---|
| `ULTRAPLAN` | Remote multi-agent planning on Claude Code web (Opus-class) |
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
    compact/              # Context compaction (auto/reactive/micro + postCompactCleanup)
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
| **Cloud APIs** | Anthropic Messages, OpenAI Codex, AWS Bedrock, Google Vertex AI, Anthropic Foundry |

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

The original Claude Code source is the property of Anthropic. This fork exists because the source was publicly exposed through their npm distribution. Use at your own discretion.
