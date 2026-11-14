#!/usr/bin/env bash
# Release packaging automation for fusion-code.
#
# Builds the compiled binary for every release target (Bun cross-compiles
# all of them from the host), packages each with the reference config
# template, smoke-tests the binaries runnable on the current host, and
# writes SHA256SUMS. Used locally and by .github/workflows/release-binaries.yml.
#
# Usage: scripts/package-release.sh [output-dir]
# Env:   FUSION_CODE_TARGETS (space-separated bun targets; default below)
#
# Archive layout (per target):
#   fusion-code[-<target>]          the compiled binary
#   FUSION.rules.example            reference rule-file template (no secrets;
#                                   users copy it to ~/.fusion-code/FUSION.rules)
#
# Smoke tests: every target binary is executed on its native host when the
# script runs there (darwin targets on macOS, linux targets on Linux).
# Windows binaries are cross-built and SHA-verified only — CI has no Windows
# runner in this single-job layout, so exercise the .exe on a Windows box
# after download (run: fusion-code-windows-x64.exe --version).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$REPO_ROOT/dist/release}"
TARGETS="${FUSION_CODE_TARGETS:-bun-darwin-arm64 bun-darwin-x64 bun-linux-x64 bun-linux-arm64 bun-windows-x64}"

cd "$REPO_ROOT"

VERSION=$(sed -n 's/[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -1)
if [ -z "$VERSION" ]; then
    echo "error: could not read version from package.json" >&2
    exit 1
fi
echo "==> packaging fusion-code v$VERSION"

CONFIG_FILE="$REPO_ROOT/FUSION.rules.example"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "error: reference config missing: $CONFIG_FILE" >&2
    exit 1
fi

# Guard: no packaged file may carry secrets. The reference config is the only
# non-binary archive member; scan it before it can enter any archive.
if grep -Ein '(sk-[a-zA-Z0-9]{8,}|api[_-]?key[[:space:]]*[:=][[:space:]]*[^< ]|BEGIN [A-Z ]*PRIVATE KEY|ghp_[a-zA-Z0-9]{20,}|xox[bap]-)' "$CONFIG_FILE"; then
    echo "error: potential secret detected in $CONFIG_FILE — refusing to package" >&2
    exit 1
fi

mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
rm -f "$OUT_DIR"/fusion-code-* "$OUT_DIR/SHA256SUMS.txt"

for target in $TARGETS; do
    echo "==> build $target"
    bun run ./scripts/build.ts --compile --target="$target"
done

HOST_UNAME="$(uname -s)"
for target in $TARGETS; do
    # Windows target is packaged separately below: bun names its binary
    # fusion-code-windows-x64.exe (and it ships as a zip, not a tarball).
    case "$target" in bun-windows-*) continue ;; esac
    # build.ts strips the "bun-" prefix for the outfile suffix:
    # bun-darwin-arm64 -> dist/fusion-code-darwin-arm64
    binary="dist/fusion-code-${target#bun-}"
    [ -f "$binary" ] || { echo "error: binary missing: $binary" >&2; exit 1; }

    # Smoke test on the native host: darwin targets run on macOS, linux
    # targets on Linux. The bare binary must print a version string.
    case "$target" in
        bun-darwin-*) [ "$HOST_UNAME" = "Darwin" ] && "$binary" --version >/dev/null ;;
        bun-linux-*) [ "$HOST_UNAME" = "Linux" ] && "$binary" --version >/dev/null ;;
    esac

    # User-facing names drop the "bun-" prefix, matching the dist/ binary:
    # bun-darwin-arm64 -> fusion-code-darwin-arm64
    name="fusion-code-${target#bun-}"
    archive="$OUT_DIR/fusion-code-$VERSION-${target#bun-}.tar.gz"
    echo "==> package $archive"
    stage="$(mktemp -d)"
    cp "$binary" "$stage/$name"
    cp "$CONFIG_FILE" "$stage/FUSION.rules.example"
    tar -czf "$archive" -C "$stage" "$name" FUSION.rules.example
    rm -rf "$stage"
done

# Windows keeps the .exe extension and ships as a zip (Windows Explorer
# handles zip natively).

# Windows keeps the .exe extension and ships as a zip (Windows Explorer
# handles zip natively).
if [ -f dist/fusion-code-windows-x64.exe ]; then
    archive="$OUT_DIR/fusion-code-$VERSION-windows-x64.zip"
    echo "==> package $archive"
    stage="$(mktemp -d)"
    cp dist/fusion-code-windows-x64.exe "$stage/"
    cp "$CONFIG_FILE" "$stage/FUSION.rules.example"
    (cd "$stage" && zip -q "$archive" fusion-code-windows-x64.exe FUSION.rules.example)
    rm -rf "$stage"
else
    echo "error: windows binary missing: dist/fusion-code-windows-x64.exe" >&2
    exit 1
fi

cd "$OUT_DIR"
shasum -a 256 fusion-code-*.tar.gz fusion-code-*.zip > SHA256SUMS.txt 2>/dev/null ||
    sha256sum fusion-code-*.tar.gz fusion-code-*.zip > SHA256SUMS.txt
echo "==> SHA256SUMS.txt"
cat SHA256SUMS.txt
echo "==> done: $OUT_DIR"
