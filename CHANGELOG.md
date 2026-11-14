---
doc_id: fusion-code/changelog
product: fusion-code
class: app
entry: guided-ui
doc_type: changelog
title: { zh: "变更日志", en: "Changelog" }
audience: engineer
status: draft
version: 0.8.3
updated: 2026-11-14
owner: "@dahai"
source_of_truth:
  - CHANGELOG.md
---

# Changelog

All notable changes to fusion-code are documented here.

## Unreleased

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
