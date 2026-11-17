#!/bin/sh
# fusion-code installer — downloads the latest (or a pinned) release binary
# from GitHub Releases and installs it into a user-writable bin directory.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/dahai80/fusion-code/main/install.sh | sh
#   ./install.sh [version]        # e.g. ./install.sh v0.8.5
#
# Environment:
#   FUSION_CODE_INSTALL_DIR   target bin dir (default: ~/.local/bin)
#   FUSION_CODE_RELEASE_BASE  override base URL for testing / mirrors
#                             (default: github.com/<repo>/releases/download/<tag>)
#
# The script verifies the sha256 checksum against the release SHA256SUMS.txt
# before installing. Windows assets (.zip) are not handled here.
set -eu

REPO="dahai80/fusion-code"
INSTALL_DIR="${FUSION_CODE_INSTALL_DIR:-$HOME/.local/bin}"

log() {
    printf '%s\n' "fusion-code-install: $*"
}

die() {
    printf '%s\n' "fusion-code-install: error: $*" >&2
    exit 1
}

need() {
    command -v "$1" >/dev/null 2>&1 || die "$2"
}

need curl "curl is required to download the release"
need tar "tar is required to extract the release"
need uname "uname is required to detect the platform"

# ---------- platform ----------
os=$(uname -s)
arch=$(uname -m)
case "$os" in
    Darwin) os_asset="darwin" ;;
    Linux) os_asset="linux" ;;
    *)
        die "unsupported OS: $os (Windows users: download the *-windows-x64.zip asset manually)"
        ;;
esac
case "$arch" in
    arm64 | aarch64) arch_asset="arm64" ;;
    x86_64 | amd64) arch_asset="x64" ;;
    *)
        die "unsupported architecture: $arch"
        ;;
esac

# ---------- version ----------
if [ "$#" -ge 1 ]; then
    version="$1"
    case "$version" in
        v*) ;;
        *) version="v$version" ;;
    esac
else
    # Resolve the latest release tag via the /releases/latest redirect —
    # no token, no jq dependency. Fallback to the REST API (unauthenticated,
    # 60 req/h per IP) when the redirect target is unreachable.
    version=$(
        curl -fsSLI -o /dev/null -w '%{url_effective}' --max-time 20 \
            "https://github.com/$REPO/releases/latest" 2>/dev/null |
            sed 's|.*/tag/||'
    )
    if [ -z "$version" ]; then
        version=$(
            curl -fsSL --max-time 20 \
                "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null |
                grep -o '"tag_name": *"[^"]*"' | head -1 | sed 's/.*"tag_name": *"//;s/"//'
        )
    fi
    [ -n "$version" ] || die "could not resolve the latest release tag (github.com unreachable? pin a version: install.sh v0.8.5)"
    # Guard against a non-redirected url_effective (proxy interference):
    # the value must look like a release tag, e.g. v0.8.5.
    case "$version" in
        v[0-9]*) ;;
        *) version="" ;;
    esac
    [ -n "$version" ] || die "could not resolve the latest release tag (github.com unreachable? pin a version: install.sh v0.8.5)"
fi

version_num=${version#v}
asset="fusion-code-${version_num}-${os_asset}-${arch_asset}.tar.gz"
base_url="${FUSION_CODE_RELEASE_BASE:-https://github.com/$REPO/releases/download/${version}}"

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

# ---------- download ----------
log "downloading $asset"
# Resume loop: flaky networks/proxies truncate large transfers mid-stream;
# curl -C - resumes from the byte offset and the sha256 check below still
# guarantees integrity of the final assembled file.
part="$tmp_dir/$asset"
ok=""
for _ in 1 2 3 4 5 6 7 8; do
    if curl -fsSL -C - --connect-timeout 15 -o "$part" "$base_url/$asset"; then
        ok=1
        break
    fi
done
[ -n "$ok" ] || die "download failed after 8 attempts: $base_url/$asset (does the release exist? network reachable?)"
curl -fsSL --retry 3 --connect-timeout 15 -o "$tmp_dir/SHA256SUMS.txt" "$base_url/SHA256SUMS.txt" ||
    die "download failed: $base_url/SHA256SUMS.txt"

# ---------- verify ----------
expected=$(grep " $asset\$" "$tmp_dir/SHA256SUMS.txt" | awk '{print $1}')
[ -n "$expected" ] || die "no checksum found for $asset in SHA256SUMS.txt"
if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$tmp_dir/$asset" | awk '{print $1}')
else
    actual=$(shasum -a 256 "$tmp_dir/$asset" | awk '{print $1}')
fi
[ "$actual" = "$expected" ] ||
    die "checksum mismatch for $asset (expected $expected, got $actual)"
log "checksum ok"

# ---------- extract + install ----------
# package-release.sh ships the binary as fusion-code-<os>-<arch> at the
# archive root (plus FUSION.rules.example); install it as plain fusion-code.
tar -xzf "$tmp_dir/$asset" -C "$tmp_dir"
inner="fusion-code-${os_asset}-${arch_asset}"
[ -f "$tmp_dir/$inner" ] ||
    die "unexpected tarball layout: no $inner binary at archive root"
mkdir -p "$INSTALL_DIR"
mv "$tmp_dir/$inner" "$INSTALL_DIR/fusion-code"
chmod +x "$INSTALL_DIR/fusion-code"

# ---------- post-install ----------
case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *)
        log "note: $INSTALL_DIR is not on your PATH"
        log "add it, e.g.:  echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.zshrc"
        ;;
esac

"$INSTALL_DIR/fusion-code" --version &&
    log "installed $version to $INSTALL_DIR/fusion-code"
