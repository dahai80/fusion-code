---
doc_id: fusion-code/hooks-recipes
product: fusion-code
class: app
doc_type: guide
title: { zh: "Hooks 配方：确定性闸门", en: "Hooks recipes: deterministic gates" }
audience: engineer
entry: developer
status: draft
version: 0.1.0
updated: 2026-11-27
owner: "@dahai"
source_of_truth:
  - docs/hooks-recipes.md
---

# Hooks recipes: deterministic gates

Practical hook configurations for enforcing non-negotiable process rules.
Hooks are wired in `settings.json` (`hooks` key); every event below is
from `src/entrypoints/sdk/types.ts` (`HookEvent`). Philosophy per the
Claude Code best-practices parity list: a rule that must never be broken
belongs in a hook, not in the prompt.

Contract (verified against `src/types/hooks.ts` +
`src/utils/hooks/hooksConfigManager.ts`): the hook command receives JSON
on stdin (`tool_name`, `tool_input`, `tool_use_id` for PreToolUse); it
returns JSON on stdout with exit code 0.

- Stop gate: `{"decision": "block", "reason": "..."}` — the session keeps
  running and the model sees `reason`.
- Tool deny: `{"hookSpecificOutput": {"hookEventName": "PreToolUse",
  "permissionDecision": "deny", "permissionDecisionReason": "..."}}`.

## Recipe 1 — stage-gate verdict lock (blocked-until-verdict)

Forces an agent session working on a staged pipeline (e.g. the biz
delivery pipeline: req → prd → rnd → valid → launch) to refuse finishing
a stage until the reviewer's verdict file exists and says `pass`.

`settings.json`:

```json
{
    "hooks": {
        "Stop": [
            {
                "matcher": "*",
                "hooks": [
                    {
                        "type": "command",
                        "command": "bash .fusion/hooks/stage-gate.sh"
                    }
                ]
            }
        ]
    }
}
```

`.fusion/hooks/stage-gate.sh` (repo-local, keep it in the repo so every
worker inherits the gate):

```bash
#!/usr/bin/env bash
# Stage gate: block Stop until docs/review-<stage>.md has verdict=pass.
# Config via env: GATE_STAGE=prd GATE_DOC=docs/review-prd.md
set -u
DOC="${GATE_DOC:-docs/review-$(printf '%s' "${GATE_STAGE:-prd}").md}"
if [ ! -f "$DOC" ]; then
    echo "{\"decision\": \"block\", \"reason\": \"Stage gate: $DOC missing - stage not reviewed.\"}"
    exit 0
fi
if ! grep -qiE 'verdict:[[:space:]]*pass' "$DOC"; then
    echo "{\"decision\": \"block\", \"reason\": \"Stage gate: $DOC has no verdict: pass - stage is rejected or pending.\"}"
    exit 0
fi
exit 0
```

Behavior: the session cannot stop while the gate is closed; the agent
sees the `reason` and keeps working (or hands back to the orchestrator).
The reviewer (separate session, different model per pipeline risk item
15.4) writes `verdict: pass` into the doc to open the gate.

## Recipe 2 — document-contract presence check

Pipeline stages end with named artifacts (`prd.md`, `archi-plan.md`,
`work-plan.md`). Gate the transition with the same `Stop` pattern,
checking all required files exist:

```bash
#!/usr/bin/env bash
set -u
for f in docs/prd.md docs/archi-plan.md docs/work-plan.md; do
    if [ ! -s "$f" ]; then
        echo "{\"decision\": \"block\", \"reason\": \"Document contract incomplete: $f missing or empty.\"}"
        exit 0
    fi
done
exit 0
```

## Recipe 3 — reuse guard for archi-plan

Risk item: reviewers and authors sharing a model rubber-stamp each other.
Two mitigations compose with the gates above:

1. Run the reviewer session with a different `FUSION_MODEL` (per-invocation
   model routing, `src/services/api/claude.ts`).
2. Add a `PreToolUse` hook on the reviewer session that denies `Edit`/
   `Write` on the artifacts under review — the reviewer may write
   `review-*.md` verdicts but never the artifact itself (separation of
   duties). The tool input arrives as JSON on stdin:

```json
{
    "hooks": {
        "PreToolUse": [
            {
                "matcher": "Edit|Write",
                "hooks": [
                    {
                        "type": "command",
                        "command": "bash .fusion/hooks/no-self-review.sh"
                    }
                ]
            }
        ]
    }
}
```

```bash
#!/usr/bin/env bash
# Reviewer sessions must not edit the artifacts they review.
set -u
INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null)
case "$FILE" in
    */docs/prd.md|*/docs/archi-plan.md|*/docs/work-plan.md)
        echo '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "Reviewer sessions cannot edit artifacts under review."}}'
        ;;
esac
exit 0
```

## Notes

- Keep gate scripts in the repo (`.fusion/hooks/`) so isolation containers
  and worktree runs inherit them without host config.
- Fail-closed: missing files block; only an explicit `verdict: pass` opens.

