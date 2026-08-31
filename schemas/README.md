# Agulater schemas

Agulater owns the compile-time contracts in this directory:

- `package-v2.schema.json` — strict source Package manifest.
- `harness-v1.schema.json` — bounded Specialist harness.
- `pools-v2.schema.json` — strict native/Codex Pool inputs and generated Pool registry.
- `snapshot-v1.schema.json` — exact prepared resources and resolved dependencies.
- `specialists-v1.schema.json` — Coordinator-facing prepared Specialist registry.
- `catalog-v1.schema.json` — shared discovery entries owned by Agulater.
- `catalogs-v1.schema.json` — user Catalog registrations.
- `runtime-releases-v1.schema.json` — optional local or hosted Agul release index.

All use JSON Schema 2020-12. Agul owns `agul/launch/v2` and
[`agul/handoff/v1`](https://github.com/storious/agul/blob/main/schemas/handoff-v1.schema.json).
Agulater owns `agulater/catalog/v1`; AgentKube publishes content that follows
it but does not define a second Catalog contract.

Runtime preparation also writes replayable source records with
`agulater/sources/v1` and Store records with `agulater/store-source/v1`. They
are installation state rather than Agul runtime contracts.

Pools v2 requires an explicit `engine`. Native Pools carry their Provider
endpoint, model, and context window. Codex Pools use the host's managed Codex
account and therefore do not require placeholder Provider fields; an optional
model, Codex command, or declared context window may still guide a prepared
runtime.
