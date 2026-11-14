# Team CLI (`fusion-code team`)

Manifest-based team registration over the agent-studio daemon (`teams.*` RPC). fusion-code is a pure RPC consumer — the team kernel lives in `fusion-harness`, the dispatcher in `fusion-agent-studio`.

## Commands

```
fusion-code team register <manifest.json>
fusion-code team status [team]
fusion-code team task add <team> <title> [--detail TEXT] [--assignee MEMBER]
fusion-code team send <team> <member> <message> --from SENDER
fusion-code team disband <team>
```

Output is JSON on stdout; errors go to stderr with exit code 1.

## Contract semantics

### `lead` is not an implicit identity

There is **no built-in `lead` member**. The kernel (`fusion-harness` `team_runtime.send` / `broadcast`) validates that BOTH the sender and the recipient of a mailbox message are **declared members** of the team definition. A sender name that is not in the manifest member list is rejected with `unknown member: <name>`.

Consequences:

- If you want to send messages *as the lead*, the manifest must **explicitly declare a lead member** (e.g. `{"name": "lead", "role": "orchestrator", ...}`) and pass `--from lead`.
- `fusion team send` requires `--from SENDER`; there is no default sender. A default of `"lead"` existed in earlier builds and was removed — it silently failed against every real team whose manifest did not declare a `lead` member.

### Send validation

- `--from` must name a declared member.
- The recipient (`<member>` argument) must name a declared member.
- The `--from` flag tokens are stripped from the message body — `send t alice hello --from bob` delivers body `hello`, sender `bob`.

### Namespace isolation

`namespace_key` defaults to `team:<repo basename>` and anchors team memory. N manifests = N isolated teams; two teams in different repos never share memory.

## Daemon lifecycle notes

- The agent-studio daemon keeps the teams registry **in memory** — a daemon restart clears all teams; re-register your manifests afterwards. A `team not registered` error after a daemon restart is expected, not a client bug.
- Auth: UDS peer trust (`apikey.loopback_create`) → `auth.login` → `_auth: {jwt}` on all teams.* calls. The key is cached at `~/.fusion-code/studio.key` (0600); `FUSION_AGENT_STUDIO_API_KEY` overrides.

## Example manifest

```json
{
  "name": "duo",
  "members": [
    { "name": "lead", "role": "orchestrator", "skills": [], "tools": [] },
    { "name": "alice", "role": "implementer", "skills": ["typescript"], "tools": ["Read", "Edit"] }
  ],
  "tasks": [
    { "title": "initial task", "assignee": "alice" }
  ]
}
```

With this manifest, `fusion-code team send duo alice "start" --from lead` succeeds because `lead` is a declared member.
