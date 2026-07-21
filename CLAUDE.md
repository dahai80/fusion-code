# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common commands

```bash
# Install dependencies
bun install

# Standard build (./cli, only VOICE_MODE enabled)
bun run build

# Dev build (./cli-dev, only VOICE_MODE enabled)
bun run build:dev

# Dev build with all experimental features (./cli-dev)
bun run build:dev:full

# Compiled build (./dist/cli)
bun run compile

# Run from source without building
bun run dev

# Custom feature flags
bun run ./scripts/build.ts --feature=ULTRAPLAN --feature=ULTRATHINK
bun run ./scripts/build.ts --dev --feature=BRIDGE_MODE
```

Run the built binary with `./cli` or `./cli-dev`. Set `FUSION_API_KEY` or `ANTHROPIC_API_KEY` for cloud providers, or use local MLX via `fusion service start mlx` (auto-detected on port 11434).

No test framework or linter is configured in this repo.

## High-level architecture

- **Entry point**: `src/entrypoints/cli.tsx` bootstraps the CLI. It sets `FUSION_CODE_CONFIG_DIR=~/.fusion-code`, maps `FUSION_*` env vars to `ANTHROPIC_*` equivalents for SDK compatibility, and dispatches fast-path subcommands (`--version`, `--dump-system-prompt`, bridge/daemon/ps modes) before falling through to the full REPL via `src/main.js` → `cliMain()`.
- **Main UI**: `src/screens/REPL.tsx` is a React/Ink terminal UI. One `QueryEngine` per conversation; `submitMessage()` starts a new turn. Handles keybindings, voice input, task lists, compaction, tool permissions, and session management.
- **Command/tool registries**: `src/commands.ts` registers ~40+ slash commands; `src/tools.ts` registers 30+ agent tools. Implementations live in `src/commands/` and `src/tools/`. Feature-gated tools/commands are dead-code-eliminated when their flag is off.
- **LLM query pipeline**: `src/QueryEngine.ts` coordinates message flow, tool use, and model invocation. Owns session state (`mutableMessages`, `abortController`, `totalUsage`).

## Core subsystems

- `src/services/api/` — API clients. `claude.ts` is the main Anthropic client; `fusion-mlx-adapter.ts` + `fusion-mlx-stream.ts` handle local MLX inference; `codex-fetch-adapter.ts` for OpenAI Codex.
- `src/services/oauth/` — OAuth flows for Anthropic and OpenAI.
- `src/services/mcp/` — Model Context Protocol integration.
- `src/services/lsp/` — Language Server Protocol integration.
- `src/state/` — App state store.
- `src/hooks/` — React hooks used by UI/flows.
- `src/components/` — Terminal UI components (Ink).
- `src/skills/` — Skill system.
- `src/plugins/` — Plugin system.
- `src/bridge/` — IDE bridge (VS Code, JetBrains).
- `src/voice/` — Voice input.
- `src/tasks/` — Background task management.
- `src/utils/model/` — Model configs, providers, validation. `providers.ts` defines `APIProvider`: `firstParty | bedrock | vertex | foundry | openai | fusionMlx`.

## Model provider system

The provider is selected by `getAPIProvider()` in `src/utils/model/providers.ts`:

1. If `FUSION_MLX_ENABLED=1` or no cloud API key is set → `fusionMlx` (local inference at 127.0.0.1:11434)
2. If `FUSION_CODE_USE_OPENAI=1` → `openai`
3. If `FUSION_CODE_USE_FOUNDRY=1` → `foundry`
4. If `CLAUDE_CODE_USE_BEDROCK=1` → `bedrock`
5. If `CLAUDE_CODE_USE_VERTEX=1` → `vertex`
6. Otherwise → `firstParty` (Anthropic API with `FUSION_API_KEY` / `ANTHROPIC_API_KEY`)

Fusion-MLX auto-detection: `shouldAutoUseFusionMlx()` checks port 11434 availability and auto-selects a code-capable text model.

Model resolution priority: session override (`/model`) > `--model` flag > `FUSION_MODEL` / `FUSION_MLX_MODEL` env > saved settings.

## Build system

`scripts/build.ts` uses Bun's native bundler (`bun build --compile`). Feature flags are passed via `--feature=NAME` and used as `feature('X')` calls for dead-code elimination. 34 experimental features exist; only `VOICE_MODE` is enabled by default. `--feature-set=dev-full` enables all of them.

Build-time macros: `MACRO.VERSION`, `MACRO.BUILD_TIME`, `process.env.USER_TYPE` (set to `"external"`). In dev builds, `process.env.CLAUDE_CODE_EXPERIMENTAL_BUILD` is set.

Native modules excluded from bundle: `@ant/*`, `audio-capture-napi`, `image-processor-napi`, `modifiers-napi`, `url-handler-napi`.

## Environment variable mapping

`FUSION_*` env vars are mapped to `ANTHROPIC_*` at startup for SDK compatibility:

| Fusion env | Anthropic equivalent |
|---|---|
| `FUSION_API_KEY` | `ANTHROPIC_API_KEY` |
| `FUSION_BASE_URL` | `ANTHROPIC_BASE_URL` |
| `FUSION_AUTH_TOKEN` | `ANTHROPIC_AUTH_TOKEN` |
| `FUSION_MODEL` | `ANTHROPIC_MODEL` |
| `FUSION_BETAS` | `ANTHROPIC_BETAS` |
