# Agul runtime lifecycle

Agulater installs and updates the small Agul runtime. It handles release
selection and user-level launchers; it does not run Agul or participate in the
model loop.

Install the standalone Agulater release before using these commands.

Linux or macOS:

```console
curl -fsSL https://github.com/storious/agulater/releases/download/v0.2.1-rc.1/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://github.com/storious/agulater/releases/download/v0.2.1-rc.1/install.ps1 | iex
```

This installed executable does not need Bun, Node.js, or npm. Tagged release
assets are available for users who prefer a manual download. The optional npm
package and `agulater@next` dist-tag remain available to Bun users, but are not
the normal installation route. The Agulater release selected here is
independent from the Agul runtime channel selected below. Standalone archives
retain both `LICENSE` and `THIRD_PARTY_NOTICES`.

## Install, inspect, and update

```console
agulater runtime install --channel next
agulater runtime status
agulater runtime update
```

`stable` selects the latest non-prerelease release. `next` selects the latest
prerelease and must be requested explicitly on first install:

```console
agulater runtime install --channel next
```

An update keeps the installed channel unless `--channel` selects another one.
Agulater refuses to downgrade within the same channel.

Use `next` for a release candidate only when its Agul GitHub Release has been
published. Before publication, maintainers test the same lifecycle with a local
`agulater/runtime-releases/v1` index and candidate archive through `--url`.

## Layout

Each version lives under a user directory. Agulater switches a small launcher
only after the downloaded binary reports the expected version.

- Unix versions live under `~/.local/share/agul`; the launcher is
  `~/.local/bin/agul`.
- Windows versions and the `agul.cmd` launcher live under
  `%LOCALAPPDATA%\Programs\Agul`.
- A custom `--prefix` keeps both `versions/` and `bin/` below that prefix.

The running Windows executable is never overwritten; the next invocation
follows the updated launcher.

The install command prints the launcher path. When its directory is not on
`PATH`, Agulater also prints the exact directory to add. Open a new terminal
after changing the user `PATH`. Until then, `runtime status --json` exposes the
launcher as `shim`, so it can be run directly.

`agulater runtime status` prints both the launcher path and the exact command
to run it immediately. After opening a new terminal, `agul --version` should
work directly.

## Release sources

The default release repository is `storious/agul`. Private releases prefer an
authenticated `gh`; public releases fall back to GitHub HTTPS.
`--repository owner/name` selects another GitHub repository. `--url` accepts an
`agulater/runtime-releases/v1` index, including a local test or private
distribution.

Supported assets are Windows x64, Linux x64, macOS x64, and macOS ARM64. No
Agul version is compiled into Agulater.

```console
agulater runtime install --repository owner/name --channel stable
agulater runtime install --url ./releases.json --channel next
agulater runtime status --json
```

Run `agulater runtime --help` for the complete command surface. Extension
lifecycle commands are documented in [Catalogs and extensions](catalog.md).
