# Changelog

## 0.2.1-rc.1 — first experience release

- Added standalone Windows, Linux, and macOS release artifacts plus one-line
  installers, so normal Agulater users no longer need Bun, Node.js, or npm.
- Added project and third-party license notices to standalone archives.
- Made GitHub standalone publication independent from the optional npm token;
  npm publication is skipped cleanly when credentials are not configured.
- Prepared package metadata, installers, and product documentation for the
  final `storious/agulater` repository name.
- Kept the Bun/npm package as an optional compatibility and source-development
  path rather than the default installation route.
- Added user and project Package v2 preparation with explicit Skills, Plugins,
  contexts, child packages, Specialist harnesses, and execution Pools.
- Added the AgentKube Catalog lifecycle, including discovery, installation,
  updates, managed Store state, and deterministic Runtime Snapshots.
- Added Agul runtime installation and updates across Windows x64, Linux x64,
  macOS x64, and macOS ARM64, with independent `stable` and `next` channels,
  platform-aware GitHub Release selection, and migration from legacy Windows
  launchers that could shadow the managed runtime.
- Added a default user assistant that is created only when `~/.agents` is
  missing, leaving existing unmanaged setups untouched.
- Prepared npm distribution as `agulater`, with prereleases on `next`, stable
  releases on `latest`, and the identical package archive attached to each
  GitHub Release.
