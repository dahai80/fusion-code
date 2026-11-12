---
doc_id: fusion-code/tier-spec
product: fusion-code
class: app
entry: guided-ui
doc_type: architecture
title: { zh: "工具分档规范", en: "Local-Model Tool Tier Spec" }
audience: engineer
status: draft
version: 1.0.0
updated: 2026-11-12
owner: "@dahai"
source_of_truth:
  - docs/tier-spec/SPEC.md
---

# Local-Model Tool Tier Spec — v1.0.0

An open standard for scaling an agent's tool surface to the parameter size
of a local model. Small models drown in large tool menus; this spec defines
how to pick a tool subset that a model of a given size can actually drive.
Born from fusion-code's `mlxToolTiers` (#222); published so other local-model
agents can implement the same semantics and interop.

Normative language: MUST / SHOULD / MAY per RFC 2119.

## 1. Size parsing

A **model id** is a string. Its **parameter size** is a real number of
billions, extracted as follows:

1. The implementation MUST search the model id (case-insensitive) for a
   match of the regex `(\d+(?:\.\d+)?)b\b` — a decimal number followed by
   the letter `b` at a word boundary.
2. If a match exists, the size is the parsed float. Otherwise the size is
   **unknown**.
3. The word boundary is load-bearing: `4bit` MUST NOT parse as size `4`
   (`4b` is followed by `it` — no boundary), and `14b` MUST NOT degrade to
   `1` (numeric match, never substring matching).

Examples: `qwen2.5-coder-3b-instruct` → 3; `llama-0.6b` → 0.6;
`qwen2.5-coder-32b-instruct` → 32; `glm-4.5-air` → unknown (no `<n>b`
token); `foo-4bit` → unknown.

## 2. Tier selection

Tiers are ordered by an upper parameter bound. The spec defines three
reference tiers, but an implementation MAY ship any number ≥ 1:

| Tier | Upper bound (billions) | Selection rule |
|---|---|---|
| core | 2 | size ≤ 2 |
| medium | 9 | 2 < size ≤ 9 |
| full | none | size > 9, or size unknown |

Normative rules:

1. An implementation MUST select the tier with the smallest upper bound
   that is ≥ the model's size.
2. Unknown size MUST select the FULL (unbounded) tier — fail-open. A model
   whose size cannot be parsed (cloud names, nonstandard ids) keeps the
   full tool surface; degrading blind is worse than over-including.
3. Tier tool sets MUST form a superset chain: every tool of a smaller tier
   is present in every larger tier (core ⊆ medium ⊆ full). Breaking the
   chain makes tier downgrades silently remove baseline capability.

## 3. Reference tool sets

The reference sets below are what fusion-code ships. Conformance to this
spec does NOT require these exact names — it requires the *shape* (chain +
bounds + parse rule) and an honest table (§4). Names are agent-specific.

- **core**: Bash, Read, Write, Edit, MultiEdit, Glob, Grep — the edit-test
  loop a ≤2B model can drive.
- **medium**: core + AskUserQuestion, TodoWrite, WebFetch, WebSearch.
- **full**: medium + Agent, Task*, NotebookEdit, Skill, plan-mode,
  team/artifact/goal tools, and everything else.

## 4. Tier table documents

A conformant implementation SHOULD publish its tiers as a JSON document
validated by `tiers.schema.json` (same directory). Required fields:

- `specVersion` — semver of this spec the document conforms to.
- `tiers[]` — ordered small→large, each with `name`, `tools[]`, and
  `maxParamsB` (number, or `null` for the single unbounded FULL tier).
- Exactly one tier MUST have `maxParamsB: null`.

fusion-code's instance: `tiers.json` (this directory). The conformance
test suite (`src/__tests__/utils/tierSpecConformance.test.ts`) validates
the instance against the schema and asserts the runtime `getMlxToolFilter`
matches the published table — the spec and the runtime cannot drift.

## 5. Conformance checklist

An implementation conforms to v1.0.0 when:

- [ ] Size parsing follows §1 exactly (decimal support, word boundary,
      numeric — never substring).
- [ ] Tier selection follows §2 (smallest bound ≥ size; unknown → full).
- [ ] Tool sets form a superset chain (§2.3).
- [ ] A tier table document per §4 is published and passes the schema.
- [ ] A conformance test pins the runtime behavior to the table.
