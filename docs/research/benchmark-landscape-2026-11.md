---
doc_id: fusion-code/benchmark-landscape
product: fusion-code
class: research
doc_type: research
title: { zh: "对标格局与固化基线（2026-11）", en: "Benchmark Landscape & Frozen Baseline (2026-11)" }
audience: engineer
status: active
version: 1.0.0
updated: 2026-11-20
owner: "@dahai"
source_of_truth:
  - docs/research/benchmark-landscape-2026-11.md
---

# Benchmark Landscape & Frozen Baseline (2026-11)

Baseline frozen 2026-11-20 at fusion-code v0.8.5 (commit b06f2900). Research
cadence: twice-weekly progress reports against this baseline. Competitor
capability cells marked `verify` are to be pinned with evidence (version +
official doc link) in the first report — do not update baseline values in
place; append a dated snapshot section instead.

## 1. Benchmark tiers

| Tier | Target | Role |
|---|---|---|
| 1 | Claude Code | North star. Harness parity checklist: agent loop, context compaction, tool design, permissions/sandbox, subagents/workflows, MCP/LSP, hooks, skills, checkpoint/rollback. Cloud-model quality is out of scope — we compete on harness. |
| 2 | OpenAI Codex CLI, Gemini CLI, Amp | Direct competitors on the same track. Quantifiable catch-up: sandbox primitives (Seatbelt/Landlock), exec approval modes, multi-agent orchestration and review workflows. |
| 3 | opencode (SST), Aider, Goose (Block), Crush | Open-source + local-model peers. This is the tier where fusion-code can realistically rank #1. |

## 2. Differentiated home field (no competitor can follow)

1. **Local inference loop** — fusion-code + fusion-mlx fully offline.
   Harness self-adaptation for small models (3B-8B): tool tier dispatch
   (`docs/tier-spec/SPEC.md`), prompt slimming, context compaction scaled to
   model capability. Paper-grade topic.
2. **Training flywheel** — trajectory collect/export/train (SFT/DPO/GRPO)
   closed loop via fusion-trainer. No peer has a local post-training loop.
3. **Standard play** — push the tool tier spec toward de-facto standard.

## 3. Metric dimensions (frozen definitions)

| Dimension | Definition | Measurement |
|---|---|---|
| Agentic coding | End-to-end resolved rate on real repos | SWE-bench Verified (subset budget agreed per report) |
| Terminal agentic | Realistic terminal task success | Terminal-bench |
| Local-model harness gain | Same MLX model, harness delta vs peers | Fixed task suite, fusion-code vs opencode vs Aider, same model checkpoint |
| Token efficiency | Tokens consumed per completed task | Harness usage accounting, normalized per task |
| Latency | TTFT + per-turn overhead | Instrumented timing, local + cloud |
| Tool efficiency | Tool calls per task; error-loop rate | Session jsonl analysis (`trajectory collect` output) |
| UX parity | Feature checklist vs tier-1 | Manual checklist diff per report |

## 4. fusion-code v0.8.5 self-state (frozen)

Verified from repo at baseline date:

- 60+ agent tools, ~40 slash commands (`src/tools.ts`, `src/commands.ts`)
- Provider-neutral LLM seam, zero `@anthropic-ai/sdk` dependency
- Sandbox: Seatbelt verified e2e (P1.2); enterprise hardening doc
- Async task sessions + PR hand-back (P2.1), reviewer-agent + cron routines
  (P2.2), web review workbench (P2.3), spec-driven gate (P2.4)
- ACP server (Agent Client Protocol v1 over stdio, P3.1)
- Tool tier spec v1.0.0 published (P3.2)
- Trajectory flywheel (collect/export/train) wired to fusion-trainer
- Multi-platform release CI + install.sh + Homebrew tap
- Known gaps tracked as C1-C9 in `docs/evolution-plan-2026-11.md`

## 5. Competitor snapshot (to pin in report #1)

| Product | Version | Sandboxing | Subagents | MCP | Local model | Open source |
|---|---|---|---|---|---|---|
| Claude Code | verify | verify | yes | yes | no | no |
| Codex CLI | verify | verify | verify | verify | no | yes (Apache-2.0) |
| Gemini CLI | verify | verify | verify | verify | no | yes (Apache-2.0) |
| opencode | verify | verify | verify | verify | yes | yes |
| Aider | verify | n/a | n/a | partial | yes | yes (Apache-2.0) |
| Goose | verify | verify | verify | verify | yes | yes (MIT) |
| Amp | verify | verify | yes | verify | no | partial (CLI) |

## 6. Twice-weekly report template

Each report (append as `reports/2026-XX-XX-rN.md` sibling section or separate
file under `docs/research/bench-reports/`):

1. Baseline delta: what changed in competitors since last report (release
   notes, version bumps) — evidence links required
2. Metric progress: any dimension re-measured, numbers vs baseline
3. Research output: papers/best-practices studied, one-paragraph takeaways
4. Experiment status: branch, validation result, PR opened/merged
5. Next two work items with success criteria

## 7. Workflow constraints (binding)

- Never commit to `main` of fusion-code. Research docs and code both land via
  feature branch + PR; owner reviews and merges.
- Docs in English, under `docs/`.
- GitHub operations in English.
