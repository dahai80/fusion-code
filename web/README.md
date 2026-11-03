# Fusion Code Web GUI

Session-centric web workbench over the fusion-code kernel (issue #228 DC-1,
#229 checkpoints/verify/rollback/diff/PR, #230 usage view).
The kernel stays a cross-platform CLI — this thin shell orchestrates kernel
subprocesses and renders sessions, steps, and file changes in the browser.

## Views

- `/sessions` — session list grouped by repo + new-session composer with
  repo/branch selector row (frame C1)
- `/session/:id` — conversation with inline per-step commands, live
  right-rail file changes + per-file diff viewer, checkpoints
  (verify/rollback), PR flow, permission panel, follow-up composer (frame C2)
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
| `POST /api/sessions/:id/checkpoints/:uuid/verify` | run repo verify command |
| `POST /api/sessions/:id/checkpoints/:uuid/rollback` | kernel `--rewind-files` restore |
| `POST /api/sessions/:id/pr` | branch + commit + push + `gh pr create` |
| `GET /api/usage` | token/cost aggregation (#230) |

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

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `FUSION_CODE_WEB_PORT` | `11482` | Backend port (port-registry owner `fusion-code-web`) |
| `FUSION_CODE_WEB_BIND` | `127.0.0.1` | Bind host |
| `FUSION_CODE_WEB_DATA_DIR` | `~/.fusion-code/web` | Store location (repos/sessions/permissions) |
| `FUSION_CODE_WEB_KERNEL_BIN` | repo `./fusion-code` binary | Kernel binary (or command, space-split) |
| `FUSION_CODE_WEB_CLONE_DIR` | `~/fusion-code-repos` | Clone target for git-URL repo connects |
| `FUSION_CODE_WEB_GH_BIN` | `gh` | `gh` binary used by the PR flow (test shim override) |
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
