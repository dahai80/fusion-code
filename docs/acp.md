---
doc_id: fusion-code/acp
product: fusion-code
class: app
entry: guided-ui
doc_type: guide
title: { zh: "ACP 服务器", en: "ACP Server" }
audience: engineer
status: draft
version: 0.7.0
updated: 2026-11-12
owner: "@dahai"
source_of_truth:
  - docs/acp.md
---

# ACP Server (Agent Client Protocol)

> Evolution plan P3.1 (C8): expose the agent over ACP so editors connect
> without a bespoke extension.

## What it is

`fusion-code acp` starts an ACP v1 agent: JSON-RPC 2.0, newline-delimited,
over stdio (the only transport ACP v1 defines). Any ACP client — Zed, or a
custom harness — launches `fusion-code acp` as a subprocess and talks the
standard protocol.

It is a **translation layer, not a rewrite**: each `session/prompt` spawns
the kernel headless (`-p <prompt> --output-format stream-json --verbose`)
with the session's `cwd`, and the stream-json event line is translated to
ACP notifications:

| Kernel stream event | ACP message |
|---|---|
| `stream_event` `content_block_delta` (`text_delta`) | `session/update` `agent_message_chunk` |
| `assistant` message `tool_use` block | `session/update` `tool_call` (`in_progress`, kind from tool name) |
| `user` message `tool_result` block | `session/update` `tool_call_update` (`completed` / `failed`) |
| `result` | `session/prompt` response `{stopReason}` |

`stopReason` mapping: `is_error` → `refusal`; `error_max_turns` subtype →
`max_turn_requests`; `session/cancel` received → `cancelled`; else
`end_turn`.

## Supported surface (v1)

- `initialize` → `protocolVersion: 1`, `agentCapabilities`
  (`loadSession: false`, no image/audio/embeddedContext prompt
  capabilities), `agentInfo`, `authMethods: []`
- `session/new` (`cwd` honored; `mcpServers` accepted but the kernel's own
  MCP config is used) → `sessionId`
- `session/prompt` (`prompt` content blocks; text blocks joined)
- `session/cancel` notification → kills the running kernel turn
- Not supported: `session/load` / `session/resume` (`loadSession: false`),
  `session/request_permission` (permission mode comes from kernel config),
  client fs/terminal methods (the kernel's own tools handle fs access).

## stdout discipline

The ACP spec forbids any non-JSON-RPC byte on stdout. The agent's own
stdout carries only ACP messages; the kernel child's stdout is piped and
consumed by the translator. On stdin EOF the process exits via
`process.exit(0)` — deliberately not `gracefulShutdownSync`, which writes
terminal-mode escape sequences to stdout.

## Zed configuration

`~/.config/zed/settings.json`:

```json
{
  "agent": {
    "profiles": {
      "fusion-code": {
        "name": "Fusion Code",
        "default": true
      }
    }
  },
  "context_servers": {
    "fusion-code": {
      "source": "custom",
      "command": "/path/to/fusion-code",
      "args": ["acp"]
    }
  }
}
```

(Key names may differ per Zed version — follow Zed's current ACP docs for
the exact settings shape; the wire side is standard ACP v1.)

## Testing

`bun test tests/cli/acp.test.ts` drives `createAcpAgent` directly with a
stub kernel emitting a stream-json transcript: initialize handshake,
pre-initialize refusal, full prompt turn (chunks + tool lifecycle +
stopReason), unknown session/method errors, error→refusal mapping.
`FUSION_CODE_TASK_FUSION_BIN` is the kernel test seam (same as task.ts).
