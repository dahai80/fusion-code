---
doc_id: fusion-code/handoff-fusion-mlx
product: fusion-code
class: app
doc_type: guide
title: { zh: "给 fusion-mlx/fusion-trainer 组的研究交接", en: "Research handoff for the fusion-mlx / fusion-trainer team" }
audience: engineer
entry: developer
status: draft
version: 0.1.0
updated: 2026-11-20
owner: "@dahai"
source_of_truth:
  - docs/research/handoff-fusion-mlx.md
---

# Research handoff: fusion-mlx / fusion-trainer team

Running log of findings from fusion-code research (papers, best practices,
competitive scans) that are actionable for the fusion-mlx (inference engine)
and fusion-trainer (SFT/RL) teams. Maintained by the fusion-code research
role; submitted to the team by the owner. Append dated entries, newest last.
Each entry: finding, evidence, concrete ask.

## Entry template

```
### YYYY-MM-DD — <short title>
- Finding: <what was learned>
- Evidence: <paper/link/benchmark numbers>
- Ask: <what the mlx/trainer team should do with it>
```

## Entries

### 2026-11-20 — engine prompt-cache accounting is live and consumed; keep the field stable
- Finding: fusion-mlx 0.10.67 prefix caching works on `/v1/chat/completions` — identical request repeated returns `prompt_tokens_details.cached_tokens = 64` of 82 prompt tokens (Qwen3-8B, 3-call curl test). The engine's Anthropic-style `/v1/messages` endpoint also emits `cache_read_input_tokens` / `cache_creation_input_tokens`. fusion-code historically dropped this data in its OpenAI-endpoint translation layer, so 2,365 real sessions recorded zero cache accounting (125M input tokens billed as uncached). Fixed on the fusion-code side (PR fusion-code#288): client now maps `prompt_tokens_details.cached_tokens` into `cache_read_input_tokens` for usage accounting, telemetry, and session jsonl.
- Evidence: live curl transcript (see PR fusion-code#288 description); baseline numbers in `docs/research/bench-reports/2026-11-20-r1.md` §3.
- Ask: (1) treat `prompt_tokens_details.cached_tokens` as a stable API contract on `/v1/chat/completions` — fusion-code now depends on it; document it in the engine API docs. (2) Consider exposing an engine-level cache hit-rate metric (Prometheus `/metrics` via fusion-supervisor) so harness-vs-engine cache regressions are distinguishable. (3) The Anthropic-style endpoint reported `cache_read_input_tokens: 0` on a first cold request while the OpenAI one reported no details block — worth aligning field presence semantics across the two endpoints.
