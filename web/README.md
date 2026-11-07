---
doc_id: fusion-code/readme
product: fusion-code
class: app
entry: guided-ui
doc_type: readme
title: { zh: "fusion-code Web 工作台", en: "fusion-code web workbench" }
audience: engineer
status: draft
version: 0.5.22
updated: 2026-11-07
owner: @dahai
source_of_truth:
  - web/README.md
---

# Fusion Code Web GUI

Session-centric web workbench over the fusion-code kernel (issue #228 DC-1,
#229 checkpoints/verify/rollback/diff/PR, #230 usage view).
The kernel stays a cross-platform CLI — this thin shell orchestrates kernel
subprocesses and renders sessions, steps, and file changes in the browser.

## Views

- `/sessions` — session list grouped by repo + new-session composer with
  repo/branch selector row and an optional isolated-worktree toggle (#237)
- `/session/:id` — conversation with inline per-step commands, live
  right-rail file changes + per-file diff viewer with inline comments
  (click a +/- diff line to anchor one, #237), checkpoints (verify/rollback),
  PR flow, permission panel with tier hints, follow-up composer (frame C2),
  command palette (workflow prompt templates, #241) + transcript export
  (markdown download, #241)
- `/repos` — repo connect (local git path or clone URL) + branch overview +
  per-repo verify command
- `/usage` — token/cost totals aggregated per repo and session (#230)
- `/settings` — permission-mode semantics + environment template notes
- `/repos` — per-repo setup command (env templates v2): configure e.g. `bun install`, run on demand, see recorded output

## Architecture

```
browser ── same-origin /api + /ws ──> web server (Bun, port 11482)
                                        ├─ store: repos/sessions/permissions (~/.fusion-code/web)
                                        ├─ git: status/diff/branches per repo
                                        ├─ runner: kernel subprocess per run
                                        │    fusion-code -p <msg> --output-format stream-json
                                        │    --verbose [--resume <kernel-session-id>]
                                        │    [--allowedTools ...]  (cwd = repo path)
                                        └─ gateway: manifest POST + 15s heartbeat
```

Key properties:

- **Server-owned runs** — a browser disconnect does NOT kill a run; events
  buffer in a per-session ring and replay on WS reconnect.
- **Session continuity** — the first run links the web session to the kernel
  session id (from the init event); follow-ups spawn the kernel with
  `--resume` so context carries across turns.
- **Kernel zero-change** — the web layer only uses existing CLI flags and
  the session JSONL layout; no kernel code was modified.
- **Permissions** — per-session allowlist (`--allowedTools`) with a read-only
  default; "ask every time" mode allows read-only tools only and surfaces
  denials in-session.

## Checkpoints, verify, rollback, PR (#229)

Every user prompt is a checkpoint. The runner spawns the kernel with
`FUSION_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1` so the kernel snapshots the
worktree at each prompt submit; prompt uuids are synced from the session
JSONL after each turn (real kernels do not echo the prompt in stream-json).

- **Verify** — runs the repo's verify command (configured per repo on
  `/repos`, e.g. `bun test`) and stamps the checkpoint pass/fail + output.
- **Rollback** — `fusion-code --resume <kernel-session-id> --rewind-files
  <prompt-uuid>` restores tracked files to the state when that prompt was
  submitted (standalone kernel op, no model call), then the Changes rail
  refreshes.
- **Diff viewer** — click any changed file for a unified diff (tracked: vs
  HEAD; untracked: rendered as a new-file diff).
- **PR flow** — branch (`fusion-code/web-<session-prefix>`) + `git add -A` +
  commit + push + `gh pr create`; the PR URL lands on the session. The clean
  worktree is rejected before commit (locale-independent `git diff --cached
  --quiet` check).

## Command palette + transcript export (#241)

- **Command palette** — the `Commands` button next to the composer opens a
  searchable palette over `GET /api/commands` (16 curated entries: plan,
  todo, review, review-pr, simplify, security-review, secrets-scan,
  commit-push-pr, update-branch, release-notes, docs-update, verify,
  types-fix, test-write, refactor, debug). Entries are natural-language
  prompt templates, NOT kernel slash names — print mode (`-p`, the web
  execution path) deliberately skips slash handling. Selecting an entry
  fills the composer for editing before send.
- **Transcript export** — the download icon in the Checkpoints rail header
  fetches `GET /api/sessions/:id/export` and saves the kernel transcript
  rendered as markdown (user/assistant turns + tool names). Returns 404
  until the session has a kernel transcript.

## Model policy (#240)

The manifest declares `model_capable: true` + `suggested_model` (a
coding-strong model from the gateway matrix). New sessions resolve their
model at RUN time — editing `web/manifest.json` changes the default for new
sessions without a rebuild — through a first-wins chain:

1. explicit per-session pick (composer "Model" input) — validated against
   the allowlist/privacy policy, rejected with a field-located 400 when it
   violates one
2. module override — `FUSION_CODE_WEB_MODEL_OVERRIDE`
3. platform preference — best-effort `GET <FUSION_SHELL_GATEWAY_URL>/api/v1/model-policy`
   (60s negative cache; absent/unreachable = fail-open to the next source)
4. manifest `suggested_model`
5. the kernel's own `FUSION_MODEL` env (env-file semantics from #234/#236
   still apply when nothing above resolves)

`privacy_mode=local_only` (platform policy or `FUSION_CODE_WEB_PRIVACY_MODE`)
pins sessions to local models (`mlx-*`/`local-*`, extended by
`FUSION_CODE_WEB_LOCAL_MODELS`); non-local candidates are skipped and
non-local explicit picks are rejected. The resolved model rides the spawn
env (`FUSION_MODEL` wins over the env file — it is the deliberate per-run
choice) and `--model`. `GET /api/models` exposes the effective default,
its source, the privacy mode, and the allowlist for the composer.

## Usage (#230)

Each turn's result message carries `usage` + `total_cost_usd`; the server
records per-turn `TurnUsage` and `GET /api/usage` aggregates totals by repo
and session for the `/usage` view. Local models report cost 0.

## Design handoff from fusion-design (#231)

fusion-design's [Send to Code] writes design export files plus a JSON
notification into `<FUSION_DESIGN_DATA_DIR>/fusion-code/` (default
`~/.fusion-design/fusion-code`). The backend polls that directory (3s), and
for each valid `sync-to-code` notification creates a web session titled
`Design: <component>` with the referenced files snapshotted as design
context, then archives the notification to `processed/` so restarts don't
re-ingest. The session's first run consumes the design files as inline
prompt context (`designPending` clears after delivery); the session page
shows the design card with per-file previews. Target repo = most recently
added repo, or `FUSION_CODE_WEB_DESIGN_REPO_ID` to pin one. Requires at
least one repo to be connected in `/repos` — with none registered the
notification is deferred and retried on later polls.

## API

Beyond #228 (`/health`, `/manifest.json`, `/api/repos`, `/api/sessions`,
`/api/sessions/:id/{,/permissions,/run}`, `/ws/:id`):

| Endpoint | Purpose |
|---|---|
| `PATCH /api/repos/:id` | update name / verify command / environment / setup command |
| `POST /api/repos/:id/setup` | run the repo's setup command in the worktree (v2 env templates); result recorded as `lastSetup` |
| `GET/POST /api/permissions/default` | global default permissions applied to NEW sessions (settings page); existing sessions keep their own rules |
| `GET /api/sessions/:id/diff?path=` | unified diff for one changed file |
| `GET /api/sessions/:id/checkpoints` | list captured checkpoints (#236) |
| `GET /api/models` | model capability surface: effective default + override constraints (#240) |
| `GET/POST /api/sessions/:id/comments` | inline diff comments, anchored to a diff line (#237) |
| `POST /api/sessions/:id/checkpoints/:uuid/verify` | run repo verify command |
| `POST /api/sessions/:id/checkpoints/:uuid/rollback` | kernel `--rewind-files` restore |
| `POST /api/sessions/:id/pr` | branch + commit + push + `gh pr create` |
| `GET /api/usage` | token/cost aggregation (#230) |
| `GET /api/commands` | curated workflow-command registry for the session command palette (#241); entries are natural-language prompt templates (print mode executes prompts, not slash commands) |
| `GET /api/sessions/:id/export` | download the session's kernel transcript as a markdown attachment (#241) |

## Commands

```bash
cd web
bun install
bun run dev        # Vite dev server on 11482 (proxies /api + /ws to backend)
bun run start      # production: backend serves dist + API + WS on 11482
bun run build      # typecheck + vite build -> dist/
bun run typecheck  # tsc --noEmit
bun run lint       # biome check src server
bun test tests     # unit + wire tests (mock kernel + real git repos)
```

Dev mode: run the backend with `FUSION_CODE_WEB_PORT=11483 bun run start`,
then `bun run dev` (Vite proxies `/api` + `/ws` to `FUSION_DEV_BACKEND`,
default `http://127.0.0.1:11483`).

## Service lifecycle (#233)

`web/start.sh` follows the fleet `start.sh` convention so fusion-supervisor
can manage this service like any other:

```bash
cd web
./start.sh start | stop | restart | status
```

Behavior: pid file in `web/run/`, output in `web/logs/`, SPA build check
(builds `dist/` if missing), and a port-registry self-check that refuses to
start unless `fusion-code-web: 11482` is declared in
`~/fusion/architecture/port-registry.yaml` (bypass with
`FUSION_SKIP_REGISTRY_CHECK=1`). An optional env file
`${FUSION_CODE_WEB_ENV_FILE:-~/.fusion-code/web.env}` is sourced before
start — put `FUSION_SHELL_GATEWAY_URL` / `FUSION_ADMIN_KEY` there to enable
gateway registration.

fusion-supervisor resolves the service to `~/fusion/fusion-code-web/start.sh`;
that path is a thin exec shim delegating to `web/start.sh`.

### Isolated worktrees (#237)

Sessions created with the "Isolated worktree" toggle run the kernel in a
dedicated git worktree (`<FUSION_CODE_CONFIG_DIR ?? ~/.fusion-code>/worktrees/<sessionId>`,
branch `fusion-code/web-<session-prefix>`) instead of the repo checkout, so
session edits never touch the repo directly. The path is load-bearing: the
kernel's permission engine whitelists the structural `<configDir>/worktrees/`
prefix — worktrees anywhere under the config dir get every write denied as a
sensitive file. Diff/verify/rollback/PR operations for the session resolve
against the worktree; deleting the repo removes its sessions' worktrees.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `FUSION_CODE_WEB_PORT` | `11482` | Backend port (port-registry owner `fusion-code-web`) |
| `FUSION_CODE_WEB_BIND` | `127.0.0.1` | Bind host |
| `FUSION_CODE_WEB_DATA_DIR` | `~/.fusion-code/web` | Store location (repos/sessions/permissions) |
| `FUSION_CODE_WEB_KERNEL_BIN` | repo `./fusion-code` binary | Kernel binary (or command, space-split) |
| `FUSION_CODE_WEB_CLONE_DIR` | `~/fusion-code-repos` | Clone target for git-URL repo connects |
| `FUSION_CODE_WEB_GH_BIN` | `gh` | `gh` binary used by the PR flow (test shim override) |
| `FUSION_CODE_WEB_MODEL_OVERRIDE` | unset | #240 module-level model override (wins over platform preference + manifest) |
| `FUSION_CODE_WEB_PRIVACY_MODE` | unset | #240 set to `local_only` to pin sessions to local models |
| `FUSION_CODE_WEB_MODEL_ALLOWLIST` | unset | #240 comma-separated gateway-style globs (e.g. `claude-3*,qwen*`) constraining per-session picks |
| `FUSION_CODE_WEB_LOCAL_MODELS` | unset | #240 extra model names/patterns treated as local under `local_only` privacy mode |
| `FUSION_DESIGN_DATA_DIR` | `~/.fusion-design` | Base dir of the fusion-design sync-to-code contract |
| `FUSION_CODE_WEB_DESIGN_REPO_ID` | latest repo | Pin the target repo for ingested design sessions |
| `FUSION_CODE_WEB_DESIGN_SYNC_INTERVAL_MS` | `3000` | Design-sync poll interval (0 disables the watcher) |
| `FUSION_CODE_WEB_ENV_FILE` | `~/.fusion-code/web.env` | Env file sourced by `start.sh` AND parsed at kernel spawn (#234: `FUSION_BASE_URL` / `FUSION_AUTH_TOKEN` here reach spawned CLI runs even when the server process starts bare; spawn fails fast with a structured `turn_error` if auth env is unresolvable). #236: env-file values WIN over the server process's inherited env — put the gateway LLM endpoint + a gateway `api_keys` credential + a model matching that key's `allowed_models` here (e.g. `FUSION_BASE_URL` / `FUSION_AUTH_TOKEN` / `FUSION_MODEL`), otherwise an ambient auth token (e.g. supervisor-injected admin key) reaches the spawned CLI and the turn dies with a gateway 403 |
| `FUSION_SHELL_GATEWAY_URL` | unset | Gateway URL — enables manifest registration |
| `FUSION_ADMIN_KEY` | unset | Gateway admin key (Bearer) for registration + heartbeat |

Kernel env (model endpoint, keys) is inherited from the server process —
export `FUSION_BASE_URL` / `FUSION_CLIENT_KEY` (or gateway vars) before
`bun run start`.

## Gateway registration

With `FUSION_SHELL_GATEWAY_URL` + `FUSION_ADMIN_KEY` set, the server posts
`manifest.json` to the gateway (`POST /api/v1/shell/manifests`) and keeps a
15s heartbeat, so the shell sidebar shows the `⌨ Code` menu and
`/shell/fusion-code/` proxies to this backend.

## Tests

`bun test tests` covers: store persistence + session/kernel-id linking, git
helpers against real temp repos, runner orchestration with a mock kernel
(events, buffering without subscribers, concurrent-run rejection), checkpoint
capture + kernel rollback argv, verify command pass/fail, the PR flow against
a bare origin with a `gh` shim, usage aggregation, and a full-stack HTTP+WS
smoke test (health, manifest, UC-C1 steps 2-5, diff/verify/usage/rollback
over the wire).
