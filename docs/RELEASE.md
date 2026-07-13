# Release Pipeline

This repository publishes **standalone executables** to **GitHub Releases** for every
`v*` git tag. The pipeline is fully GitHub-native — no third-party hosting.

## Distribution Strategy

**Why GitHub Releases (not GitHub Packages)?**

| | GitHub Releases | GitHub Packages |
|---|---|---|
| **Download auth** | Public, unauthenticated URLs | Requires a PAT to download even public packages |
| **Per-file URLs** | `releases/download/v1.0.0/kronos-linux-amd64.tar.gz` | No per-asset concept — it's version-attached metadata |
| **"latest" redirect** | `releases/latest/download/install.sh` works out of the box | No equivalent |
| **Native binary hosting** | Designed for this (`gh release`, `upload-assets`) | Designed for package managers (npm, container, maven, nuget) |
| **Install script UX** | `curl …/install.sh \| bash` — one hop | Would need GitHub API + PAT to resolve + fetch |

GitHub Packages is a *package registry* — it expects consumers to use `npm install`,
`docker pull`, `mvn deploy`, etc. It has no concept of "download this one binary for
*this* platform." GitHub Releases is what tools like `ripgrep`, `starship`, `zoxide`,
`gh` itself use. The install scripts pair perfectly with it.

## How the Pipeline Works

1. A maintainer pushes a git tag matching `v*` (`v0.1.0`, `v1.0.0`, `v1.2.0-beta.1`).
2. The `.github/workflows/release.yml` workflow triggers.
3. A **build matrix** runs across five runners:
   - `ubuntu-latest` → Linux x86_64, Linux ARM64
   - `macos-13` → macOS Intel
   - `macos-latest` → macOS Apple Silicon
   - `windows-latest` → Windows x86_64
4. Each runner runs `bun build --compile --target=bun-<os>-<arch>` to produce a
   single-file executable. `better-sqlite3` is `--external` (lazy-loaded only when
   `--db-path` is passed).
5. Each binary is archived (`.tar.gz` on Unix, `.zip` on Windows) and an
   individual `.sha256` is computed.
6. The `release` job aggregates all artifacts, generates a combined `SHA256SUMS`,
   and creates the GitHub Release with `softprops/action-gh-release`.
7. Installers (`install.sh`, `install.ps1`) are uploaded as release assets so
   they're versioned alongside the binaries.

## Repository Settings

These settings must be configured for the workflow to succeed:

### Workflow permissions (Settings → Actions → General)

- **Workflow permissions:** `Read and write permissions`
- **Allow GitHub Actions to create and approve pull requests:** *(optional)*

This is required for `softprops/action-gh-release` to create releases and upload
assets using the default `GITHUB_TOKEN`. If you use a fine-grained PAT, add it
to `secrets.GITHUB_TOKEN` instead — but using the default `GITHUB_TOKEN` is
recommended (most secure, scoped to the repo).

### No additional secrets are needed.

The pipeline uses only `${{ secrets.GITHUB_TOKEN }}`, which GitHub provides
automatically for every workflow run.

### Tags

Tag releases with semantic versioning, **with a `v` prefix**:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Pre-release tags (`v1.0.0-beta.1`, `v1.0.0-rc.1`) are supported. GitHub marks
them as pre-releases automatically.

## Manual Trigger

You can trigger the workflow without pushing a tag for testing:

1. GitHub → Actions → Release → Run workflow
2. Choose `draft` = `true` for a draft release, `false` to publish immediately.

The manual trigger creates a release at the **current commit** (not a tag).

## Built-in Testing of the Pipeline

Before tagging a real release, you can:

```bash
# Build a binary for your current platform using the same script CI uses
./scripts/build-bin.sh

# Or build a specific target
./scripts/build-bin.sh darwin-arm64

# Or build every target
./scripts/build-bin.sh all
```

## Local Build Script

`scripts/build-bin.sh` mirrors the CI workflow logic so developers can
reproduce release binaries locally. Supported targets:

| Friendly name | Bun target |
|---|---|
| `linux-amd64` | `bun-linux-x64` |
| `linux-arm64` | `bun-linux-arm64` |
| `darwin-amd64` | `bun-darwin-x64` |
| `darwin-arm64` | `bun-darwin-arm64` |
| `windows-amd64` | `bun-windows-x64` |

Note: cross-compiling Windows→Mac/Linux, or Mac→Windows, may require host-side
tools. The CI matrix runs each platform's build on a matching runner, which
side-steps this issue entirely.

## Versioning

The CLI's `kronos --version` reads the version from `KRONOS_VERSION` at build time
via Bun's `--define` flag:

```bash
bun build --compile --target=bun-linux-x64 \
  --define 'process.env.KRONOS_VERSION="1.2.0"' \
  --external better-sqlite3 \
  ./cli/kronos.js --outfile kronos
```

The CI workflow sets this from the git tag (stripping the leading `v`), so the
binary reports `1.2.0` — clean semver.

## Release Asset Layout

A release produces these assets:

```
kronos-linux-amd64.tar.gz
kronos-linux-amd64.tar.gz.sha256
kronos-linux-arm64.tar.gz
kronos-linux-arm64.tar.gz.sha256
kronos-darwin-amd64.tar.gz
kronos-darwin-amd64.tar.gz.sha256
kronos-darwin-arm64.tar.gz
kronos-darwin-arm64.tar.gz.sha256
kronos-windows-amd64.zip
kronos-windows-amd64.zip.sha256
SHA256SUMS                       # combined checksums
install.sh                       # Unix installer
install.ps1                      # Windows installer
```

## Cutting a Release

```bash
# 1. Make sure main is clean and you're up to date
git checkout main
git pull

# 2. Bump version in package.json + cli constants if applicable
# Edit package.json: "version": "1.2.0"

# 3. Update CHANGELOG / release notes
# Edit docs/RELEASE.md or your changelog

# 4. Tag and push
git tag v1.2.0
git push origin main
git push origin v1.2.0

# 5. Watch the workflow
# Open https://github.com/Reqeique/Kronos/actions
```

The workflow produces the release automatically with auto-generated notes
(`generate_release_notes: true`).

## Troubleshooting

### "Resource not accessible by integration"

The `GITHUB_TOKEN` lacks permission to upload release assets. Fix:

- Settings → Actions → General → Workflow permissions → **Read and write permissions**

### "Release already exists for this tag"

This happens if a previous run partially completed. The workflow is idempotent:
re-running with `workflow_dispatch` will update the existing release.

### Cross-compile fails locally

Run `./scripts/build-bin.sh auto` (host-platform only) for a sanity check.
The CI pipeline handles each target on its own matching runner, so it
shouldn't have cross-compile issues.
