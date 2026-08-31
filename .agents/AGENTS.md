# Agulater

Maintain the small lifecycle and preparation CLI. Keep package creation,
Catalog discovery, extension install/update, runtime install/update, and
preparation direct and useful. Agulater must not run models or coordinate
sessions. Prefer a product test over a new framework layer.

Follow `CONTRIBUTING.md` for the branch and release flow before starting
repository work.

Before writing or materially expanding generic infrastructure, evaluate mature
TypeScript/Bun libraries first. For argument parsing, schema validation,
SemVer/range handling, downloads, archives, and atomic filesystem operations
likely to exceed roughly 100 lines, record the candidates and the reason for
adopting or rejecting them. Keep Agulater's package and preparation semantics
in-house; use libraries for the solved infrastructure beneath them.
