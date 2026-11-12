---
doc_id: fusion-code/evolution-plan
product: fusion-code
class: app
entry: guided-ui
doc_type: guide
title: { zh: "能力补齐与超越计划（2026-11）", en: "Capability catch-up & surpass plan (2026-11)" }
audience: engineer
status: draft
version: 0.5.23
updated: 2026-11-12
owner: @dahai
source_of_truth:
  - docs/research/fusion-code-evolution-2026-11.md
---

# Capability Catch-up & Surpass Plan (2026-11)

Derived from the industry-scan insight report
`docs/research/fusion-code-evolution-2026-11.md` (workspace copy of
`~/fusion/insight/fusion-code-evolution-2026-11.md`, dated 2026-11-12: industry
scan + local gap audit). This plan turns
that report's §9 gaps (C1-C9) and §10 recommendations into a concrete,
sequenced execution plan with acceptance criteria. Nothing here lands on main
directly — each work item is a branch + PR, each phase ends in a patch/minor
release.

## 0. Posture

fusion-code already holds the industry-standard harness surface (60+ tools,
subagents, LSP, MCP both directions, worktrees, checkpoints, skills, plugins
with sha256 pinning) plus three local-first differentiators nobody else
ships: model-size-tier tool filtering (≤2B/≤9B/full), Last-Event-ID stream
resume, and prompt-cache break detection. The plan does NOT touch these.

What is missing falls into two buckets:

- **Catch-up** (industry converged, we are behind): C1 AGENTS.md, C2 async
  sessions + PR hand-back, C4 routines, C6 macOS Seatbelt, C9 OTel chain.
- **Leapfrog opportunities** (build where the market is heading, not where
  it is): C5 reviewer-agent layer, C7 SDD workflow gate, C3 web review UI,
  tier-spec as an open standard, video/screen input.

## 1. Gap register (from report §9, verified in-tree)

| # | Gap | Severity | Verified anchor |
|---|---|---|---|
| C1 | AGENTS.md not read/written | 🔴 | 0 hits in `src/utils/claudemd.ts` |
| C2 | No async/cloud session, no "task→PR" loop | 🔴 | local CLI + project API server only |
| C3 | web GUI lacks diff/review parity | 🟡 | `web/` has palette+export (#241), no review page |
| C4 | No scheduled tasks / routines | 🟡 | no routines surface |
| C5 | Reviewer layer = slash commands only, no standalone reviewer agent | 🟡 | `/review`, `/security-review` in `src/commands/` |
| C6 | macOS sandbox not wired (Seatbelt) | 🟡 | vendored linux-sandbox present, `sandbox-exec` 0 hits |
| C7 | No spec-driven development (SDD) gate | 🟡 | none |
| C8 | No IDE/editor integration | 🟡 | none (Phase 3 — ACP, out of scope here) |
| C9 | OTel deps present, no unified trace chain | 🟡 | `@opentelemetry` in `src/bootstrap/state.ts` only |

## 2. Phase 1 — Standards & local safety (weeks 0-6)

### P1.1 AGENTS.md first-class support (C1) — P0

The context-file war is over (60k+ projects, 20+ adopters, Claude Code reads
AGENTS.md in place). fusion-code must join the standard, not fork it.

- Read path: `getMemoryFiles()` (`src/utils/claudemd.ts`) gains AGENTS.md in
  the load chain — precedence `FUSION.rules > AGENTS.md > CLAUDE.md` per
  directory level; first existing file per level wins (no double-merge of
  AGENTS.md + CLAUDE.md in the same dir).
- Write path: `/init` (project onboarding) generates `AGENTS.md` when the
  project has none; if `CLAUDE.md` exists, offer migration (rename +
  one-line pointer back for tool compat).
- `claudemdPortable.ts` (API-server context) gets the same chain — both
  entrypoints must resolve identically; covered by a shared helper, not copy.
- Contract tests: precedence matrix per dir level; parity with the web
  server context path (`claudemdPortable`).
- Acceptance: session in a repo with only AGENTS.md picks it up (both REPL
  and `-p`); `/init` in an empty repo writes AGENTS.md; zero behavior change
  for repos that only have CLAUDE.md.

### P1.2 macOS Seatbelt sandbox profile (C6) — P0

Local-first product on macOS must not run shell with no OS-level constraint.

- Wire `sandbox-exec` behind the existing `src/utils/sandbox/` adapter seam
  (same interface the vendored linux-sandbox runtime plugs into). Profile:
  read/write scoped to session cwd + worktree prefix (`<configDir>/worktrees/`
  — already load-bearing for the kernel permission gate) + temp dirs;
  deny network by default with the existing opt-in env as the escape hatch.
- Fail-visible, never fail-open silently: if `sandbox-exec` is unavailable
  (non-macOS, hardened runtime), log + surface, fall back to current behavior.
- Reuse the enterprise posture from `docs/enterprise-hardening.md`
  (`sandbox.enabled` / `failIfUnavailable`) — Seatbelt becomes the macOS
  implementation behind that schema, no new config surface.
- Acceptance: `bun run check` + kernel-parity suite green; a write outside
  the allowlist inside a Seatbelt'd shell returns the structured denial the
  permission UI already renders; zero behavior change when sandbox off
  (default unchanged).

### P1.3 OTel GenAI trace chain (C9) — P1

Dependencies exist; the chain does not. Build the minimal honest version:
tool span → harness funnel → LLM span, with GenAI semconv attribute names.

- `src/bootstrap/state.ts` tracer → child spans at: tool execution
  (`src/services/tools/toolExecution.ts`), budget funnel decisions, and the
  LLM call seam (`src/services/llm/`) — model id, provider, token counts
  from the existing cost-tracker as span attributes.
- Exporter: OTLP to localhost only (fusion-memory / fusion-supervisor
  `/metrics` ecosystem); **no default remote endpoint** — the no-telemetry
  defense line is non-negotiable. Disabled unless `FUSION_CODE_OTEL_ENDPOINT`
  is set.
- Acceptance: one local run emits a trace where a single user turn is
  traceable end-to-end (turn span → tool spans → LLM span with token cost);
  with the env unset, byte-identical behavior.

Phase 1 exit: release v0.6.0 (minor — AGENTS.md is user-visible behavior).

## 3. Phase 2 — Async, review, SDD (weeks 6-16)

### P2.1 Async sessions + PR hand-back (C2) — P0

The converged shape is task → sandboxed session → PR → human review. The
building blocks all exist: project API server (`/ws/chat`), web runner
subprocess ownership (server-owned runs, `web/server/runner.ts`), PR flow
(`web/server/gitRepo.ts`), headless `-p` mode. What is missing is
*detach-from-terminal* background sessions.

- `fusion-code task start <prompt>` — daemonized headless session (reuse the
  daemon/ps plumbing from `src/entrypoints/cli.tsx` bridge mode): own
  worktree (`<configDir>/worktrees/`), own log, survives terminal exit.
- `fusion-code task list|attach|logs|cancel` — attach re-opens the stream.
- On completion: PR via the existing `createPullRequest` path + a
  structured result summary (turns, tokens, files, verify result) written to
  the task record.
- No new outbound network: tasks run against the already-configured
  FUSION_BASE_URL. Cloud-lite later = point the same loop at a remote host;
  not in this phase.
- Acceptance: start a task, close the terminal, task completes and opens a
  PR; `task list` from a fresh shell shows status; cancel kills the
  worktree cleanly.

### P2.2 Reviewer-agent layer (C5) — P1

Write-agent and check-agent are separating across the industry (CodeRabbit's
governance pivot, Kiro's branded verify). We have the seed: the
`verification` subagent is already anti-sycophancy-hardened.

- Promote review to a first-class reviewer session type: reads the working
  diff or task transcript, emits findings with `file:line` + severity +
  concrete fix — the existing `/review` and `/security-review` prompts
  become presets of this reviewer, not REPL-only slash commands.
- Routines (C4) ride on it: `fusion-code routine add --cron <expr> --preset
  review|security-review|deps-audit` — cron-scheduled reviewer runs against
  a repo, output lands in the task store + (opt-in) a GitHub issue. Cron
  infrastructure already exists as an agent tool; this surfaces it as a
  product command. Local-only scheduling, no cloud dependency.
- fusion-security hook: security-review preset consumes SAST results when
  the service is reachable (best-effort, fail-open) — cross-project
  consumption via issue, not direct code dependency.
- Acceptance: reviewer runs headless on a diff and produces a findings
  file; a routine fires on schedule, its record shows in `task list`.

### P2.3 Web review UI (C3) — P1

`web/` already has diff viewer, comments, checkpoints, PR flow, palette,
export. The review gap is a *reviewer workbench* page: findings list from
P2.2 reviewer sessions, per-finding jump-to-diff-line, resolve/dismiss
state, "export review" back into the PR. Consumes the project API; no new
kernel surface.

### P2.4 SDD gate (C7) — P2

Spec Kit (149k★) / OpenSpec / BMAD-v7-on-skills say SDD is the dominant team
mode. Minimal honest version, brownfield-friendly (OpenSpec's angle):

- `fusion-code spec new|plan|tasks|implement` — flat requirement +
  invariant files under `specs/<capability>/`, delta-first (OpenSpec style),
  no heavyweight templates.
- Implement gate: the implement command refuses to start a turn that
  touches code without an approved task item — enforced in the turn
  boundary, not by prompt discipline.
- Import: read Spec Kit / OpenSpec formats read-only (compat, not lock-in).
- Acceptance: a spec→plan→tasks→implement cycle runs in-repo with the gate
  visibly blocking an ungated implement attempt.

Phase 2 exit: release v0.7.0.

## 4. Phase 3 — Ecosystem depth (weeks 16+) — sketched, not scheduled

- **ACP server** (C8): expose the agent over Agent Client Protocol so Zed
  (and any ACP editor) connects without us writing an extension. The LLM
  seam + project API make this a translation layer, not a rewrite.
- **Tier-spec as open standard**: extract `mlxToolTiers` semantics into a
  versioned spec + conformance tests; publish for the local-model ecosystem.
  This is the differentiator play — own the niche nobody else serves.
- **Video/screen input evaluation**: only Kimi Code ships it; evaluate via
  fusion-autotest (screen recording → frame reading → agent context) before
  committing to a kernel surface.

## 5. Defense lines (checked at every phase exit)

1. **AGPL-3.0 + provenance discipline**: `docs/upstream-provenance.md`
   maintained; no new upstream code without an entry.
2. **No telemetry egress**: OTel is localhost/exporter-off by default;
   routines and async tasks make no new outbound calls.
3. **Harness parity anchor**: `src/__tests__/harness/kernelParity.test.ts`
   must stay green — any permission/compaction/budget change lands both
   sides with mirrored assertions.
4. **Provider neutrality**: `src/services/llm/` seam is never narrowed.
5. **Single-binary distribution**: no feature above may add a runtime
   dependency that breaks `bun build --compile`.
6. **Small-model usability**: tool-tier filtering, stream resume, cache
   break detection keep working — conformance tests guard all three.

## 6. Execution protocol

- One branch per work item (`feat/p1-1-agents-md`, ...), never main; PR with
  the acceptance criteria as the review checklist.
- File one GitHub issue per work item when the item starts (English), link
  the PR with `Closes #NNN`.
- Gates per PR: `bun run check` + `bun test src/__tests__/` + `bun test
  ./tests/` + web suite when `web/` is touched.
- Phase exits cut a release only when every item in the phase is merged and
  the defense-line checklist above is re-verified.
