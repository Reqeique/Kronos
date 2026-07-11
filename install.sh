#!/usr/bin/env bash
# =============================================================================
# install.sh — Kronos CLI installer for macOS / Linux
# -----------------------------------------------------------------------------
# Detects OS + architecture, downloads the correct prebuilt binary from the
# GitHub Releases "latest" endpoint, verifies the SHA256 checksum, installs
# to a standard PATH location, marks it executable, and prints the version.
#
# Usage:
#   curl -fsSL https://github.com/Reqeique/Kronos/releases/latest/download/install.sh | bash
#
# Environment variables (optional):
#   KRONOS_INSTALL_DIR  — override install directory (default: auto-detected)
#   KRONOS_VERSION      — specific version tag to install (default: latest)
#   KRONOS_BIN_NAME     — override binary name (default: kronos)
# =============================================================================
set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
REPO="Reqeique/Kronos"
BIN_NAME="${KRONOS_BIN_NAME:-kronos}"
VERSION="${KRONOS_VERSION:-}"

# Colors (disabled when not a TTY so piped output stays clean)
if [ -t 1 ]; then
  BOLD='\033[1m'
  GREEN='\033[32m'
  RED='\033[31m'
  YELLOW='\033[33m'
  CYAN='\033[36m'
  RESET='\033[0m'
else
  BOLD='' GREEN='' RED='' YELLOW='' CYAN='' RESET=''
fi

info()  { printf "${CYAN}[info]${RESET} %s\n"  "$*"; }
ok()    { printf "${GREEN}[ok]${RESET} %s\n"    "$*"; }
warn()  { printf "${YELLOW}[warn]${RESET} %s\n" "$*"; }
err()   { printf "${RED}[error]${RESET} %s\n"   "$*"; }
die()   { err "$*"; exit 1; }

# -----------------------------------------------------------------------------
# Step 1: Detect OS
# -----------------------------------------------------------------------------
detect_os() {
  local os
  os="$(uname -s)"
  case "$os" in
    Darwin) echo "darwin" ;;
    Linux)  echo "linux"  ;;
    *)      die "Unsupported OS: $os (only macOS and Linux are supported)" ;;
  esac
}

# -----------------------------------------------------------------------------
# Step 2: Detect CPU architecture
# -----------------------------------------------------------------------------
detect_arch() {
  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64|x64)   echo "amd64" ;;
    arm64|aarch64)      echo "arm64" ;;
    *)                  die "Unsupported architecture: $arch" ;;
  esac
}

# -----------------------------------------------------------------------------
# Step 3: Resolve the download URL
# -----------------------------------------------------------------------------
# GitHub redirects /latest to the most recent non-draft, non-prerelease release.
# We resolve the tag via the API so we can construct checksum URLs too.
resolve_version() {
  if [[ -n "$VERSION" ]]; then
    printf "%s" "$VERSION"
    return
  fi

  local tag
  tag="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep -m1 '"tag_name"' \
    | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"

  if [[ -z "$tag" ]]; then
    die "Could not determine latest release tag. Set KRONOS_VERSION manually."
  fi
  printf "%s" "$tag"
}

# -----------------------------------------------------------------------------
# Step 4: Determine install directory
# -----------------------------------------------------------------------------
# Prefer ~/.local/bin (no sudo needed, user-owned).
# Fall back to /usr/local/bin if it's writable or if sudo is available.
# Honor KRONOS_INSTALL_DIR if set.
resolve_install_dir() {
  if [[ -n "${KRONOS_INSTALL_DIR:-}" ]]; then
    printf "%s" "$KRONOS_INSTALL_DIR"
    return
  fi

  # Try ~/.local/bin first (appears on PATH in modern distros)
  local user_local="${HOME}/.local/bin"
  if [[ -d "$user_local" ]] || mkdir -p "$user_local" 2>/dev/null; then
    printf "%s" "$user_local"
    return
  fi

  # Fall back to /usr/local/bin (may need sudo)
  if [[ -w "/usr/local/bin" ]]; then
    printf "/usr/local/bin"
    return
  fi

  # Last resort: try with sudo
  if command -v sudo >/dev/null 2>&1; then
    printf "/usr/local/bin"
    return
  fi

  die "Could not find a writable install directory. Set KRONOS_INSTALL_DIR."
}

# -----------------------------------------------------------------------------
# Step 5: Download a URL with curl, following redirects
# -----------------------------------------------------------------------------
download() {
  local url="$1" dest="$2"
  curl -fSL --retry 3 --retry-delay 2 -o "$dest" "$url"
}

# -----------------------------------------------------------------------------
# Step 6: Verify checksum
# -----------------------------------------------------------------------------
# Downloads the per-archive .sha256 file (if present) and verifies.
# Falls back gracefully if no checksum file exists yet.
verify_checksum() {
  local archive="$1" archive_url="$2" checksum_url

  # The .sha256 file sits next to the archive in the release assets.
  checksum_url="${archive_url}.sha256"

  info "Downloading checksum: $checksum_url"
  if ! curl -fsSL -o /tmp/kronos-expected.sha256 "$checksum_url" 2>/dev/null; then
    warn "No checksum file found at $checksum_url — skipping verification."
    return 0
  fi

  # The .sha256 file format: produced by `sha256sum <archive>` on the runner,
  # so it contains the hash followed by the original filename. We only need
  # the hash (first whitespace-separated field).
  local expected_hash actual_hash
  expected_hash="$(awk '{print $1}' /tmp/kronos-expected.sha256 | tr -d '[:space:]')"
  actual_hash="$(sha256sum "$archive" | awk '{print $1}')"

  if [[ "$expected_hash" != "$actual_hash" ]]; then
    die "Checksum mismatch!\n  Expected: $expected_hash\n  Got:      $actual_hash"
  fi
  ok "Checksum verified."
}

# -----------------------------------------------------------------------------
# Step 7: Add install dir to PATH (for the current shell session)
# -----------------------------------------------------------------------------
ensure_on_path() {
  local install_dir="$1"
  case ":${PATH}:" in
    *":${install_dir}:"*) return 0 ;;
  esac

  # Print the export so the user sees it (useful when piping to bash)
  printf '%b\n' "" \
    "${YELLOW}[info] ${install_dir} is not on your PATH.${RESET}" \
    "${YELLOW}[info] Add this line to your shell profile (~/.bashrc, ~/.zshrc, etc.):${RESET}" \
    "    export PATH=\"\${PATH}:${install_dir}\"" ""
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
  printf "${BOLD}=== Kronos CLI Installer ===${RESET}\n\n"

  # --- Detect platform ---------------------------------------------------------
  local os arch target
  os="$(detect_os)"
  arch="$(detect_arch)"
  target="${os}-${arch}"

  # Validate the combination is one we build
  case "$target" in
    linux-amd64|linux-arm64|darwin-amd64|darwin-arm64) : ;;
    *) die "No prebuilt binary for ${target}" ;;
  esac

  info "Platform: ${os}/${arch}  (target: ${target})"

  # --- Resolve version ---------------------------------------------------------
  local version version_no_v
  version="$(resolve_version)"
  version_no_v="${version#v}"   # strip leading 'v'
  info "Version:  ${version}"

  # --- Build URLs --------------------------------------------------------------
  local base_url archive_name archive_url
  archive_name="kronos-${target}.tar.gz"
  base_url="https://github.com/${REPO}/releases/download/${version}"
  archive_url="${base_url}/${archive_name}"

  info "Archive:   ${archive_name}"
  info "URL:       ${archive_url}"

  # --- Prepare temp directory --------------------------------------------------
  local tmpdir
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT

  # --- Download ----------------------------------------------------------------
  info "Downloading..."
  download "$archive_url" "${tmpdir}/${archive_name}"

  # --- Verify ------------------------------------------------------------------
  verify_checksum "${tmpdir}/${archive_name}" "$archive_url"

  # --- Extract -----------------------------------------------------------------
  info "Extracting..."
  tar -xzf "${tmpdir}/${archive_name}" -C "$tmpdir"

  # The archive contains a single binary named `kronos-${target}` (no .exe on Unix).
  local extracted_bin
  extracted_bin="${tmpdir}/${BIN_NAME}-${target}"

  if [[ ! -f "$extracted_bin" ]]; then
    die "Expected binary not found in archive: ${BIN_NAME}-${target}"
  fi

  # --- Resolve install directory -----------------------------------------------
  local install_dir use_sudo="false"
  install_dir="$(resolve_install_dir)"

  # Check if we need sudo for the install directory
  if [[ "$install_dir" == "/usr/local/bin" && ! -w "/usr/local/bin" ]]; then
    use_sudo="true"
  fi

  # Create the directory if it doesn't exist
  if [[ ! -d "$install_dir" ]]; then
    info "Creating $install_dir"
    if [[ "$use_sudo" == "true" ]]; then
      sudo mkdir -p "$install_dir"
    else
      mkdir -p "$install_dir"
    fi
  fi

  # --- Install -----------------------------------------------------------------
  local dest="${install_dir}/${BIN_NAME}"
  info "Installing to ${dest}"

  if [[ "$use_sudo" == "true" ]]; then
    sudo install -m 0755 "$extracted_bin" "$dest"
  else
    install -m 0755 "$extracted_bin" "$dest"
  fi

  ok "Installed: ${dest}"

  # --- Make executable (belt-and-suspenders: install -m 0755 already does this) --
  chmod +x "$dest" 2>/dev/null || true

  # --- Print version -----------------------------------------------------------
  # Ensure the install dir is on PATH for the version check invocation.
  printf '\n'
  if PATH="${install_dir}:${PATH}" "$dest" --version 2>/dev/null || true; then
    :
  else
    # --version may not exist yet; try --help which is guaranteed
    PATH="${install_dir}:${PATH}" "$dest" --help 2>/dev/null | head -1 || true
  fi

  # --- PATH hint ---------------------------------------------------------------
  ensure_on_path "$install_dir"

  printf "\n${GREEN}${BOLD}Kronos ${version_no_v} installed successfully!${RESET}\n"
  printf "Run ${BOLD}kronos --help${RESET} to get started.\n\n"

  # Cleanup handled by trap
}

main "$@"
