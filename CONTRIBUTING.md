# Contributing

Keep Agulater focused on lifecycle and preparation: runtime installation and
updates, Catalog and extension management, package migration, and compilation
of `.agents` packages into Agul runtime state. Model sessions and coordination
belong elsewhere.

## Branch and release flow

- `main` is the formal, release-ready line. Tags and releases come from
  `main`.
- `dev` is the integration line for development, routine maintenance, and
  internal use.
- Start product features from the latest `main` as `feat/<short-slug>`.
- Start bug fixes from the latest `main` as `fix/<short-slug>`.
- Merge feature and fix branches into `dev` first. They must pass CI and the
  repository checks and prove useful in internal use before release.
- Promote `dev` to `main` when it contains a meaningful, complete release
  batch. This is a product milestone, not a requirement to accumulate one
  oversized diff.
- After a release, bring the resulting `main` state back into `dev` before the
  next release cycle diverges.

Routine documentation, dependency, and repository maintenance may land on
`dev` without a dedicated feature branch. Keep `dev` usable, and do not tag or
publish releases from `dev`, `feat/*`, or `fix/*`.

Use `fix/*` for defects reproducible from `main`. A defect found only in
unreleased feature work remains part of its `feat/*` branch during internal
use. Delete work branches after their changes reach `main`.

Run `bun test` for changes to the CLI, preparation, lifecycle, or package
contracts. During iteration, start with the narrowest relevant test.
