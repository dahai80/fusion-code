---
doc_id: fusion-code/changelog
product: fusion-code
class: app
entry: guided-ui
doc_type: changelog
title: { zh: "变更日志", en: "Changelog" }
audience: engineer
status: draft
version: 0.6.0
updated: 2026-11-12
owner: "@dahai"
source_of_truth:
  - CHANGELOG.md
---

# Changelog

All notable changes to fusion-code are documented here.

## Unreleased

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
