# Plugin Authoring Guide

> ar-plan PR #6 (E2) — `.fusion-plugin` format + sha256 integrity pinning.
> From zero to submitting a plugin to the official registry.

## Table of Contents

1. [Plugin layout](#plugin-layout)
2. [The manifest (`plugin.json`)](#the-manifest-pluginjson)
3. [`schemaVersion` — format versioning](#schemaversion--format-versioning)
4. [Integrity pinning (sha256)](#integrity-pinning-sha256)
5. [Commit-SHA locking (git sources)](#commit-sha-locking-git-sources)
6. [Local testing](#local-testing)
7. [Submitting to the registry](#submitting-to-the-registry)

<!-- sections filled below -->

## Plugin layout

A plugin is a directory containing a `plugin.json` manifest plus optional
sub-directories for the capabilities it ships:

```
my-plugin/
├── plugin.json          # manifest (required) — see below
├── commands/            # slash commands (optional)
│   └── build.md
├── skills/              # bundled skills (optional)
│   └── my-skill/SKILL.md
├── hooks/
│   └── hooks.json       # lifecycle hooks (optional)
├── agents/              # subagents (optional)
└── README.md            # human docs (optional, recommended)
```

`commands/`, `skills/`, `hooks/`, `agents/` are all optional — ship only what
the plugin uses. The manifest `plugin.json` is the single required file.

## The manifest (`plugin.json`)

The manifest is a JSON object validated by `PluginManifestSchema`
(`src/utils/plugins/schemas.ts`). Only `name` is required; the rest is optional.

```json
{
  "schemaVersion": 2,
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Does useful thing X",
  "author": { "name": "Your Name", "email": "you@example.com" },
  "homepage": "https://github.com/you/my-plugin",
  "license": "MIT",
  "keywords": ["build", "ci"],
  "commands": ["./commands/build.md"],
  "skills": ["./skills/my-skill"],
  "hooks": "./hooks/hooks.json"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `schemaVersion` | integer | no (default 0) | Format version — see below |
| `name` | string | **yes** | kebab-case, no spaces |
| `version` | string | no | semver, e.g. `1.2.3` |
| `description` | string | no | one-line user-facing summary |
| `author` | object | no | `{ name, email?, url? }` |
| `homepage` | URL | no | docs/homepage |
| `repository` | string | no | source repo |
| `license` | string | no | SPDX id (`MIT`, `Apache-2.0`, …) |
| `keywords` | string[] | no | discovery tags |
| `dependencies` | string[] | no | other plugins this one needs |

Validate locally before submitting:

```bash
fusion-code plugin validate ./my-plugin
```

## `schemaVersion` — format versioning

`schemaVersion` pins the manifest format version so future changes stay
forward-compatible. **附录 B 双兼容规则:**

- **even** = stable (`2`, `4`, …) — safe for production
- **odd** = experimental (`1`, `3`, …) — may change without notice
- `0` (or omitted) = pre-E2 manifest, accepted during the compat window

Pin a stable even number in published plugins:

```json
{ "schemaVersion": 2, "name": "my-plugin" }
```

Omitting it works today (defaults to `0`) but emits a warning via
`fusion-code plugin validate` — pin it so your plugin is ready when the compat
window closes.

## Integrity pinning (sha256)

Plugins distributed as a downloadable archive (`source: "archive"`) should
**pin the archive's sha256** so a tampered or corrupt download is refused
(fail-visible, Rule 12), not silently installed.

Compute the sha256 of your published `.zip`:

```bash
shasum -a 256 my-plugin-1.0.0.zip
# → 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08  my-plugin-1.0.0.zip
```

Then declare it on the install source:

```json
{
  "source": "archive",
  "url": "https://example.com/my-plugin-1.0.0.zip",
  "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "rootDir": "my-plugin-1.0.0"
}
```

Behavior:

- **sha256 present**: downloaded bytes verified with a constant-time compare;
  mismatch → throw, archive is not extracted.
- **sha256 absent** (default, fail-open): skipped with a debug log. Accepted
  during the compat window — the download still trusts HTTPS transport.
- **`FUSION_CODE_PLUGIN_SHA256_STRICT=1`**: a missing sha256 itself throws
  (fail-visible), forcing supply-chain pinning. Set this in CI / hardened
  environments to block unpinned archive sources entirely.

sha256 must be lowercase hex, exactly 64 chars.

## Commit-SHA locking (git sources)

For `git` / `github` install sources, pin a specific commit SHA so the same
source always resolves to the same bytes:

```json
{
  "source": "github",
  "repo": "you/my-plugin",
  "sha": "a1b2c3d4e5f67890123456789abcdef012345678"
}
```

The loader clones with `--no-checkout` + `fetch --depth 1 origin <sha>` +
`checkout <sha>` — a pinned, shallow, reproducible checkout. `sha` is optional;
omit it to track the default branch (less reproducible).

## Local testing

```bash
# 1. Validate the manifest
fusion-code plugin validate ./my-plugin

# 2. Install from the local directory
fusion-code plugin install ./my-plugin

# 3. Load + exercise in a session
fusion-code
/plugins        # confirm it appears + is enabled
```

`validate` catches: name not kebab-case, missing version, unrecognized
marketplace-only fields, path-traversal in referenced files, and
`schemaVersion === 0` (warns, nudges you to pin).

## Submitting to the registry

The official registry (`fusion-plugins-official`) is a `registry.json` index
of curated plugins. Each entry mirrors the install source + metadata:

```json
{
  "schemaVersion": 0,
  "updated": "2026-08-27T00:00:00Z",
  "plugins": [
    {
      "name": "my-plugin",
      "version": "1.0.0",
      "description": "Does useful thing X",
      "category": "official",
      "source": { "type": "github", "repo": "you/my-plugin", "sha": "a1b2c3d..." },
      "sha256": "9f86d081..."
    }
  ]
}
```

Users discover it via:

```bash
fusion-code plugins discover
fusion-code plugins discover build         # filter by query
```

To submit a plugin to the official registry, open a PR on the
`fusion-plugins-official` repo adding your entry to `registry.json`. Pin both
`sha` (git) or `sha256` (archive) so installs are reproducible and
tamper-evident.
