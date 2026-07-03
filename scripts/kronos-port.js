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

const path = require("node:path");
const { spawn } = require("node:child_process");

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
