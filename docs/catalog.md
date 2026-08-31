# Catalogs and extensions

Agulater owns the strict `agulater/catalog/v1` discovery contract and all
installation state. AgentKube is the default content Catalog, not another CLI,
runtime, or downloader. Registration and download remain separate.

## Discover and install

```console
agulater catalog list
agulater catalog search web
agulater add agentkube:web-search --user
```

The first search refreshes a registered Catalog when its cache is missing.
Private AgentKube sources use the authenticated GitHub CLI when available;
public HTTPS and local file paths use the same commands. A custom source can
replace or remove the default registration without editing JSON:

```console
agulater catalog add agentkube ./catalog/catalog.json
agulater catalog refresh agentkube
agulater catalog remove agentkube
```

Stable Catalog versions must point to an immutable Git ref. The ref may use the
publisher's tag naming scheme; moving names such as `main` are accepted only
for prerelease development entries.

`add --json` returns the installed path and, for a Skill, its `SKILL.md` path.
Agul can therefore read a newly installed Skill in the same task while keeping
its base prompt and Provider prefix small.

## Update

Catalog updates stay within the current SemVer-compatible line. `update --all`
replays Catalog and Git sources; a local path is recopied only by
`update <id>`. A successful update prepares once after all selected copies
finish.

```console
agulater update <id> --user
agulater update --all --user
```

## Managed Store and sync

`sync` installs Catalog or direct Git dependencies by exact version:

```console
agulater sync --catalog ./catalog/catalog.json
```

The managed Store layout is
`~/.agents/store/<package|skill|plugin>/<id>/<version>/`. Downloads are copied
to a staging directory, validated, and moved into place. Each installed version
records its source in `.agulater/source.json`. A failed sync leaves the previous
prepared Runtime Snapshot active.

`add` also accepts a local directory or Git URL. It installs the selected
extension as an explicit resource, records the source in
`.agents/.agulater/sources.json`, and prepares the package. When discovery
reaches a v2 Package, `--type` and `--name` can select that Package or one of
the Skill, Plugin, and child Package resources declared directly in its
manifest. Other contents beneath that Package are not scanned.

Use `agulater catalog --help` for the Catalog overview or
`agulater catalog search --help` for exact options and examples. Run
`agulater --help` for the first-run path and full command map. See
[Packages and preparation](package-and-prepare.md) for the compiled result.
