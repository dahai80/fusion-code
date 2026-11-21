---
doc_id: fusion-code/small-model-tool-calling
product: fusion-code
class: app
doc_type: research
title: { zh: "小模型 tool-calling 可靠性：业界实践与论文综述", en: "Small-model tool-calling reliability: industry practice and paper survey" }
audience: engineer
entry: developer
status: draft
version: 0.1.0
updated: 2026-11-21
owner: "@dahai"
---

# Small-model tool-calling reliability (2026-11-21)

Research note backing the harness-gain measurement track. Motivated by the
observed Qwen3-8B tool-call-as-text failure mode in the bench suite
(see `bench-reports/2026-11-20-r2.md` §3) and by today's root-cause
experiments against fusion-mlx 0.10.67/0.10.68.

## 1. Problem statement

Qwen3-8B served by fusion-mlx intermittently emits tool calls as plain
assistant text instead of `tool_calls` blocks. In bench runs the model
printed `Read({file_path: "..."})` and `call_<id>{json}` as stdout and the
session ended after one such turn — the single dominant failure mode for
the whole 20-task suite (report #2 §3).

Experiments run 2026-11-21 (scripts in `/tmp/bench-watch`, evidence in
bench results dirs):

- Bare OpenAI-style request with tools, 1 or 60 tool schemas, streaming or
  not, `enable_thinking` on or off: **all return proper `tool_calls`**.
- `tool_choice: "required"` returns a well-formed block deterministically.
- Replaying fusion-code's captured request body (47k-char system prompt,
  11 tools, captured via a local echo server) returned proper `tool_calls`
  5/5 — yet the same live invocation had emitted text minutes earlier.
- Engine v0.10.68 (overnight upgrade) reduced the text-emission rate from
  near-universal (v0.10.67, every bench task affected) to occasional
  (1 of first 7 tasks today).
- Side finding: with tool grammar engaged the engine answers with a
  non-streaming JSON body even when `stream: true` — clients must handle
  both shapes.

Conclusion: not a fusion-code translation-layer bug; the engine's
tool-call constrained decoding is sampling-dependent under large system
prompts. The harness cannot assume a `tool_calls` block will arrive.

## 2. Landscape: constrained decoding

- **XGrammar** (arXiv 2411.15100, MLSys 2025): structured-generation engine
  that compiles JSON-schema grammars into token masks with a precomputed
  token trie; up to 100x faster than SGLang's earlier approach, 3.9x over
  llguidance. Production default in SGLang, integrated in vLLM and NVIDIA
  Dynamo; supports arbitrary function-call JSON schemas including parallel
  calls.
- **xgrammar-mlx** (github.com/arghack/xgrammar-mlx): native MLX port,
  EBNF-to-compiled-mask pipeline working, WIP. Proves constrained decoding
  is feasible on Apple Silicon without vLLM.
- **MLXLMCustomToolCall** (from the mlx-engine authors): explores tool-call
  constraints in MLX with a custom XGrammar implementation using the
  `json_schema` constraint type — direct precedent for what fusion-mlx
  would need to make `tool_calls` emission deterministic.

Relevance: fusion-mlx already advertises `structured_output: true` and
honors `tool_choice: "required"` — the constrained path exists but is not
applied to the default `tool_choice: auto` agent path. Extending grammar
enforcement to all tool-bearing requests (auto included) matches where the
serving ecosystem has converged.

## 3. Landscape: interface design (ACI)

**SWE-agent** (arXiv 2405.15793, NeurIPS 2024): interface design affects
agent performance as much as the underlying model. Ablations: immediate
linting feedback after edits (+~3pp resolution), bounded file viewers
(~100-line windows), capped search output, guardrails against editing test
files. Principles: high-quality feedback loops, few-token actions, outputs
that never overflow context.

Relevance to fusion-code: our tool set already follows several of these
(bounded reads, structured edit tools). The open ACI question on our side
is feedback latency for local models — when a turn fails (text emission),
the harness currently ends the session rather than feeding the failure
back for a retry. A one-turn recovery loop is an ACI-quality improvement,
not just a parser.

## 4. Landscape: measurement methodology

**BFCL** (Berkeley Function-Calling Leaderboard, gorilla.cs.berkeley.edu):
AST-based evaluation — compares function name, parameter names, and
argument values structurally rather than by string match; v3 added
multi-turn stateful evaluation (missing params, unexpected failures,
irrelevance detection); v4 moves toward agentic multi-step environments.

Relevance: our harness-gain suite uses deterministic file/exit/pytest
verifiers (zero LLM judging) — a deliberate choice in the same spirit as
AST eval, but our current suite measures task-level outcomes only. If we
later need to isolate tool-calling quality from task-solving quality, a
BFCL-style AST check of emitted tool calls per turn (detecting
text-emission rate directly) is the standard instrument. Cheap to add as
a per-turn metric in the runner.

## 5. Landscape: training-side fixes (flywheel)

- **ToolACE** (arXiv 2409.00956): multi-stage data synthesis + LLM-critic
  self-evolution + dual-loss fine-tune; open-sourced 3M-sample generator.
- **Hammer** (MadryLab, xLAM family): top BFCL rank for <14B models;
  Masked Function Calling (mask args seen in prior calls to force
  completion rather than repetition), irrelevant-tool filtering, backoff
  retry.
- **APISen** (arXiv 2506.03207): semantic function-calling data expansion
  across API families; +23% BFCL for Qwen2-7B-class models.
- **TinyAgent-FunctionCall** (arXiv 2409.06903): 7B model matched GPT-4-Turbo
  on a macOS agent task after fine-tuning on user-confirmed traces.

Relevance: fusion's training flywheel (fusion-trainer + fusion-code
trajectory export) is exactly the TinyAgent pattern — local trajectories
from real sessions, filtered by acceptance, fine-tune the served model.
Hammer's MFC detail maps directly onto our session data: training samples
should mask earlier-turn tool results so the model learns to *complete*
calls instead of imitating them; this also plausibly reduces the
text-imitation failure mode (the model copies example syntax it has seen
in-context).

## 6. Options for fusion-code, ranked

1. **Per-turn tool-emission telemetry in the runner** (bench-only, low
   cost): log whether each turn produced a `tool_calls` block vs text;
   gives the text-emission rate as a first-class metric and quantifies
   engine regressions (v0.10.67 vs 0.10.68 already differ 10x).
2. **One-turn recovery loop on malformed turn** (harness ACI fix): when a
   turn ends with tool-shaped text and no tool_use, feed it back with a
   correction message instead of ending the session. Guardrail: max 2
   recovery attempts to avoid loops.
3. **Defensive text-parse of `call_<id>{json}` / `Name({json})` shapes**
   (previously the lead ask, downgraded): still worth a narrow parser, but
   v0.10.68 reduced incidence; recovery loop (option 2) is the robust fix.
4. **Engine ask (handoff-fusion-mlx)**: apply grammar-constrained decoding
   to tool-bearing requests regardless of `tool_choice`; unify streaming
   behavior when tool grammar engages (currently returns non-stream JSON).
   Cite MLXLMCustomToolCall + xgrammar-mlx as in-ecosystem precedents.
5. **Trainer ask (handoff-fusion-mlx/fusion-trainer)**: flywheel fine-tune
   with Hammer-style MFC masking on fusion-code trajectories; measure
   text-emission rate (option 1's metric) before/after.
6. **Edit-format escalation in the recovery loop** (new, 2026-11-21 E2E
   finding): recovery verified live — Read-shaped text recovers to a real
   tool_use after one correction, but Edit-shaped text does not: Qwen3-8B
   re-emits the identical `Edit({old_string, new_string})` text through all
   2 correction attempts. This matches the editing-format literature:
   weak models fail at precise search/replace but can rewrite whole files
   (Aider: GPT-3.5-Turbo ~68% whole vs ~50% diff). Concrete follow-up: on
   the second failed recovery of an Edit-shaped emission, make the
   correction message suggest the whole-file `Write` tool instead of
   re-issuing `Edit`. Cheap, testable with the harness-gain suite.
   Result (2026-11-21, 3 E2E reps): the escalation redirect works — the
   model switches from Edit-shaped to Write-shaped output on the second
   correction every time — but it still emits it as plain text, never as
   a real tool_use block, so the task stays unsolved. Once this model
   enters text-emission mode mid-session, meta-message corrections do
   not restore tool_use. This upgrades option 4 (engine-side grammar
   forcing for tool-bearing requests) from "nice to have" to the only
   reliable fix for the text-emission mode, and adds prompt-size diet
   for local models as a parallel lever (goose resolves 10/20 of the
   same tasks with a fraction of fusion-code's 47k-char system prompt on
   the same engine — see bench report #2).
7. **Successful-repeat loop detection** (new, 2026-11-21, from opencode
   cross-harness run): opencode+Qwen3-8B burned the full 600s on 10/13
   tasks repeating the same *successful but useless* tool call (20+
   identical Grep 0-match calls on one task). fusion-code's existing
   guard aborts after 5 consecutive identical tool *errors* only —
   successful calls that make no progress are invisible to it. Follow-up:
   hash (tool, input) pairs of consecutive successful calls; after N
   identical repeats, inject a corrective meta message ("same query
   returned no matches N times — change strategy"), abort only if the
   loop persists. (Synthesized from general agent-reliability practice —
   iteration caps, tool-call n-gram hashing, state-similarity checks;
   not from a single pinned paper.)

## 7. Sources

- XGrammar: https://arxiv.org/abs/2411.15100
- xgrammar-mlx: https://github.com/arghack/xgrammar-mlx
- SWE-agent: https://arxiv.org/abs/2405.15793 (code: princeton-nlp/SWE-agent)
- BFCL: https://gorilla.cs.berkeley.edu/leaderboard.html ; multi-turn blog:
  https://gorilla.cs.berkeley.edu/blogs/7_bfcl_v3_multi_turn.html
- ToolACE: https://arxiv.org/abs/2409.00956
- Hammer: https://github.com/MadryLab/hammer
- Tool Decathlon (xLAM/ToolGen): https://arxiv.org/abs/2412.10341
- APISen: https://arxiv.org/abs/2506.03207
- TinyAgent: https://arxiv.org/abs/2409.06903
- Prompt-size degradation (motivates the tier override + prompt diet):
  Chroma "Context Rot" https://research.trychroma.com/context-rot ;
  Lost in the Middle https://arxiv.org/abs/2307.03172 ;
  NoLiMa https://arxiv.org/abs/2502.05171 ;
  RULER https://arxiv.org/abs/2404.06654
- Aider edit formats: https://aider.chat/docs/usage/edit-formats.html ;
  leaderboards (whole vs diff for weak models):
  https://aider.chat/docs/leaderboards/
- Local evidence: `docs/research/bench-reports/2026-11-20-r2.md` §3;
  bench results dirs `fusion-code-2026-11-20T*` / `2026-11-21T01-33-54*`;
  echo-capture replay script `/tmp/bench-watch/capture-server.py`
