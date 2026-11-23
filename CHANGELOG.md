---
doc_id: fusion-code/changelog
product: fusion-code
class: app
entry: guided-ui
doc_type: changelog
title: { zh: "变更日志", en: "Changelog" }
audience: engineer
status: draft
version: 0.8.17
updated: 2026-11-23
owner: "@dahai"
source_of_truth:
  - CHANGELOG.md
---

# Changelog

All notable changes to fusion-code are documented here.

## Unreleased

## 0.8.17 - 2026-11-23

- **Bench (#315)**: harness-gain runner now captures the per-task session transcript (newest `projects/**/*.jsonl` under the task's isolated config dir) next to the task log as `*.transcript.jsonl` — failures root-cause from the full turn-by-turn record instead of a stdout tail. Best-effort copy; never fails the run. Bench tooling only — no binary behavior change.

## 0.8.16 - 2026-11-22

- **Test env-leak fix (#313)**: `tests/commands/model-command.test.ts` set `FUSION_MLX_ENABLED=1` in a file-level `beforeEach` with no restore — every later test file in the same bun worker inherited MLX provider routing, which broke `computeContextWindowWarning` (the long-standing full-suite flake that failed on clean main and passed in isolation). Env snapshot + restore in `afterEach`. Full suite: 1826 tests, 0 fail, twice consecutively.

## 0.8.15 - 2026-11-22

- **Edit fuzzy anchor (#308)**: weak local models emit `old_string` with wrong indentation/whitespace drift; byte-exact matching burns recovery turns. New third matching tier in `FileEditTool`/`MultiEditTool` — whitespace-flexible regex fallback (unique match required, word-boundary guarded for single-line searches) plus `rebalanceIndent` that shifts the replacement by the file's indent delta when the fuzzy tier fired. Only fires after exact and quote-normalized matching miss — no change on any input that previously succeeded. Harness-gain Qwen3.8-27B: compact ACI 16/20 (was 12/20).
- **Verify-before-report nudge (#309)**: small local models declare done without running the falsifying test. On the final text turn, if edits happened after the last test/build command, one local-MLX-gated meta nudge asks the model to verify before finishing (1 per session, `verify_before_report` transition).
- **Command loop guard fix (#310)**: `checkCommandLoop` ran pre-exec with always-empty output — a plain repeat counter, not an output loop detector. Now runs post-completion on real stdout; exit-0 repeats get a "already succeeded, report the earlier result" message instead of a dead-end error that small models answered by retrying endlessly.
- **Bench config isolation (#311)**: harness-gain runs now point `FUSION_CODE_CONFIG_DIR` at a fresh temp dir so host `~/.fusion-code` hooks (e.g. RTK command rewrite) no longer leak into measured runs.

## 0.8.14 - 2026-11-21

- **Tool-call-as-text recovery (#304)**: small local models (Qwen3-8B class on fusion-mlx) intermittently emit a tool call as plain text — the turn then looks finished and the session dies unsolved. When the final assistant text matches a tool-call shape (`Name({...})` with a real tool name, `call_<id>{...}`, `<tools>{...}`), the loop now feeds the turn back with a format-correction meta message (mirrors the max-output-tokens recovery pattern; capped at 2 attempts, second one escalates edits to whole-file Write). Gated to local MLX. Bench runner gains a per-task `textEmissions` metric plus verifier/driver fixes (60s verifier bounds, goose headless flags, permissions skip in `-p`).
- **Compact prompt tier for ≤9B local models (#306)**: `getPromptTier` now returns `compact` for models ≤9B params (was `standard`). Same checkpoint, same engine: harness-gain resolve 3/20 → 10/20, mean wall 130s → 74s — prompt size was the dominant gap (ties goose's small-prompt harness measured the same day). `FUSION_CODE_MLX_PROMPT_TIER` env override forces any tier for A/B comparison; invalid values fall back to the automatic mapping.
- **Research (#305)**: small-model tool-calling survey (`docs/research/small-model-tool-calling-2026-11.md` — root-cause experiments, constrained-decoding/ACI/training-flywheel landscape, ranked options) and bench report #2 (`docs/research/bench-reports/2026-11-20-r2.md`) with the cross-harness baseline: fusion-code 3/20, opencode 2/20 (11× 600s deaths), goose 10/20 — 5x resolve-rate gap by harness on identical checkpoint.

## 0.8.13 - 2026-11-21

- **i18n (#302)**: last non-test `src/` Chinese comment/string debt translated (4 files: `src/ink/screen.ts`, `src/tools/ConfigTool/supportedSettings.ts`, `src/utils/computerUse/appNames.ts`, `src/utils/modelCost.ts` — `Local (免费)` → `Local (free)`); closes #299. Kept deliberately: Chinese examples inside the session-title LLM prompt (functional), multilingual UI examples in `LanguagePicker`/`useVoice`. Non-test `src/` comment/log Chinese residue is now 0.

## 0.8.12 - 2026-11-20

- **Bench fix (#297)**: harness-gain `verify()` command branches (`command-exit` / `command-stdout` / `pytest`) crashed with `TypeError: cmd must be an array` — Bun `spawnSync` signature, not Node `child_process`. Command-verified tasks now complete a real run and emit a verdict.
- **i18n (#298)**: all 27 Chinese comments in `src/services/api/fusion-mlx-stream.ts` translated to English (comments only, no behavior change); closes #296. Broader English-only debt tracked in #299 (274 files).

## 0.8.11 - 2026-11-20

- **Bench (#291, #294)**: harness-gain task suite v1 — 20 deterministic tasks (4 easy / 8 medium / 8 hard) with file-based verification (file-contains / pytest / command-exit / json-field / grep-absent), no LLM judging; plus the runner (fixture generation, per-harness drivers, deterministic verify, usage recording). Targets fusion-code vs opencode 1.19.6 vs goose 3.30.1. Bench tooling only — no binary behavior change.

## 0.8.10 - 2026-11-20

- **Diagnostics (#292)**: the `Local inference service unavailable` error now reports the actual resolved endpoint (URL + winning env var + full precedence chain) instead of a hardcoded `default: 11432`. `FUSION_GATEWAY_URL` silently shadows `FUSION_MLX_BASE_URL` — the new message makes that visible immediately (#290).

## 0.8.9 - 2026-11-20

- **Fix (#288)**: engine prompt-cache reads now surface in usage accounting. The OpenAI-endpoint translation layer dropped `prompt_tokens_details.cached_tokens`, so every MLX session recorded `cache_read_input_tokens = 0` (125M baseline input tokens looked fully uncached). Streaming `message_delta` and the non-stream transform now map `cached_tokens` -> `cache_read_input_tokens`; field omitted when 0/absent, so uncached runs stay byte-identical.

## 0.8.8 - 2026-11-20

- **Bench (#283)**: token-efficiency baseline slimmed from 1.4MB per-session JSON to a 1.6KB summary; per-session detail becomes a gitignored `--sessions-out` artifact (regenerable via `bun run benchmarks/token-efficiency-baseline.ts`).
- **Docs (#286)**: CHANGELOG backfilled for 0.8.4-0.8.6; cross-team research handoff docs frontmatter fixed to pass the docs contract.

## 0.8.6 - 2026-11-20

- **Install one-liner (#276)**: `curl | sh` install script (`install.sh`) with download resume on truncated transfers (#277) and correct `fusion-code-<os>-<arch>` inner-tarball name handling (#278).
- **Docs (#279)**: CLAUDE.md synced with the shipped v0.6.0-v0.8.5 evolution phases (AGENTS.md context, Seatbelt e2e, OTel GenAI traces, async task sessions, reviewer-agent + routines, web review workbench, spec gate, ACP server, tool tier spec, `fusion team`, release distribution) — stale frontmatter refreshed, docs index extended.
- **Research baseline (#280)**: frozen competitive baseline (`docs/research/benchmark-landscape-2026-11.md`) — three-tier benchmark set, metric definitions, twice-weekly research cadence.
- **Research report #1 (#281)**: competitor snapshot pinned with evidence (8 products: Claude Code, Codex CLI, Gemini CLI, Amp, opencode, Aider, Goose, Crush); C1-C9 gap x metric matrix; token/tool efficiency baseline script (`benchmarks/token-efficiency-baseline.ts`) over 2,365 real sessions (49,642 turns, 22,431 tool calls, 10.57% tool-error rate; `cache_read_input_tokens = 0` anomaly flagged for investigation).

## 0.8.5 - 2026-11-16

- **CI (#274, refs #273)**: bun dependency cache in workflows; docs-only changes skip the build/test smoke jobs.

## 0.8.4 - 2026-11-14

- **fix(cli) (#268 contract)**: `fusion team send` requires `--from <member>` per the kernel contract — the lead is not an implicit identity; team e2e style cleanup and team-CLI contract docs (`docs/team-cli.md`).

## 0.8.3 - 2026-11-14

- **T4a `fusion team` CLI (#269, refs #268)**: manifest-based team registration over the agent-studio `teams.*` dispatcher (upstream T3, v0.16.0) — one JSON manifest per project (members with role/skills/tool allowlist/budget, initial tasks, per-repo `namespace_key` isolation); `team register|status|task add|send|disband` fast-path subcommands with JSON output; UDS JSON-RPC client mirroring the daemon's socket resolution and apikey→JWT auth chain with one-time loopback bootstrap. Live-daemon e2e pending upstream dahai80/fusion-agent-studio#710.

## 0.8.2 - 2026-11-14

- **Multi-platform binary releases (#261, #263, #265, #266, closes #262)**: `scripts/package-release.sh` builds and packages all five targets (macOS arm64/x64, Linux x64/arm64, Windows x64) from a single runner — each archive ships the compiled binary plus the secret-scanned `FUSION.rules.example` reference config, with OS+arch-gated `--version` smoke tests and SHA256SUMS. `.github/workflows/release-binaries.yml` uploads the archives to the release on every `v*` tag push (or workflow_dispatch with `upload_tag`); `build.ts` gained `--target=<bun-target>` cross-compilation.
- **Docs (#264)**: README prebuilt-binary install section covering all five release archives.
- **Tests (#259, #260)**: fixed 8 full-suite failures caused by cross-suite env/cwd pollution; `startup.test.ts` migrated to the shared `providerEnv` isolation helper.

## 0.8.1 - 2026-11-14

- **FCS-1 session composer (#257, closes #228)**: the session-view composer now implements the Fusion Composer Standard (five-zone anatomy — context chips, auto-grow input, tool row with 📎→＠ and ⚙ params, persistent hint row); send is an icon-only ⬆ with three states (disabled / enabled / stop-while-running); shortcuts per spec (Enter send, Shift+Enter newline, Esc stop, ⌘K palette, `/` commands); new `POST /api/sessions/:id/cancel` interrupts the active run.

## 0.8.0 - 2026-11-12

Phase 3 of the evolution plan (docs/evolution-plan-2026-11.md) — ecosystem depth.

- **P3.1 ACP server (#253)**: `fusion-code acp` — Agent Client Protocol v1 over stdio (JSON-RPC 2.0, newline-delimited) so ACP editors connect without a bespoke extension. Translation layer over the headless kernel: text deltas → `agent_message_chunk`, tool activity → `tool_call`/`tool_call_update`, kernel result → `stopReason`. stdout carries only ACP messages.
- **P3.2 Tier-spec open standard (#254)**: the local-model tool-tier semantics published as tier-spec v1.0.0 (`docs/tier-spec/`) — normative spec, JSON Schema for tier tables, fusion-code's conformant instance, and a conformance suite pinning the runtime to the published table.
- **P3.3 Video/screen input evaluation (#255)**: real-model evaluation (recording → frames → agent context on Qwen2.5-VL-7B) — recommendation: no kernel surface; the recipe composes today via ffmpeg + Read + local VL models. Report in `docs/research/video-input-evaluation.md`.

## 0.7.0 - 2026-11-12

Phase 2 of the evolution plan (docs/evolution-plan-2026-11.md) — autonomy loop.

- **P2.1 Async task sessions with PR hand-back (#248)**: `fusion-code task start|list|logs|attach|cancel` — detached worker sessions in their own worktree + branch, stream-json result capture, PR created on completion.
- **P2.2 Reviewer-agent layer + cron routines (#249)**: `fusion-code routine add|list|due|fire` with review / security-review / deps-audit presets; findings JSON under `<configDir>/reviews/`; fusion-security SAST context hook (localhost, fail-open); scheduling via system crontab + `routine due` (no daemon).
- **P2.3 Web review workbench (#250)**: Reviews page in the web GUI — findings triage (resolve/dismiss/reopen), jump-to-diff hunk, export findings back into the PR as a markdown comment.
- **P2.4 Spec-driven development gate (#251)**: `fusion-code spec new|plan|tasks|import|list|implement` — flat delta-first specs under `specs/<capability>/`, read-only Spec Kit / OpenSpec import, and a code-enforced turn-boundary gate (implement refuses unapproved task items before any model call). Also fixes a latent fast-path fall-through into the commander parser for all fast-path subcommands.

## 0.6.0 - 2026-11-12

Phase 1 of the evolution plan (docs/evolution-plan-2026-11.md) — capability catch-up.

### Added

- AGENTS.md first-class context file support (P1.1, #245): loads in place of CLAUDE.md per directory (first existing wins, never both); `/init` now directs fresh projects to AGENTS.md and offers migration for CLAUDE.md projects.
- macOS Seatbelt end-to-end verification (P1.2, #246): real `sandbox-exec` probes proving workspace-outside writes are denied and `customConfig.filesystem.allowWrite` scopes work on darwin.
- OTel GenAI trace chain (P1.3, #247): minimal OTLP/JSON exporter with zero new dependencies — `fusion.turn` / `gen_ai.tool` / `gen_ai.llm` / `fusion.budget.check` spans sharing one `fusion.turn.id`, with token-usage attributes. Default-off via `FUSION_CODE_OTEL_ENDPOINT` (localhost-only); off = byte-identical.

## 0.5.23 - 2026-11-07

### Fixed

- Repo hygiene after the docs-system adoption (#243): removed `kimi-analysis.md` and `self-improve.md` (deliberately deleted in 0252da36, resurrected by the docs pass) and untracked `ACC_R3.md` (owner working note, stays untracked).
- `ci/validate_docs.py` default `--skip-dirs` now matches the CI workflow list (adds `logs`, `.ruff_cache`, `.fusion`, `.remember`, `.claude`, `web`, `benchmarks`) so a bare local run reports the same result as CI.

### Docs

- Adopt the fusion docs-system v1.1 contract (app x guided-ui): added `docs/product-page.md`, `docs/get-started.md`, `docs/troubleshooting.md`, `docs/img/`; added 12-key frontmatter to all in-scope markdown files; added `ci/validate_docs.py` and `.github/workflows/docs.yml`.
