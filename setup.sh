#!/bin/bash
set -e

# Detect package runner
if command -v bun &> /dev/null; then
    RUNNER="bun"
else
    RUNNER="npm"
fi

echo -e "\033[36m[kronos] Using $RUNNER package manager...\033[0m"

# Install dependencies
echo "[kronos] Installing dependencies..."
$RUNNER install

# Bootstrap database
echo "[kronos] Syncing Prisma database..."
npx prisma db push --accept-data-loss

# Compile stand-alone binary
echo "[kronos] Compiling standalone CLI binary..."
if [ "$RUNNER" = "bun" ]; then
    # Detect OS to target compilation
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # MacOS
        if [[ "$(uname -m)" == "arm64" ]]; then
            bun run build:bin:macos:arm64
        else
            bun run build:bin:macos:x64
        fi
    else
        # Linux
        bun run build:bin:linux:x64
    fi
else
    echo -e "\033[33m[kronos] Standalone binary compilation requires Bun. Skipping binary compilation. Run with npm run kronos instead.\033[0m"
fi

echo -e "\033[32m[kronos] Setup complete!\033[0m"
