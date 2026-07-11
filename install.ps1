<#
.SYNOPSIS
    Kronos CLI installer for Windows.
.DESCRIPTION
    Detects CPU architecture, downloads the correct prebuilt binary from the
    GitHub Releases "latest" endpoint, verifies the SHA256 checksum, installs
    to a standard location on PATH, and prints the installed version.
.EXAMPLE
    irm https://github.com/Reqeique/Kronos/releases/latest/download/install.ps1 | iex
.LINK
    https://github.com/Reqeique/Kronos
#>

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
$Repo       = "Reqeique/Kronos"
$BinName    = "kronos.exe"
$EnvVarName = "KRONOS_INSTALL_DIR"

# -( Helpers) -----------------------------------------------------------------

function Write-Info  { param([string]$Msg) Write-Host  "[info] $Msg" -ForegroundColor Cyan }
function Write-Ok    { param([string]$Msg) Write-Host  "[ok]   $Msg" -ForegroundColor Green }
function Write-Warn  { param([string]$Msg) Write-Host  "[warn] $Msg" -ForegroundColor Yellow }
function Write-Err   { param([string]$Msg) Write-Host  "[err]  $Msg" -ForegroundColor Red }
function Die         { param([string]$Msg); Write-Err $Msg; exit 1 }

# -----------------------------------------------------------------------------
# Step 1: Detect architecture
# -----------------------------------------------------------------------------
function Get-Arch {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture
    switch ($arch) {
        "X64"   { return "amd64" }
        "Arm64" { return "amd64" }   # Bun windows-arm64 target is not in the matrix; fall back to x64 via emulation
        default { Die "Unsupported architecture: $arch (only x64 is supported on Windows)" }
    }
}

# -----------------------------------------------------------------------------
# Step 2: Resolve version (latest or from env var)
# -----------------------------------------------------------------------------
function Get-Version {
    if ($env:KRONOS_VERSION) { return $env:KRONOS_VERSION }

    $apiUrl = "https://api.github.com/repos/$Repo/releases/latest"
    try {
        $resp = Invoke-RestMethod -Uri $apiUrl -Headers @{ "User-Agent" = "kronos-installer" } -ErrorAction Stop
        if (-not $resp.tag_name) { Die "Could not determine latest release tag." }
        return $resp.tag_name
    } catch {
        Die "Failed to query latest release: $_"
    }
}

# -----------------------------------------------------------------------------
# Step 3: Resolve install directory
# -----------------------------------------------------------------------------
function Get-InstallDir {
    # 1. Explicit env var
    if ($env:KRONOS_INSTALL_DIR) { return $env:KRONOS_INSTALL_DIR }

    # 2. PowerShell modules path (user-local, always on PATH)
    # \%LOCALAPPDATA%\kronos
    $userDir = Join-Path $env:LOCALAPPDATA "kronos"
    return $userDir
}

# -----------------------------------------------------------------------------
# Step 4: Download an archive
# -----------------------------------------------------------------------------
function Download-File {
    param([string]$Url, [string]$Dest)
    try {
        Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing -ErrorAction Stop
    } catch {
        Die "Download failed: $_"
    }
}

# -----------------------------------------------------------------------------
# Step 5: Verify checksum
# -----------------------------------------------------------------------------
function Verify-Checksum {
    param([string]$ArchivePath, [string]$ArchiveUrl)

    $checksumUrl = "$ArchiveUrl.sha256"

    try {
        Invoke-WebRequest -Uri $checksumUrl -OutFile "$ArchivePath.sha256" -UseBasicParsing -ErrorAction Stop
    } catch {
        Write-Warn "No checksum file found at $checksumUrl — skipping verification."
        return
    }

    # The .sha256 file is produced by Get-FileHash on the runner and contains
    # only the hex hash (no filename). On Unix runners, sha256sum produces
    # "<hash>  <filename>". Handle both formats.
    $raw = Get-Content "$ArchivePath.sha256" -Raw
    $expected = ($raw -split '\s+')[0].Trim()
    $actual = (Get-FileHash $ArchivePath -Algorithm SHA256).Hash.ToLower()

    if ($expected.ToLower() -ne $actual) {
        Die "Checksum mismatch! Expected: $expected  Got: $actual"
    }
    Write-Ok "Checksum verified."
}

# -----------------------------------------------------------------------------
# Step 6: Ensure install dir is on the user's PATH (persistent)
# -----------------------------------------------------------------------------
function Ensure-OnPath {
    param([string]$Dir)

    # Get the current User PATH (not System PATH — no admin needed)
    $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($userPath -split ';' -contains $Dir) { return }

    $newPath = if ($userPath) { "$userPath;$Dir" } else { $Dir }
    [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
    Write-Warn "Added $Dir to your user PATH. Restart your terminal for changes to take effect."
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
function Main {

    Write-Host ""
    Write-Host "=== Kronos CLI Installer (Windows) ===" -ForegroundColor White
    Write-Host ""

    # --- Detect platform ---------------------------------------------------------
    $arch = Get-Arch
    $target = "windows-$arch"
    Write-Info "Platform: windows/$arch  (target: $target)"

    # --- Resolve version ---------------------------------------------------------
    $version = Get-Version
    $versionNoV = $version -replace '^v', ''
    Write-Info "Version:  $version"

    # --- Build URLs --------------------------------------------------------------
    $archiveName = "kronos-${target}.zip"
    $baseUrl     = "https://github.com/$Repo/releases/download/$version"
    $archiveUrl  = "$baseUrl/$archiveName"
    Write-Info "Archive:  $archiveName"
    Write-Info "URL:      $archiveUrl"

    # --- Prepare temp directory --------------------------------------------------
    $tmpdir = Join-Path $env:TEMP "kronos-install-$(Get-Random)"
    New-Item -ItemType Directory -Path $tmpdir -Force | Out-Null

    try {
        # --- Download ------------------------------------------------------------
        Write-Info "Downloading..."
        $archivePath = Join-Path $tmpdir $archiveName
        Download-File -Url $archiveUrl -Dest $archivePath

        # --- Verify --------------------------------------------------------------
        Verify-Checksum -ArchivePath $archivePath -ArchiveUrl $archiveUrl

        # --- Extract -------------------------------------------------------------
        Write-Info "Extracting..."
        Expand-Archive -Path $archivePath -DestinationPath $tmpdir -Force

        # The archive contains a single binary: kronos-windows-amd64.exe
        $extractedBin = Join-Path $tmpdir "kronos-${target}"
        if (-not (Test-Path $extractedBin)) {
            # Try without -amd64 suffix in case naming changes
            $extractedBin = Get-ChildItem -Path $tmpdir -Filter "$BinName" -Recurse | Select-Object -First 1
            if (-not $extractedBin) { Die "Expected binary not found in archive." }
        }

        # --- Resolve install directory -------------------------------------------
        $installDir = Get-InstallDir
        if (-not (Test-Path $installDir)) {
            Write-Info "Creating $installDir"
            New-Item -ItemType Directory -Path $installDir -Force | Out-Null
        }

        # --- Install -------------------------------------------------------------
        $dest = Join-Path $installDir $BinName
        Write-Info "Installing to $dest"
        Copy-Item -Path $extractedBin.FullName -Destination $dest -Force

        # --- Ensure on PATH ------------------------------------------------------
        Ensure-OnPath -Dir $installDir

        # --- Print version -------------------------------------------------------
        Write-Host ""
        & $dest --version 2>$null
        Write-Host ""

        Write-Ok "Kronos $versionNoV installed successfully!" -ForegroundColor Green
        Write-Host "Run " -NoNewline
        Write-Host "kronos --help" -NoNewline -ForegroundColor White
        Write-Host " to get started."
        Write-Host ""

    } finally {
        # Cleanup
        if (Test-Path $tmpdir) { Remove-Item -Recurse -Force $tmpdir -ErrorAction SilentlyContinue }
    }
}

Main
