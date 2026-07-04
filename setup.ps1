# Check for bun or npm
$runner = "npm"
if (Get-Command bun -ErrorAction SilentlyContinue) {
    $runner = "bun"
}

Write-Host "[kronos] Using $runner package manager..." -ForegroundColor Cyan

# Install dependencies
Write-Host "[kronos] Installing dependencies..." -ForegroundColor Gray
& $runner install

# Bootstrap database
Write-Host "[kronos] Syncing Prisma database..." -ForegroundColor Gray
& npx prisma db push --accept-data-loss

# Build stand-alone binary
Write-Host "[kronos] Compiling standalone CLI binary..." -ForegroundColor Gray
if ($runner -eq "bun") {
    & bun run build:bin:win
} else {
    Write-Host "[kronos] Standalone binary compilation requires Bun. Skipping binary compilation. Run with npm run kronos instead." -ForegroundColor Yellow
}

Write-Host "[kronos] Setup complete!" -ForegroundColor Green
