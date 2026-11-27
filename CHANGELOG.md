---
doc_id: fusion-code/changelog
product: fusion-code
class: app
entry: guided-ui
doc_type: changelog
title: { zh: "变更日志", en: "Changelog" }
audience: engineer
status: draft
version: 0.8.40
updated: 2026-11-28
owner: "@dahai"
source_of_truth:
  - CHANGELOG.md
---

# Changelog

All notable changes to fusion-code are documented here.

## Unreleased

## 0.8.40 - 2026-11-28

- **Docs (#373)**: bench r6 addendum — resume cap experiment results. Of three 600s kills, 2 are genuinely cap-bound (T14 resolved at 898s under a raised 900s cap; T05 still hit it) and 1 (T17) fails on correctness, not time. 1.5x resumed cap converts exactly the boundary task. Resumed runs are input-heavy (128k-220k input tokens); engine throughput remains the highest-leverage lever.

## 0.8.39 - 2026-11-28

- **Bench (#371)**: `BENCH_RESUME_TIMEOUT_S` cap override for resumed tasks — resumed tasks may need a different cap than fresh ones; validation found the cap (not lost state) was the binding constraint on resume. Overrides the per-task timeout for resumed tasks only, in seconds; unset = same cap. Default behavior unchanged.

## 0.8.38 - 2026-11-28

- **Feat (#366)**: `/checkpoint` file-level snapshot + restore — `create` tars the worktree (minus `.git`/`node_modules`/checkpoint store) to `.claude/checkpoints/<name>.tar` so snapshots work outside git repos; `restore` overlays files from the snapshot, keeps post-checkpoint files on disk, and writes a `pre-restore` backup first so the rollback is itself undoable. Works on non-git worktrees (issue #360 follow-up). Recipe docs for hooks gates added (`docs/hooks-recipes.md`). 5 new tests.
- **Fix (#369)**: bench runner recorded 0/0 tokens for timed-out tasks — the timeout timer resolved the promise before the `child.exited` handler finished transcript finalization; token accounting now awaits exit finalization (`await exitFinalized`).
- **Fix (#367)**: held-out verify specs used wrong field names (`expect`/`path`/`all` instead of `stdout`/`test`/`specs`) and were never exercised — new test resolves each H01-H05 spec against a canned correct solution and asserts failure on the untouched fixture.
- **Docs (#368)**: bench progress report #6 — cost anchoring (`tokensIn`/`tokensOut` per task) and honest scoring methodology.

## 0.8.37 - 2026-11-28

- **Fix (#364)**: hoist `snapshotWorkdir` to module scope — #361 accidentally nested it inside `runHarness` while the timeout-snapshot call site lives in the main loop, which would ReferenceError on the first timed-out task. Hoisted next to `sumTokensFromTranscript` with an updated comment; behavior unchanged.

## 0.8.36 - 2026-11-28

- **Bench (#361, closes #360)**: timeout workdir snapshots + resume — when a task times out, the runner tars its tree to `<taskId>.timeout.tar` in the results dir; a later run with `BENCH_RESUME_DIR=<dir>` restarts timed-out tasks from that snapshot (fixture init skipped) with a deterministic resume preamble appended to the prompt ("continue from current state, verify what is done, finish"), no LLM summarization. Rows carry a `resumed` flag. Snapshot tar logic extracted to `snapshotWorkdir` (shared with DRA).
- **Bench (#362)**: held-out task tier H01-H05 — five frozen fixtures/tasks marked `heldout: true` in `tasks.json`, excluded from regular runs and only executed with `BENCH_HELDOUT=1` (or via `--only`), so iteration never tunes against them.

## 0.8.35 - 2026-11-28

- **Fix (#356)**: DRA replay resolved absolute transcript paths as ambiguous — transcripts record `file_path` under the runner's temp workdir (`hg-<taskId>-<rand>/…`) while snapshots are tarred with that workdir as root, so the `hg-*` segment is now stripped (`toSnapshotPath` in `verify.ts`) before joining; the replay previously went silently all-ambiguous. Deleting a missing file now reports `ambiguous` instead of pretending success. 3 new tests.
- **Bench (#358)**: per-task token totals — the runner sums `input_tokens`/`output_tokens` from the session transcript's assistant usage blocks into each row (`tokensIn`/`tokensOut`) and the run summary, anchoring quality with cost (SWE-Lancer style). Best-effort: missing/unreadable usage counts as zero.
- **Research docs (#357)**: progress report #5 — observability and attribution tooling: silent-stream retry counts, the 15/20 clean rerun, DRA's first needed/unneeded attribution closing the over-edit line, per-task token cost rows.

## 0.8.34 - 2026-11-26

- **UX (#354)**: failed background tasks must be reconciled + deliverable paths clickable. A background agent that died (e.g. 529 cascade) enqueued an `agent_failed` notification, but the final summary then claimed plain completion — failed task notifications now carry an explicit instruction requiring the summary to state what failed and disclose any retry/fallback that produced the deliverable. `applyMarkdown` also linkifies absolute and `~/`-relative file paths (extension required; URLs and bare directories excluded) as `file://` OSC 8 hyperlinks, so reported outputs open directly from the terminal. 5 new tests.

## 0.8.33 - 2026-11-26

- **Fix (#349/#352)**: harden the 529 retry budget from the first iteration — `FUSION_CODE_MAX_529_RETRIES` is now capped at `DEFAULT_MAX_RETRIES` (10) so a stuck gateway still terminates the turn, and values below 1 fall back to the default 3 instead of disabling the budget abort. Plus full `withRetry` loop tests: default 3-strike hard-fail (external user), raised budget riding out a 10-strike cascade, and fallback trigger.

## 0.8.32 - 2026-11-26

- **Fix (#349/#350)**: env-tunable 529 retry budget — `MAX_529_RETRIES` was hardcoded at 3 while other retryable errors got `DEFAULT_MAX_RETRIES=10`, so headless `-p` workers died on short 529 capacity cascades that claude code rode out (~10 retries). New `FUSION_CODE_MAX_529_RETRIES` env raises the budget for unattended dispatches; default 3 unchanged for interactive use, invalid/negative values fall back with a debug log. 5 new tests.

## 0.8.31 - 2026-11-26

- **Bench (#347)**: DRA replay — `benchmarks/harness-gain/dra.ts <resultsDir>` attributes each transcript Edit/Write unit as needed/unneeded via Delta Residue Attribution (arXiv 2611.34875): revert units cumulatively newest-first against the task's final-tree snapshot (`BENCH_DRA=1`) and rerun the task verify at each prefix; a prefix whose verify still passes is jointly unneeded. Task verifiers extracted to `verify.ts` so scoring and replay share the exact predicates; snapshotting moved into `runHarness` (all tasks, replay-side resolved filtering). Bash-heredoc writes stay out of scope, reported as coverage.

## 0.8.30 - 2026-11-26

- **Bench (#345)**: DRA snapshot mode — when `BENCH_DRA=1`, the harness-gain runner tars the final tree of each resolved task (`<taskId>.final.tar` in the output dir) so the over-edit replay can attribute each edit unit. Best-effort: a failed snapshot logs a warning, never fails the run; off by default.

## 0.8.29 - 2026-11-26

- **Bench (#343)**: per-task silent-stream retry counter in the harness-gain runner. The runner now always passes `-D` (the session debug file is the only place the adapter logs silent-stream retries) and counts `Silent stream (no text/tool_use)` lines per task — surfaces the #334 retry firing rate that the 27B regression report flagged as unverifiable. Best-effort: missing/unreadable debug files count as zero, never fail a run. Row + summary carry `silentRetries`.

## 0.8.28 - 2026-11-26

- **Research docs (#341)**: 27B regression record for the #334 build — 15/20 (run T03-46-57-105Z). Four failures (T05/T10/T14/T17) are the known engine-side thermal 600 s-timeout class; T20 failed environmentally (unauthenticated localhost `POST /api/v1/down` stopped fusion-mlx mid-task, second incident in two days, caller attribution filed as fusion-supervisor#173). Clean signals: textEmissions = 0 across all 20 tasks, #321 recovery never fired. Verdict: score not comparable to 18/20 due to the T20 kill.

## 0.8.27 - 2026-11-26

- **Fix (#338)**: strip unterminated analysis/summary blocks in compact summaries. `formatCompactSummary` only stripped the `<analysis>` drafting scratchpad when the closing tag was present, so degenerate model output ending the block without `</analysis>` leaked the whole scratchpad into the compacted summary (the same failure class goose fixed in v1.60.1); an unterminated `<summary>` additionally leaked the raw tag. Unterminated `<analysis>` now strips to the `<summary>` section or to the end; unterminated `<summary>` formats as `Summary:` + content without the raw tag. Closed-tag behavior unchanged. 5 new tests; full suite 1846 pass.

## 0.8.26 - 2026-11-25

- **Research docs (#336)**: progress report #4 — the competitor scan owed from report #3 (Claude Code v2.1.326-331, opencode v2.4.x, goose v1.60.x, window 2026-11-17 → 11-25), the 27B 18/20 new best, the #334 silent-stream retry PR that came out of a scan takeaway, PR ledger #321-#334 (all merged + accepted), and next work items (field-verify #334 in the next 27B regression; #1694 server-side capture follow-up carried over).

## 0.8.25 - 2026-11-25

- **Fix (#334)**: retry once on silent fusion-mlx streams. A local-engine stream completing with no text and no tool_use (empty or thinking-only) is a degraded-engine slip, not a valid turn — the agent loop previously burned a turn of the budget on nothing. New `withSilentStreamRetry` buffers leading non-content events (flushed on first real content, zero added latency), and on a silent end discards the buffer and re-issues the request once (max 2 attempts; mirrors Claude Code v2.1.331's silent-reply retry, adapted for the local engine). Wired at both fusion-mlx entry points; skipped on the stream-resume path (a re-issued request gets a new stream id and would invalidate the cursor/state side-channels); the final silent attempt still yields its buffered prefix rather than swallowing the turn. 4 new tests; full suite 1841 pass.

## 0.8.24 - 2026-11-25

- **Bench docs (#332)**: 27B regression run on v0.8.23 (#321 + #328 + #330) scores **18/20** — new best vs the 17/20 baseline; zero text emissions, zero engine restarts, runner retry never needed. Failures T05/T14 timeouts (known thermal-latency class); chronic degradation-slip tasks T13/T17 passed cleanly. No regression from the nudge/retry changes; delta within single-run noise.

## 0.8.23 - 2026-11-24

- **Bench (#330)**: harness-gain engine-restart resilience — fusion-supervisor auto-recovery SIGTERMs fusion-mlx under sustained 27B decode load (fusion-supervisor#153); sessions launched in the downtime window die instantly with `Local inference service unavailable` and zero out the rest of the run (2 of 3 runs destroyed today, one 6/20 vs 17/20 baseline). When a task log carries the engine-unavailable error, the runner now polls `/health` up to 180 s and re-runs that task once; real failures untouched. Bench tooling only.

## 0.8.22 - 2026-11-24

- **Bench docs (#326)**: 8B cross-tier comparison appended to the 27B baseline report — 8B on v0.8.20 with #321 recovery scores 7/20 (was 3/20 pre-#315); zero timeouts, zero text emissions, all 13 failures genuine verify failures ending mid-work on max-turn exhaustion (transcript evidence per task); cross-tier set T07/T12/T15/T20 fails on 8B, passes on 27B — gap is generation quality, not format handling. Also records a second external SIGTERM engine restart (fusion-mlx #1256 watchdog, launchd context) killing bench tasks.

## 0.8.21 - 2026-11-24

- **Tests (#323)**: streaming-path coverage for the degraded-emission recovery (#321) — `transformMLXStreamToAnthropic` runs the same `extractToolCallsFromText` pass after the SSE loop, so a `call_<hex>{...}` slip split across two content chunks must recover identically. SSE-simulation test asserts the emitted `tool_use` block and `input_json_delta` payload. Tests only — no source change.
- **Bench docs (#324)**: research progress report #3 (2026-11-20 → 11-24) — 27B baseline 17/20 reproduced across two independent runs; #1694 slip anatomy (name-less `call_<hex>{args-only}`, timing simultaneous with concurrent Kimi parse failures); T05 latency root cause (episodic 3x throughput decay, thermal-throttle signature, isolated via engine logs); next: 8B transcript re-run, #1694 server-side capture.

## 0.8.20 - 2026-11-24

- **Fix (#321)**: recover degraded `call_<hex>{"arg": ...}` tool-call emissions (fusion-mlx #1694). Under concurrent decoding load the engine occasionally leaks a tool call as plain text with no tool-name key — existing text-recovery patterns all require a name, so the call never executed and the bench task timed out (T14 + T17 slips in 2 of 4 full 27B runs). New last-priority extraction pattern in `extractToolCallsFromText`: balanced-JSON extraction after `call_<hex>{`, tool name inferred from the argument signature (Edit → Write → Bash → WebSearch/WebFetch/Grep → Read, specific signatures first), unknown-signature slips stay as visible text, fresh `toolu_` id avoids collision with a real executed call sharing the slip id. Shared by streaming and non-streaming paths. 3 new tests using the verbatim T14/T17 transcript slips; full suite 1824 pass.

## 0.8.19 - 2026-11-23

- **Bench docs (#319)**: 27B full-suite baseline report (17/20 across pre-fix/post-fix engine runs) with failure anatomy — T05 pure latency; T13/T17/T14 plain-text tool-call slips tied to fusion-mlx #1694, each simultaneous with a concurrent Kimi parse failure (same-second / 5 ms), pointing at live concurrent decoding rows; engine-side verification history for 0.10.69 (`3ea0f01b`, `b6edee57` epoch invalidation) incl. the loaded/unloaded rerun matrix. Restored the stranded 32B compact-tier report. Both new reports carry the docs-contract frontmatter (CI `validate` initially failed on missing frontmatter — fixed in `3fcc13a`).

## 0.8.18 - 2026-11-23

- **Bench (#317)**: harness-gain `textEmissions` now counted from the per-task session transcript instead of process stdout — a 600s-capped kill loses buffered stdout, so the exact degradation the metric exists for (T17 ended with a plain-text `call_<id>{...}` emission) reported 0. Transcript path returned by `copySessionTranscript`; stdout fallback unchanged for goose/opencode. Verified against the real degraded T17 transcript: transcript method = 1, stdout = 0. Bench tooling only.

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
