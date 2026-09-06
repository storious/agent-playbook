# Agul runtime lifecycle

Agulater installs and updates the small Agul runtime. It handles release
selection and user-level launchers; it does not run Agul or participate in the
model loop.

Install the standalone Agulater release before using these commands.

Linux or macOS:

```console
curl -fsSL https://github.com/storious/agulater/releases/download/v0.2.1-rc.2/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://github.com/storious/agulater/releases/download/v0.2.1-rc.2/install.ps1 | iex
```

This installed executable does not need Bun, Node.js, or npm. Tagged release
assets are available for users who prefer a manual download. The optional npm
package and `agulater@next` dist-tag remain available to Bun users, but are not
the normal installation route. The Agulater release selected here is
independent from the Agul runtime channel selected below. Standalone archives
retain both `LICENSE` and `THIRD_PARTY_NOTICES`.

## Install, inspect, update, and uninstall

```console
agulater runtime install --channel next
agulater runtime status
agulater runtime update
agulater runtime uninstall
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

The normal install persists the launcher directory in the user `PATH` and
updates the current Agulater process. Open a new terminal before invoking
`agul` by name from the shell. A custom `--prefix` does not change PATH unless
`--modify-path` is supplied; `--no-modify-path` disables the normal behavior.
Until a new shell is open, `runtime status --json` exposes the launcher as
`shim`, so it can be run directly.

`agulater runtime status` prints both the launcher path and the exact command
to run it immediately. After opening a new terminal, `agul --version` should
work directly.

`agulater runtime uninstall` removes all Agul versions managed at the selected
prefix and its launcher. It removes a PATH entry only when Agulater originally
added it; `--keep-path` retains that entry. It does not remove Agulater,
extensions, or user-authored `.agents` files.

Implementation note: `env-paths` and `shell-env` were considered for this
integration. They resolve conventional directories or read a shell environment,
but do not persist and reverse a user PATH entry. The small native implementation
therefore uses the Windows user environment API and marked shell-profile blocks
without adding a runtime dependency.

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

Run `agulater runtime --help` for the lifecycle overview or
`agulater runtime install --help` for exact options and examples. Extension
lifecycle commands are documented in [Catalogs and extensions](catalog.md).
