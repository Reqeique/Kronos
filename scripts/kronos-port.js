#!/usr/bin/env node
"use strict";

// Cross-platform shim for `npm run dev` / `npm run start`:
// picks the port before invoking next, so we don't have to rely on
// shell-only `${VAR:-default}` expansion.
const port = `${process.env.KRONOS_PORT || ""}`.trim() || "3737";
const mode = `${process.argv[2] || "dev"}`.trim();
if (mode !== "dev" && mode !== "start") {
    console.error(`scripts/kronos-port.js: expected "dev" or "start", got "${mode}"`);
    process.exit(1);
}

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const dbPath = path.join(__dirname, "..", "prisma", "dev.db");
const dbExists = fs.existsSync(dbPath);
const dbIsEmpty = dbExists && fs.statSync(dbPath).size === 0;

if (!dbExists || dbIsEmpty) {
    console.log("[kronos] SQLite database not found. Bootstrapping prisma/dev.db...");
    const gen = spawnSync("npx", ["prisma", "generate"], { stdio: "inherit" });
    if (gen.status !== 0) {
        console.error("[kronos] prisma generate failed.");
        process.exit(1);
    }
    const result = spawnSync("npx", ["prisma", "db", "push", "--accept-data-loss"], {
        stdio: "inherit",
    });
    if (result.status !== 0) {
        console.error("[kronos] Prisma database bootstrap failed.");
    } else {
        console.log("[kronos] Database bootstrap completed successfully.");
    }
}

let nextBin;
try {
    nextBin = require.resolve("next/dist/bin/next");
} catch (error) {
    console.error(`scripts/kronos-port.js: cannot resolve 'next'. Run \`npm install\` first.`);
    process.exit(1);
}

const child = spawn(process.execPath, [nextBin, mode, "-p", port], {
    stdio: "inherit",
    env: { ...process.env, PORT: port },
});

process.on("SIGINT", () => {
    try { child.kill("SIGINT"); } catch { /* ignore */ }
});
process.on("SIGTERM", () => {
    try { child.kill("SIGTERM"); } catch { /* ignore */ }
});

child.on("exit", (code, signal) => {
    if (signal === "SIGINT" || signal === "SIGTERM") process.exit(0);
    process.exit(typeof code === "number" ? code : 0);
});
