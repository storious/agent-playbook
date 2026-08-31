# Packages and preparation

Agulater turns readable source packages into deterministic runtime state for
Agul. Source manifests and preparation contracts belong to Agulater; model
execution and runtime protocols belong to Agul.

## Package v2

`package.json` is strict: unknown fields and every legacy package format are
rejected. A minimal package is:

```json
{
  "format": "agulater/package/v2",
  "id": "example/helper",
  "version": "0.1.0",
  "description": "A focused project helper.",
  "instructions": "AGENTS.md"
}
```

The only optional top-level fields are `resources`, `dependencies`, and
`profile`. Resources are explicit rather than directory scans:

```json
{
  "resources": {
    "skills": [{ "id": "review", "path": "skills/review" }],
    "plugins": [{ "id": "coordinator", "path": "../plugins/coordinator" }],
    "contexts": [
      {
        "id": "core",
        "description": "Stable project facts.",
        "path": "context/core.md",
        "load": "eager"
      },
      {
        "id": "reference",
        "description": "Detailed reference material.",
        "path": "context/reference.md",
        "load": "on_demand"
      }
    ],
    "packages": [{ "path": "packages/repository-scout" }]
  }
}
```

Eager Markdown context is appended to generated instructions. On-demand
context becomes a generated Skill, so it remains available without consuming
the initial context window. Skill, Plugin, and nested Package resource paths
may use clean package-relative `..` segments; absolute paths and backslashes
are rejected because they are not portable.

Dependencies use typed buckets and optional sources:

```json
{
  "dependencies": {
    "skills": [
      { "id": "review", "version": "^1.0.0" },
      { "id": "local-rules", "source": { "type": "host" } }
    ],
    "packages": [
      {
        "id": "repository-scout",
        "version": "0.1.0",
        "source": { "type": "path", "path": "../repository-scout/.agents" }
      }
    ]
  }
}
```

An omitted source means `catalog`. Other source types are `host`, `path`, and
`git`. `host` searches conventional `.agents`, `.codex`, and `.claude`
locations and rejects ambiguous names. Catalog resolution chooses the highest
stable matching SemVer; a prerelease is selected only by a range that names a
prerelease.

## Specialist profile and harness

A Package becomes a prepared child Specialist only when it declares a
`profile`:

```json
{
  "profile": {
    "accepts": ["repository-search"],
    "workspace_effect": "read",
    "contexts": ["core"],
    "harness": "harness.json"
  }
}
```

The referenced `agulater/harness/v1` file declares the deterministic task
template, model requirements, default limits, result bounds, and completion
rules. Agulater validates it and compiles its operational summary plus one
minimal canonical handoff block into the Specialist's generated
`instructions.md`. The handoff format itself is part of
[Agul's handoff schema](https://github.com/storious/agul/blob/main/schemas/handoff-v1.schema.json).
Coordinators can keep each dynamic prompt limited to the task, its context, and
scoped paths.

## Pools

Pool configuration lives at `.agents/pools.json`:

```json
{
  "format": "agulater/pools/v2",
  "default_pool": "local",
  "pools": [
    {
      "id": "local",
      "engine": "native",
      "description": "Bounded local work",
      "labels": ["local", "bounded"],
      "provider": "openai-compatible",
      "endpoint": "http://127.0.0.1:8000/v1",
      "model": "local-model",
      "context_window": 32768,
      "capabilities": ["read", "shell"],
      "max_concurrency": 2,
      "request_timeout_seconds": 420
    }
  ]
}
```

Every Pool declares the Agul engine it drives. A native Pool is deterministic
preparation for an OpenAI-compatible Provider, so `provider`, `endpoint`,
`model`, and `context_window` are required. A Codex Pool uses the ChatGPT
account managed by the host's Codex installation and needs none of those
placeholders:

```json
{
  "format": "agulater/pools/v2",
  "default_pool": "codex-account",
  "pools": [
    {
      "id": "codex-account",
      "engine": "codex",
      "capabilities": ["read", "write", "edit", "shell"],
      "max_concurrency": 1,
      "request_timeout_seconds": 600
    }
  ]
}
```

Codex Pools may select `model`, `reasoning_effort`, or `codex_command`. An
optional `context_window` is a routing declaration for matching Specialist
requirements; the Codex engine still owns the effective model context. Native
Provider fields are rejected on Codex Pools, and `codex_command` is rejected on
native Pools. Pools v1 are not accepted.

Project Pools layer over the user file at `~/.agents/pools.json`. Replacing a
user Pool with the same ID requires `"override": true`; the generated file
removes that preparation-only flag. With no configured Pools, Agulater writes
`{"format":"agulater/pools/v2","pools":[]}`.

## Preparation output

`prepare` builds a complete sibling staging directory, validates every input,
and swaps it into place only after compilation succeeds. A validation or copy
failure therefore leaves the prior Runtime Snapshot usable:

```text
.agents/runtime/
├── launch.json                 # agul/launch/v2
├── instructions.md
├── snapshot.json               # agulater/snapshot/v1
├── specialists.json            # agulater/specialists/v1
├── pools.json                  # agulater/pools/v2
├── resources/
└── specialists/<id>/
    ├── launch.json
    ├── instructions.md
    └── snapshot.json
```

`agul/launch/v2` deliberately contains only `format`, `instructions`, and
optional `skills` and `plugins` directory locators. The Coordinator discovers
the prepared Specialist and Pool registries beside the launch instead of
widening Agul's runtime contract.

```console
agulater prepare --path <workspace>
agulater prepare --user
```

See the [formal schemas](../schemas/README.md) for exact fields and
[Catalogs and extensions](catalog.md) for source resolution and installation.
