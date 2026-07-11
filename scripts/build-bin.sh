#!/usr/bin/env bash
# =============================================================================
# scripts/build-bin.sh
# -----------------------------------------------------------------------------
# Cross-platform build helper for the Kronos CLI binary.
# Uses Bun --compile to produce a single-file executable embedding the Bun
# runtime. better-sqlite3 is kept external (lazy-loaded only with --db-path).
#
# Usage:
#   ./scripts/build-bin.sh                  # auto-detect host platform
#   ./scripts/build-bin.sh linux-amd64      # cross-compile a specific target
#   ./scripts/build-bin.sh all              # build every supported target
#
# Supported targets:
#   linux-amd64  linux-arm64  darwin-amd64  darwin-arm64  windows-amd64
#
# This script mirrors the CI workflow logic so developers can reproduce
# release binaries locally.
# =============================================================================
set -euo pipefail

set -e

CLI_ENTRY="./cli/kronos.js"
EXTERNAL="--external better-sqlite3"

# Map: friendly target -> bun --compile target string
declare -A TARGETS=(
  ["linux-amd64"]="bun-linux-x64"
  ["linux-arm64"]="bun-linux-arm64"
  ["darwin-amd64"]="bun-darwin-x64"
  ["darwin-arm64"]="bun-darwin-arm64"
  ["windows-amd64"]="bun-windows-x64"
)

# Map: friendly target -> output filename
declare -A OUTFILES=(
  ["linux-amd64"]="kronos-linux-amd64"
  ["linux-arm64"]="kronos-linux-arm64"
  ["darwin-amd64"]="kronos-darwin-amd64"
  ["darwin-arm64"]="kronos-darwin-arm64"
  ["windows-amd64"]="kronos-windows-amd64.exe"
)

# Resolve version: KRONOS_VERSION env var > package.json > "0.0.0-dev"
resolve_version() {
  if [[ -n "${KRONOS_VERSION:-}" ]]; then
    echo "${KRONOS_VERSION#v}"
    return
  fi
  if command -v node >/dev/null 2>&1 && [[ -f package.json ]]; then
    node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0-dev"
  else
    echo "0.0.0-dev"
  fi
}

detect_host_target() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Linux)
      [[ "$arch" == "aarch64" || "$arch" == "arm64" ]] && echo "linux-arm64" || echo "linux-amd64"
      ;;
    Darwin)
      [[ "$arch" == "arm64" ]] && echo "darwin-arm64" || echo "darwin-amd64"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      echo "windows-amd64"
      ;;
    *)
      echo "ERROR: Unsupported OS: $os" >&2
      exit 1
      ;;
  esac
}

build_one() {
  local target="$1"
  local bun_target="${TARGETS[$target]:-}"
  local outfile="${OUTFILES[$target]:-}"

  if [[ -z "$bun_target" ]]; then
    echo "ERROR: Unknown target '$target'" >&2
    echo "Supported: ${!TARGETS[*]}" >&2
    exit 1
  fi

  echo ">>> Building $target ($bun_target) -> $outfile"
  local version
  version="$(resolve_version)"
  # --define wires the version into the binary as a compile-time constant.
  KRONOS_VERSION="$version" bun build --compile --target="$bun_target" $EXTERNAL \
    --define "process.env.KRONOS_VERSION=\"${version}\"" \
    "$CLI_ENTRY" --outfile "$outfile"
  echo "    Done: $(ls -lh "$outfile" 2>/dev/null | awk '{print $5}')"
}

main() {
  # Ensure bun is available
  if ! command -v bun >/dev/null 2>&1; then
    echo "ERROR: bun is not installed. Install from https://bun.sh" >&2
    exit 1
  fi

  # Ensure deps are installed
  if [[ ! -d node_modules ]]; then
    echo ">>> Installing dependencies (bun install)..."
    bun install
  fi

  local target="${1:-auto}"

  if [[ "$target" == "all" ]]; then
    for t in "${!TARGETS[@]}"; do build_one "$t"; done
  elif [[ "$target" == "auto" ]]; then
    build_one "$(detect_host_target)"
  else
    build_one "$target"
  fi

  echo ">>> Build complete."
}

main "$@"
