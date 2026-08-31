#!/bin/sh

set -eu

version="${AGULATER_VERSION:-{{VERSION}}}"
install_dir="${AGULATER_INSTALL_DIR:-${HOME:-}/.local/bin}"
setup_home="${AGULATER_HOME:-}"
dry_run=false

while [ "$#" -gt 0 ]; do
    case "$1" in
        --version) version="$2"; shift 2 ;;
        --install-dir) install_dir="$2"; shift 2 ;;
        --home) setup_home="$2"; shift 2 ;;
        --dry-run) dry_run=true; shift ;;
        -h|--help)
            echo "Usage: install.sh [--version VERSION] [--install-dir DIRECTORY] [--home DIRECTORY] [--dry-run]"
            exit 0
            ;;
        *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
done

case "$version" in
    *'{{'*'}}'*)
        echo "this checkout installer has no embedded release; pass --version or set AGULATER_VERSION" >&2
        exit 2
        ;;
esac
version=${version#v}
[ -n "$install_dir" ] || {
    echo "HOME is unavailable; pass --install-dir" >&2
    exit 2
}

case "$(uname -s)/$(uname -m)" in
    Linux/x86_64|Linux/amd64) platform=linux-x64 ;;
    Darwin/x86_64|Darwin/amd64) platform=macos-x64 ;;
    Darwin/arm64|Darwin/aarch64) platform=macos-arm64 ;;
    *) echo "unsupported platform: $(uname -s)/$(uname -m)" >&2; exit 2 ;;
esac

archive="agulater-v${version}-${platform}.tar.gz"
url="https://github.com/storious/agulater/releases/download/v${version}/${archive}"
destination="${install_dir}/agulater"
use_github_cli=false
if [ "$dry_run" = false ] && command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    use_github_cli=true
fi

echo "Agulater ${version} -> ${destination}"
if [ "$dry_run" = true ]; then
    if [ "$use_github_cli" = true ]; then
        echo "gh release download v${version} --repo storious/agulater --pattern ${archive}"
    else
        echo "$url"
    fi
    echo "Setup: agulater setup user --if-missing"
    exit 0
fi

command -v tar >/dev/null || { echo "tar is required" >&2; exit 2; }

temporary=$(mktemp -d "${TMPDIR:-/tmp}/agulater-install.XXXXXX")
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
if [ "$use_github_cli" = true ]; then
    gh release download "v${version}" \
        --repo storious/agulater \
        --pattern "$archive" \
        --dir "$temporary"
else
    command -v curl >/dev/null || { echo "curl is required" >&2; exit 2; }
    curl -fL "$url" -o "$temporary/$archive"
fi
tar -xzf "$temporary/$archive" -C "$temporary"
mkdir -p "$install_dir"
bundle="$temporary/agulater-v${version}-${platform}"
cp "$bundle/agulater" "$destination"
chmod +x "$destination"

if [ -n "$setup_home" ]; then
    "$destination" setup user --if-missing --home "$setup_home"
else
    "$destination" setup user --if-missing
fi
echo "Installed ${destination}"
case ":${PATH:-}:" in
    *:"$install_dir":*) ;;
    *) echo "Add ${install_dir} to PATH to run agulater from a new shell." ;;
esac
