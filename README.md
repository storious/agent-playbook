# Agulater

Agulater is an optional lifecycle and package tool for
[Agul](https://github.com/storious/agul). It installs or updates Agul runtimes,
manages Skills and Plugins, and compiles readable `.agents` packages into the
small launch files Agul consumes.

Agulater does not run models, provide a TUI, or coordinate agents.

## Do you need it?

- To run basic Agul: **no**. Use Agul's standalone binary or installer.
- To manage Agul versions or install AgentKube extensions: **yes**.
- To prepare a custom `.agents` package: **yes**.

Published Agulater releases are self-contained executables. Normal users do
not need Bun, Node.js, or npm. The source tree is TypeScript and uses Bun only
for development and release builds.

## Install the first experience release

`0.2.1-rc.1` is a prerelease, so use its pinned installer rather than GitHub's
stable-only `latest` alias.

Linux or macOS:

```console
curl -fsSL https://github.com/storious/agulater/releases/download/v0.2.1-rc.1/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://github.com/storious/agulater/releases/download/v0.2.1-rc.1/install.ps1 | iex
```

These recommended install commands do not need Bun, Node.js, or npm.

The installer selects the current platform, installs `agulater` in a user bin
directory, and runs `agulater setup user --if-missing`. Windows updates the
user `PATH`; Linux and macOS print one short hint only when `~/.local/bin` is
not already present. Setup preserves an existing `~/.agents` package; for a
new user it creates the general package and registers the AgentKube Catalog
without downloading extensions.

Release pages also provide archives for Windows x64, Linux x64, macOS x64, and
macOS ARM64. Each archive includes the Apache-2.0 license and third-party
notices.

The URLs use the final repository name, `storious/agulater`.

## Try the current source

Contributors working from this checkout need Bun 1.4+:

```console
bun install --frozen-lockfile --ignore-scripts
bun tools/agulater.ts --help
bun test
```

This is a source-development path, not the normal installation path.

The npm package remains an optional compatibility distribution for users who
already use Bun:

```console
bun add --global --trust agulater
```

Use `agulater@next` only for an explicitly published prerelease.

## Common tasks

Install or update a managed Agul runtime:

```console
agulater runtime install --channel next
agulater runtime status
agulater runtime update --channel next
```

Find and install one extension:

```console
agulater catalog search web-search
agulater add agentkube:web-search --path . --type plugin
agulater prepare --path .
```

Update installed user extensions:

```console
agulater update --all --user
```

Agulater keeps the runtime, extensions, and source `.agents` package separate:

- `runtime` manages Agul binaries and launchers.
- `catalog`, `add`, and `update` manage extension sources.
- `prepare` validates and compiles a package into runtime state.
- It never starts a model session on Agul's behalf.

## Candidate artifacts

Maintainers build the standalone executable used by normal users with:

```console
bun run build:standalone
```

They can also inspect the optional npm package without publishing it:

```console
bun pm pack --dry-run --ignore-scripts
bun pm pack --destination ./dist --ignore-scripts
```

Install the resulting tgz only when testing the npm compatibility path:

```console
bun add --global --trust ./dist/agulater-<version>.tgz
```

Neither Bun nor this package test is required after installing a standalone
Agulater release.

## Documentation

- [Packages and preparation](docs/package-and-prepare.md)
- [Catalogs and extensions](docs/catalog.md)
- [Agul runtime lifecycle](docs/runtime.md)
- [Schemas](schemas/README.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)

Apache-2.0. See [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
