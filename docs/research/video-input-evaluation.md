---
doc_id: fusion-code/video-input-evaluation
product: fusion-code
class: app
entry: guided-ui
doc_type: guide
title: { zh: "视频/屏幕输入评估", en: "Video / Screen Input Evaluation" }
audience: engineer
status: draft
version: 1.0.0
updated: 2026-11-12
owner: "@dahai"
source_of_truth:
  - docs/research/video-input-evaluation.md
---

# Video / Screen Input Evaluation (P3.3)

Evolution plan P3.3: only Kimi Code ships video/screen input; evaluate
(screen recording → frame reading → agent context) **before** committing to
a kernel surface. This document is the deliverable — the experiment ran with
real models on real frames (2026-11-12), not on assumptions.

## TL;DR recommendation

**Do not add a video kernel surface now.** The building blocks already
compose: `ffmpeg` extracts frames, `Read` ingests single PNGs as image
blocks, and a local VL model reads them through the existing chat path.
A screen-recording→frames pipeline is a **user/agent recipe, not kernel
plumbing**. Revisit a first-class surface only if real usage shows agents
need frequent multi-frame ingestion (e.g. autonomous GUI-testing loops
driven from fusion-autotest).

## What exists today

- `src/tools/FileReadTool/` — reads PNG/JPEG/etc., resizes via
  `imageResizer`, returns image content blocks.
- `src/services/llm/capability.ts` — `supportsVision()` per provider; the
  local path supports VL models served by fusion-mlx.
- fusion-mlx (`:11434`) — VLM chat route with `image_url` content blocks
  (tested: `test_chat_route_vlm_image.py`).

Missing for "video input": nothing load-bearing — only convenience (a
`ffmpeg`-equivalent frame extractor and multi-image Read batching).

## Experiment

Setup: synthetic screen recording (PIL-rendered terminal frames → ffmpeg
→ mp4, 800×480), frames re-extracted **from the encoded mp4** (honest
pipeline: recording → decode → model). Model:
`mlx-community/Qwen2.5-VL-7B-Instruct-4bit` on fusion-mlx, real inference,
non-streaming, ≤400 output tokens.

The recording shows a terminal: a failing pytest run
(`test_charge_declined`, `assert 402 == 200`), then a fix line
("retry on 402"), then `12 passed`.

| Probe | Frames | Latency | Result |
|---|---|---|---|
| Full transcription | 1 | 5.7 s | **Exact** — all 4 lines verbatim |
| Change detection | 2 | 4.5 s | **Correct substance** — identified the failing test, the fix, and the 12-passed outcome; one digit OCR slip ("4020" for "402") |
| Agent-context reasoning | 3 | 10.7 s | **Correct state model** — named the failing test + assertion mismatch, proposed the right next action (inspect/fix expected status handling); one digit slip |

## Findings

1. **Frame text fidelity is production-usable** at 800×480 with a 7B 4-bit
   local model — verbatim transcription of UI text works, multi-frame
   reasoning works, latency (5–11 s) is acceptable for agent-turn
   granularity, not for interactive scrubbing.
2. **Digit-level OCR slips happen** (402 → 4020). Agents consuming frames
   MUST cross-check numbers against ground truth (logs, command output)
   before acting on them — same trust model as any tool output.
3. **The agent-context path already exists.** A coding agent that needs
   screen state can run `ffmpeg -i recording.mp4 -vf select=... frame_%d.png`
   in Bash, then `Read` the frames. No kernel change required for the
   Kimi-Code-style workflow to function today.
4. **Where a kernel surface WOULD pay off**: turn-boundary screen capture
   (auto-attach current-screen frames to user prompts) and fusion-autotest
   integration (assertions over recorded app sessions). Both are product
   decisions with permission implications (screen capture is privacy
   sensitive on macOS) — out of scope for an evaluation deliverable.

## Conformance with the plan

The plan said "evaluate ... before committing to a kernel surface". The
evaluation is done, the recipe is documented, and no kernel surface is
committed — matching the plan's intent of avoiding speculative plumbing.
