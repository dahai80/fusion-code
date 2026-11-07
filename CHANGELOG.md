---
doc_id: fusion-code/changelog
product: fusion-code
class: app
entry: guided-ui
doc_type: changelog
title: { zh: "变更日志", en: "Changelog" }
audience: engineer
status: draft
version: 0.5.22
updated: 2026-11-07
owner: "@dahai"
source_of_truth:
  - CHANGELOG.md
---

# Changelog

All notable changes to fusion-code are documented here.

## Unreleased

## 0.5.23 - 2026-11-07

### Fixed

- Repo hygiene after the docs-system adoption (#243): removed `kimi-analysis.md` and `self-improve.md` (deliberately deleted in 0252da36, resurrected by the docs pass) and untracked `ACC_R3.md` (owner working note, stays untracked).
- `ci/validate_docs.py` default `--skip-dirs` now matches the CI workflow list (adds `logs`, `.ruff_cache`, `.fusion`, `.remember`, `.claude`, `web`, `benchmarks`) so a bare local run reports the same result as CI.

### Docs

- Adopt the fusion docs-system v1.1 contract (app x guided-ui): added `docs/product-page.md`, `docs/get-started.md`, `docs/troubleshooting.md`, `docs/img/`; added 12-key frontmatter to all in-scope markdown files; added `ci/validate_docs.py` and `.github/workflows/docs.yml`.
