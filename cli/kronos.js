#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn, spawnSync } = require("node:child_process");
const { Readable, Writable } = require("node:stream");
const { setTimeout: sleep } = require("node:timers/promises");

// Port preference: 3737 is the Kronos-themed default and avoids the popular
// 3000 port (which collides with React/Next/Rails dev servers). Keep these
// three constants together so discovery, fallback, and the CLI/server agree.
const DEFAULT_PORT = 3737;
const FALLBACK_PORTS = [3737, 7766, 8789];

function defaultServer() {
    const envPort = `${process.env.KRONOS_PORT || ""}`.trim();
    const envBase = `${process.env.KRONOS_API_BASE_URL || ""}`.trim();
    if (envBase) return envBase;
    if (envPort && /^\d+$/.test(envPort)) return `http://localhost:${envPort}`;
    return `http://localhost:${DEFAULT_PORT}`;
}

const DEFAULT_SERVER = defaultServer();
const CONFIG_DIR = path.join(os.homedir(), ".kronos");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
// Version: injected at build time via KRONOS_VERSION env var (CI workflow).
// Falls back to reading package.json when running via node in dev.
// The leading "v" is stripped so `kronos --version` reports clean semver.
const VERSION = (() => {
    const envVersion = (process.env.KRONOS_VERSION || "").trim().replace(/^v/, "");
    if (envVersion) return envVersion;
    try {
        const pkgPath = path.join(__dirname, "..", "package.json");
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
            if (pkg.version) return pkg.version;
        }
    } catch { /* ignore – likely compiled binary with no package.json */ }
    return "0.0.0-unknown";
})();

const DEFAULTS = {
    server: DEFAULT_SERVER,
    port: DEFAULT_PORT,
    agent: process.env.KRONOS_ACP_AGENT_CMD || "opencode acp",
    alias: process.env.KRONOS_BRIDGE_ALIAS || "",
};

function printHelp() {
    console.log(`kronos CLI (v${VERSION})

Usage:
  kronos                                  shows this help
  kronos --version                        print version and exit
  kronos up [--server <url>] [--alias <a>] [--dev]   boot dev/start server + run agent
  kronos serve [--server <url>] [--dev]    boot dev/start server and block
  kronos down                             stop a dev server spawned by this CLI
  kronos setup                            launches the interactive TUI wizard
  kronos login --token <token> [--server <url>]
  kronos proxy --agent <"command"> --alias <alias> [--token <token>] [--server <url>] [--dev]
  kronos watch-stdio --alias <alias> [--token <token>] [--server <url>] [--drive-acp] [--agent <"command">] [--cwd <path>] [--dev]
  kronos agent --alias <alias> [--token <token>] [--server <url>] [--agent <"command">] [--queue-transport <streamable-http|polling>] [--poll-ms <n>] [--no-mention-preprocess] [--cwd <path>] [--dev]
  kronos

Notes:
  - The Next.js dev server is auto-bootstrapped by any server-touching command
    (setup / agent / watch-stdio / proxy / up / serve) if it is not already
    reachable. CLI auto-detects the kronos checkout via cwd, KRONOS_INSTALL_DIR,
    or the binary's own folder.
  - Bootstrap runner: \`bun\` (preferred) when present, otherwise \`npm\`.
  - Bootstrap mode: \`prod\` (default; auto-builds if .next/ missing, then runs
    \`start\`) or \`dev\` (pass --dev to use \`next dev\`).
  - setup          launches the interactive TUI wizard (token/server/alias/agent)
  - login          stores token/server in ~/.kronos/config.json
  - proxy          spawns an agent as a subprocess and taps its stdio layer transparently
  - watch-stdio    reads ACP NDJSON events from stdin and forwards to /api/acp/events
  - watch-stdio --drive-acp runs an ACP client loop against --agent and forwards lifecycle events
  - agent          persistent task consumer (alias for watch-queue --drive-acp --continuous)
  - token can be provided by --token or saved via login
  - The --cwd option (or --work-dir) changes the directory used for mention resolution and agent execution (defaults to process.cwd())
  - Pass --no-server to any server-touching command to skip auto-bootstrap.
`);
}

function parseArgs(args) {
    const out = { _: [] };
    for (let i = 0; i < args.length; i += 1) {
        const token = args[i];
        if (token.startsWith("--")) {
            const [keyRaw, inlineValue] = token.slice(2).split("=", 2);
            if (inlineValue !== undefined) {
                out[keyRaw] = inlineValue;
                continue;
            }
            const next = args[i + 1];
            if (!next || next.startsWith("--")) {
                out[keyRaw] = true;
            } else {
                out[keyRaw] = next;
                i += 1;
            }
        } else {
            out._.push(token);
        }
    }
    return out;
}

function resolveServerMode(args, rawArgs) {
    const findFlag = (flag) => Array.isArray(rawArgs) && rawArgs.indexOf(flag) !== -1;
    if (findFlag("--dev")) return "dev";
    if (findFlag("--prod")) return "prod";
    if (Array.isArray(rawArgs)) {
        const modeIdx = rawArgs.indexOf("--mode");
        if (modeIdx !== -1 && rawArgs[modeIdx + 1]) {
            const v = `${rawArgs[modeIdx + 1]}`.toLowerCase();
            if (v === "dev" || v === "development") return "dev";
            if (v === "prod" || v === "production") return "prod";
        }
    }
    const modeFlag = typeof args?.mode === "string" ? args.mode.toLowerCase() : "";
    if (modeFlag === "dev" || modeFlag === "development") return "dev";
    if (modeFlag === "prod" || modeFlag === "production") return "prod";
    return "prod";
}

function resolveServer(args, positional, fallback) {
    if (typeof args.server === "string") return normalizeServer(args.server);
    if (typeof positional === "string" && positional) return normalizeServer(positional);
    const portRaw = typeof args.port === "string" || typeof args.port === "number"
        ? `${args.port}`.trim()
        : "";
    if (portRaw && /^\d{2,5}$/.test(portRaw)) return `http://localhost:${portRaw}`;
    return normalizeServer(fallback || DEFAULTS.server);
}

function readConfig() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) return {};
        const raw = fs.readFileSync(CONFIG_FILE, "utf8");
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function writeConfig(nextConfig) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
}

function normalizeServer(server) {
    return `${server || DEFAULT_SERVER}`.trim().replace(/\/+$/, "");
}

function toIsoTimestamp(value) {
    if (!value) return new Date().toISOString();
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
    return parsed.toISOString();
}

let NOTIFY_LOGGED = false;
function dotenvFallbackNotice(msg) {
    if (NOTIFY_LOGGED) return;
    NOTIFY_LOGGED = true;
    try {
        process.stderr.write(`[kronos] ${msg}\n`);
    } catch {
        /* stdout/stderr may be detached - this is best effort */
    }
}

function normalizeEventType(rawType) {
    if (!rawType) return null;
    const value = `${rawType}`.trim().toLowerCase();
    if (["session/new", "session.new", "new"].includes(value)) return "session/new";
    if (["session/pause", "session.pause", "pause", "permission", "permission-request"].includes(value)) return "session/pause";
    if (["session/resume", "session.resume", "resume"].includes(value)) return "session/resume";
    if (["session/end", "session.end", "end", "complete", "completed", "done"].includes(value)) return "session/end";
    if (["session/prompt", "session.prompt", "prompt"].includes(value)) return "session/prompt";
    return null;
}

/**
 * When the user runs `kronos setup` in a fresh checkout, .env.local does not
 * yet exist. Next.js reads dotenv only into its own process; without these
 * vars, next-auth emits `[auth][warn] NO_SECRET` on stderr. If the dev
 * server's stderr pipe is closed (orphaned process) that warning raises an
 * EPIPE uncaught exception that tears down request handlers (the freeze).
 * We write a minimal .env.local copy here so the warning never fires.
 */
/**
 * When the user runs `kronos setup` in a fresh checkout, .env.local does not
 * yet exist. Next.js reads dotenv only into its own process; without these
 * vars, next-auth emits `[auth][warn] NO_SECRET` on stderr. If the dev
 * server's stderr pipe is closed (orphaned process) that warning raises an
 * EPIPE uncaught exception that tears down request handlers (the freeze).
 * We write a minimal .env.local copy here so the warning never fires.
 */
function bootstrapDotenvLocal() {
    const cwdEnv = path.join(process.cwd(), ".env.local");
    const cwdEnvExample = path.join(process.cwd(), ".env.example");
    try {
        if (fs.existsSync(cwdEnv)) return;
        let source = null;
        if (fs.existsSync(cwdEnvExample)) {
            source = fs.readFileSync(cwdEnvExample, "utf8");
        }
        const body = source
            ? source
            : [
                  "# Auto-generated by `kronos setup` to silence next-auth NO_SECRET warnings.",
                  'NEXTAUTH_SECRET="kronos-dev-default-secret-authjs-32bytes-fallback"',
                  'NEXTAUTH_URL="http://localhost:3737"',
                  'KRONOS_BRIDGE_TOKEN_SECRET="kronos-dev-bridge-secret"',
                  "",
              ].join("\n");
        fs.writeFileSync(cwdEnv, body, "utf8");
        dotenvFallbackNotice(
            "Wrote .env.local at " +
                cwdEnv +
                " with safe default NEXTAUTH_SECRET; rerun `kronos` in this directory to load it.",
        );
    } catch (err) {
        dotenvFallbackNotice(
            "Could not auto-create .env.local (" +
                (err && err.message) +
                "). The dev server may emit [auth][warn] NO_SECRET; this is harmless.",
        );
    }
}

function ensureLogDirPath() {
    const raw = (process.env.KRONOS_LOG_DIR || "").trim();
    if (raw) return path.resolve(raw);
    return path.join(CONFIG_DIR, "logs");
}

function bootstrapLogDir() {
    try {
        const dir = ensureLogDirPath();
        fs.mkdirSync(dir, { recursive: true });
        if (!process.env.KRONOS_LOG_DIR) process.env.KRONOS_LOG_DIR = dir;
    } catch {
        /* best effort */
    }
}


function parseIncomingPayload(payload) {
    const method = payload?.method || payload?.eventType || payload?.type || payload?.event;
    const params = payload?.params && typeof payload.params === "object" ? payload.params : {};

    // 1. Standard ACP JSON-RPC notification: client/session/update
    if (method === "client/session/update" || method === "session/update" || method === "session.update") {
        const update = params.update || payload.update || {};
        const updateType = update.sessionUpdate || update.type;
        const sessionId = payload.sessionId || params.sessionId || update.sessionId || null;
        const timestamp = toIsoTimestamp(payload.timestamp || params.timestamp || update.timestamp);

        // A) Message chunk -> session/prompt (updates live agent log)
        if (updateType === "agent_message_chunk" || updateType === "message_chunk" || updateType === "message") {
            const content = update.content || update.message || {};
            const text = typeof content === "string" ? content : (content.text || content.content || "");
            if (typeof text === "string" && text.trim()) {
                return { eventType: "session/prompt", sessionId, timestamp, latestAgentMessage: text.trim() };
            }
        }

        // B) state_update: running->resume, requires_action->pause, idle->end
        if (updateType === "state_update" || update.state) {
            const state = update.state || "";
            if (state === "running") {
                return { eventType: "session/resume", sessionId, timestamp, status: "running" };
            } else if (state === "requires_action") {
                return { eventType: "session/pause", sessionId, timestamp, status: "paused" };
            } else if (state === "idle") {
                const stopReason = update.stopReason;
                const failed = stopReason === "failed" || stopReason === "error";
                return {
                    eventType: "session/end", sessionId, timestamp,
                    status: failed ? "failed" : "completed",
                    failureReason: failed ? "Agent stopped with error" : undefined
                };
            }
        }
    }

    // 2. Fall back to Kronos-specific payload parsing
    const eventType = normalizeEventType(method);
    if (!eventType) return null;

    const sessionId = payload?.sessionId || params.sessionId || params.id || payload?.id || null;
    const status = payload?.status || payload?.result?.status || params.status || null;
    const failureReason = payload?.failureReason || params.failureReason || payload?.error?.message || null;
    const timestamp = toIsoTimestamp(payload?.timestamp || params.timestamp);

    return { eventType, sessionId, status, failureReason, timestamp };
}

function parseMessage(raw) {
    if (raw == null) return [];
    let text = raw;
    if (Buffer.isBuffer(raw)) text = raw.toString("utf8");
    if (ArrayBuffer.isView(raw)) text = Buffer.from(raw.buffer).toString("utf8");
    if (raw instanceof ArrayBuffer) text = Buffer.from(raw).toString("utf8");
    if (typeof text !== "string") return [];

    const line = text.trim();
    if (!line) return [];

    const candidates = [];
    try {
        const parsed = JSON.parse(line);
        if (Array.isArray(parsed)) {
            for (const item of parsed) candidates.push(item);
        } else {
            candidates.push(parsed);
        }
    } catch {
        return [];
    }

    const out = [];
    for (const candidate of candidates) {
        const event = parseIncomingPayload(candidate);
        if (event) out.push(event);
    }
    return out;
}

function backoffMs(attempt, floorMs = 500, capMs = 30_000) {
    const exp = floorMs * 2 ** Math.max(0, attempt);
    return Math.min(capMs, exp);
}

function normalizePosixPath(inputPath) {
    return `${inputPath || ""}`.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+/g, "/").trim();
}

function buildProjectFileIndex(rootDir) {
    const ignoreDirs = new Set([
        ".git",
        ".next",
        "node_modules",
        "dist",
        "build",
        "coverage",
        "playwright-report",
        "test-results",
    ]);

    const out = [];
    const stack = [rootDir];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;

        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (!ignoreDirs.has(entry.name)) stack.push(full);
                continue;
            }
            if (!entry.isFile()) continue;
            const rel = normalizePosixPath(path.relative(rootDir, full));
            if (rel) out.push(rel);
        }
    }

    out.sort((a, b) => a.localeCompare(b));
    return out;
}

function resolveMentionToProjectPath(rawMention, rootDir, projectFiles) {
    const token = normalizePosixPath(rawMention).replace(/^@+/, "");
    if (!token) return null;

    const exactAbsolute = path.isAbsolute(token) ? token : null;
    if (exactAbsolute && fs.existsSync(exactAbsolute)) {
        const rel = normalizePosixPath(path.relative(rootDir, exactAbsolute));
        if (rel && !rel.startsWith("..")) {
            return { resolved: rel, ambiguous: [] };
        }
    }

    const exactCandidates = [
        token,
        token.replace(/^\/+/, ""),
        token.startsWith("./") ? token.slice(2) : token,
    ].map(normalizePosixPath);

    for (const candidate of exactCandidates) {
        const full = path.resolve(rootDir, candidate);
        if (!candidate) continue;
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
            const rel = normalizePosixPath(path.relative(rootDir, full));
            if (rel) return { resolved: rel, ambiguous: [] };
        }
    }

    const lowerToken = token.toLowerCase();
    const prefixMatches = projectFiles.filter((p) => p.toLowerCase().startsWith(lowerToken));
    if (prefixMatches.length === 1) return { resolved: prefixMatches[0], ambiguous: [] };
    if (prefixMatches.length > 1) {
        return {
            resolved: prefixMatches[0],
            ambiguous: prefixMatches.slice(1, 6),
        };
    }

    const baseMatches = projectFiles.filter((p) => path.basename(p).toLowerCase().startsWith(lowerToken));
    if (baseMatches.length === 1) return { resolved: baseMatches[0], ambiguous: [] };
    if (baseMatches.length > 1) {
        return {
            resolved: baseMatches[0],
            ambiguous: baseMatches.slice(1, 6),
        };
    }

    return null;
}

function preprocessTaskMentions(taskBody, rootDir, log) {
    if (!taskBody || typeof taskBody !== "string") {
        return { prompt: taskBody, resolvedCount: 0 };
    }

    const mentionPattern = /(^|[\s(])@([^\s)\]}>,;:"'`]+)/g;
    const foundMentions = new Set();
    let match;
    while ((match = mentionPattern.exec(taskBody)) !== null) {
        const mention = `${match[2] || ""}`.trim();
        if (!mention) continue;
        if (mention.includes("@")) continue;
        foundMentions.add(mention);
    }

    if (foundMentions.size === 0) {
        return { prompt: taskBody, resolvedCount: 0 };
    }

    const projectFiles = buildProjectFileIndex(rootDir);
    const resolutions = new Map();
    for (const mention of foundMentions) {
        const resolved = resolveMentionToProjectPath(mention, rootDir, projectFiles);
        if (resolved?.resolved) {
            resolutions.set(mention, resolved);
        }
    }

    if (resolutions.size === 0) {
        return { prompt: taskBody, resolvedCount: 0 };
    }

    const rewritten = taskBody.replace(mentionPattern, (full, prefix, mentionRaw) => {
        const mention = `${mentionRaw || ""}`.trim();
        const resolved = resolutions.get(mention);
        if (!resolved) return full;
        return `${prefix}@${resolved.resolved}`;
    });

    const summaryLines = [];
    for (const [mention, resolved] of resolutions.entries()) {
        const ambiguous = resolved.ambiguous?.length
            ? ` (autocomplete picked @${resolved.resolved}; also: ${resolved.ambiguous.map((v) => `@${v}`).join(", ")})`
            : "";
        summaryLines.push(`- @${mention} => @${resolved.resolved}${ambiguous}`);
    }

    const prompt = `${rewritten}

[kronos mention preprocessor]
${summaryLines.join("\n")}`;

    log(`[drive-acp] mention preprocessing resolved ${resolutions.size} tag(s) from ${rootDir}`);
    return { prompt, resolvedCount: resolutions.size };
}

function fetchPendingTaskForAliasSync(BetterSqlite3, alias, dbPathInput, currentDir) {
    const dbPath = dbPathInput ? path.resolve(dbPathInput) : path.join(currentDir || process.cwd(), "prisma", "dev.db");
    if (!fs.existsSync(dbPath)) {
        throw new Error(`SQLite DB not found at ${dbPath}`);
    }

    const query = `SELECT TaskRun.taskBody AS taskBody
FROM TaskRun
INNER JOIN Agent ON Agent.id = TaskRun.agentId
WHERE Agent.alias = ?
  AND TaskRun.status NOT IN ('COMPLETED', 'FAILED', 'TIMED_OUT')
ORDER BY TaskRun.dispatchedAt DESC, TaskRun.scheduledAt DESC
LIMIT 1;`;

    let db;
    try {
        db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
        const row = db.prepare(query).get(alias);
        const taskBody = (row?.taskBody || "").trim();
        if (!taskBody) {
            throw new Error(`No active task found for @${alias}`);
        }
        return taskBody;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to query pending task: ${message}`);
    } finally {
        try {
            if (db) db.close();
        } catch {
            // no-op
        }
    }
}

async function fetchPendingTaskForAlias(alias, dbPathInput, currentDir) {
    // Build the native module id at runtime so the bundler (bun) leaves it external.
    // better-sqlite3 is a native binding and must never be inlined into a binary.
    const moduleId = ["better", "sqlite3"].join("-");

    let BetterSqlite3;
    try {
        const mod = await import(moduleId);
        // better-sqlite3 is a CommonJS module that exports the class directly;
        // dynamic import wraps CJS exports under `default`.
        BetterSqlite3 = mod.default ?? mod;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Failed to load better-sqlite3 native module. ` +
            `If you are running a bun-compiled kronos binary, the --db-path option requires ` +
            `placing 'better-sqlite3' in a node_modules folder next to the binary, or ` +
            `running the kronos CLI via 'node ./cli/kronos.js' / 'npx kronos'. Original error: ${message}`,
        );
    }

    return fetchPendingTaskForAliasSync(BetterSqlite3, alias, dbPathInput, currentDir);
}

async function runDrivenAcpSession({
    alias,
    agentCommand,
    dbPath,
    log,
    handleParsedEvent,
    taskBodyOverride,
    mentionPreprocessEnabled,
    cwd
}) {
    const rootDir = cwd ? path.resolve(cwd) : process.cwd();
    const taskBody = typeof taskBodyOverride === "string"
        ? taskBodyOverride.trim()
        : await fetchPendingTaskForAlias(alias, dbPath, rootDir);
    if (!taskBody) {
        throw new Error(`No active task found for @${alias}`);
    }
    const finalPrompt = mentionPreprocessEnabled
        ? preprocessTaskMentions(taskBody, rootDir, log).prompt
        : taskBody;
    log("[drive-acp] using task body:", finalPrompt);

    let acp;
    try {
        acp = await import("@agentclientprotocol/sdk");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
            `[kronos] Missing ACP SDK dependency (@agentclientprotocol/sdk). Install with: npm i @agentclientprotocol/sdk. Original error: ${message}`,
        );
    }

    const child = spawn(agentCommand, {
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
        cwd: rootDir,
    });
    activeAgentChild = child;

    let childExited = false;
    child.on("exit", () => {
        childExited = true;
        if (activeAgentChild === child) activeAgentChild = null;
    });
    child.stderr.on("data", (chunk) => {
        const text = `${chunk}`.trim();
        if (text) log("[drive-acp][agent]", text);
    });

    const stream = acp.ndJsonStream(
        Writable.toWeb(child.stdin),
        Readable.toWeb(child.stdout),
    );

    let sessionId = null;
    let failure = null;

    try {
        const app = acp.client({ name: "kronos-watch-stdio" })
            .onRequest(acp.methods.client.session.requestPermission, () => ({
                outcome: { outcome: "approved" },
            }))
            .onNotification(acp.methods.client.session.update, (ctx) => {
                const update = ctx.params?.update;
                const updateType = update?.sessionUpdate || update?.type;

                // state_update -> forward lifecycle transitions
                if (updateType === "state_update" || update?.state) {
                    const state = update?.state || "";
                    if (state === "running") {
                        handleParsedEvent({ eventType: "session/resume", sessionId, timestamp: new Date().toISOString() });
                    } else if (state === "requires_action") {
                        handleParsedEvent({ eventType: "session/pause", sessionId, timestamp: new Date().toISOString() });
                    }
                }
            });

        await app.connectWith(stream, async (ctx) => {
            await ctx.request(acp.methods.agent.initialize, {
                protocolVersion: acp.PROTOCOL_VERSION,
                clientCapabilities: {},
                clientInfo: { name: "kronos-watch-stdio", version: "1.0.0" },
            });

            return ctx.buildSession(rootDir).withSession(async (session) => {
                sessionId = session.sessionId;

                handleParsedEvent({
                    eventType: "session/new",
                    sessionId,
                    status: "running",
                    timestamp: new Date().toISOString(),
                });

                // prompt() is fire-and-forget per the ACP SDK example
                session.prompt(finalPrompt);

                let accumulatedMessage = "";

                for (;;) {
                    const message = await session.nextUpdate();
                    if (message.kind === "stop") break;
                    // Forward agent message chunks to the cloud
                    if (message.kind === "session_update") {
                        const update = message.update;
                        const updateType = update?.sessionUpdate || update?.type;

                        // Dump every update type so we can see what opencode actually emits
                        log("[drive-acp] update:", updateType, JSON.stringify(update).slice(0, 200));

                        // Capture the agent-generated session title (try all known field shapes)
                        if (
                            updateType === "session_title_update" ||
                            updateType === "title_update" ||
                            updateType === "titleUpdate"
                        ) {
                            const title =
                                update?.title ||
                                update?.sessionTitle ||
                                update?.content?.text ||
                                (typeof update?.content === "string" ? update.content : "") ||
                                "";
                            if (typeof title === "string" && title.trim()) {
                                log("[drive-acp] session title:", title.trim());
                                handleParsedEvent({
                                    eventType: "session/title",
                                    sessionId,
                                    timestamp: new Date().toISOString(),
                                    sessionTitle: title.trim(),
                                });
                            }
                        }

                        // Forward streamed response chunks (accumulated for full message)
                        if (updateType === "agent_message_chunk" || updateType === "message_chunk") {
                            const text = update?.content?.text || (typeof update?.content === "string" ? update.content : "") || "";
                            if (typeof text === "string" && text) {
                                accumulatedMessage += text;
                                handleParsedEvent({
                                    eventType: "session/prompt",
                                    sessionId,
                                    timestamp: new Date().toISOString(),
                                    latestAgentMessage: accumulatedMessage.trim(),
                                });
                            }
                        }
                    }
                }
            });
        });
    } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
    } finally {
        if (sessionId) {
            handleParsedEvent({
                eventType: "session/end",
                sessionId,
                status: failure ? "failed" : "completed",
                failureReason: failure ? failure.message : undefined,
                timestamp: new Date().toISOString(),
            });
        }

        if (!childExited) {
            try {
                child.kill("SIGTERM");
            } catch {
                // no-op
            }
        }
    }

    if (failure) throw failure;
    return { taskBody, sessionId };
}

async function readSseStream(response, onEvent) {
    if (!response?.body) throw new Error("Queue stream did not return a readable body");
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = "";
    let eventName = "message";
    let dataLines = [];

    const flushEvent = async () => {
        if (dataLines.length === 0) return;
        const data = dataLines.join("\n");
        await onEvent({ event: eventName || "message", data });
        eventName = "message";
        dataLines = [];
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let lineStart = 0;
        for (let i = 0; i < buffer.length; i += 1) {
            const char = buffer[i];
            if (char !== "\n") continue;

            let line = buffer.slice(lineStart, i);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            lineStart = i + 1;

            if (!line) {
                await flushEvent();
                continue;
            }

            if (line.startsWith(":")) continue;
            if (line.startsWith("event:")) {
                eventName = line.slice(6).trim() || "message";
                continue;
            }
            if (line.startsWith("data:")) {
                dataLines.push(line.slice(5).trimStart());
            }
        }

        buffer = buffer.slice(lineStart);
    }

    if (buffer.trim()) {
        const line = buffer.trim();
        if (line.startsWith("event:")) {
            eventName = line.slice(6).trim() || "message";
        } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
        }
    }
    await flushEvent();
}

async function promptToken() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    const token = await new Promise((resolve) => {
        rl.question("Kronos token: ", resolve);
    });
    rl.close();
    return `${token}`.trim();
}

// ------------------------------------------------------------------------
// TUI Setup Wizard (powered by @clack/prompts)
// ------------------------------------------------------------------------
async function loadClackPrompts() {
    try {
        // @clack/prompts is pure ESM, dynamic import works in Node CJS + bun binary
        const mod = await import("@clack/prompts");
        return mod.default ?? mod;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Missing @clack/prompts dependency. Install with: npm i @clack/prompts. Original error: ${message}`,
        );
    }
}

// ------------------------------------------------------------------------
// Self-managed dev server: lets the CLI boot `npm start` (or `bun run start`)
// on demand so the user doesn't have to manually start the web server in
// another terminal.
// ------------------------------------------------------------------------
let spawnedDevServer = null;
let spawnedDir = null;
let spawnedRunner = null;
let spawnedPort = null;

let activeAgentChild = null;

function killActiveAgentChild() {
    if (activeAgentChild && !activeAgentChild.killed && activeAgentChild.exitCode === null) {
        try {
            if (process.platform === "win32") {
                spawn("taskkill", ["/pid", String(activeAgentChild.pid), "/f", "/t"], {
                    detached: true,
                    stdio: "ignore",
                }).unref();
            } else {
                activeAgentChild.kill("SIGTERM");
                const target = activeAgentChild;
                setTimeout(() => {
                    try { target.kill("SIGKILL"); } catch {}
                }, 2000).unref();
            }
        } catch {
            // ignore
        }
    }
}

let cachedPackageRunner = null;
function detectPackageRunner() {
    if (cachedPackageRunner !== null) return cachedPackageRunner;
    const probe = (cmd) => {
        try {
            const out = spawnSync(cmd, ["--version"], { stdio: "pipe", windowsHide: true });
            return out.status === 0;
        } catch {
            return false;
        }
    };
    if (probe("bun")) cachedPackageRunner = "bun";
    else if (probe("npm")) cachedPackageRunner = "npm";
    else cachedPackageRunner = null;
    return cachedPackageRunner;
}

function runRunner(args, cwd, log) {
    const runner = detectPackageRunner();
    if (!runner) {
        throw new Error(
            "Neither `bun` nor `npm` was found on PATH. Install one to auto-bootstrap the dev server.",
        );
    }
    log?.(`[kronos] $ ${runner} ${args.join(" ")}  (cwd=${cwd})`);
    const useShell = process.platform === "win32";
    return spawn(runner, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        shell: useShell,
        windowsHide: true,
    });
}

function runRunnerAwait(args, cwd, log) {
    return new Promise((resolve, reject) => {
        const child = runRunner(args, cwd, log);
        child.stdout.on("data", (chunk) => {
            const text = `${chunk}`.replace(/\r/g, "");
            for (const line of text.split("\n")) {
                if (line.trim()) log?.(`[dev] ${line.trim()}`);
            }
        });
        child.stderr.on("data", (chunk) => {
            const text = `${chunk}`.replace(/\r/g, "");
            for (const line of text.split("\n")) {
                if (line.trim()) log?.(`[dev] ${line.trim()}`);
            }
        });
        child.on("error", (err) => reject(err));
        child.on("exit", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${detectPackageRunner()} ${args.join(" ")} exited with code ${code}`));
        });
    });
}

function isKronosCheckout(dir) {
    if (!dir) return false;
    try {
        const pkgPath = path.join(dir, "package.json");
        if (!fs.existsSync(pkgPath)) return false;
        const data = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        return data?.name === "kronos";
    } catch {
        return false;
    }
}

function findKronosCheckout() {
    const seen = new Set();
    const walkUp = (dir) => {
        if (!dir || seen.has(dir)) return null;
        seen.add(dir);
        if (isKronosCheckout(dir)) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        return walkUp(parent);
    };

    const fromCwd = walkUp(process.cwd());
    if (fromCwd) return fromCwd;

    if (process.env.KRONOS_INSTALL_DIR) {
        const env = path.resolve(process.env.KRONOS_INSTALL_DIR);
        if (isKronosCheckout(env)) return env;
    }

    const argv1 = process.argv[1] || "";
    const binDir = argv1 ? path.dirname(path.resolve(argv1)) : "";
    if (binDir) {
        const fromBin = walkUp(binDir);
        if (fromBin) return fromBin;
    }

    return null;
}

async function isServerReachable(serverUrl) {
    if (!serverUrl) return false;
    try {
        const url = `${normalizeServer(serverUrl)}/api/health`.replace("localhost", "127.0.0.1");
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 2500);
        try {
            const res = await fetch(url, { method: "GET", signal: controller.signal });
            return res.status < 600;
        } finally {
            clearTimeout(t);
        }
    } catch {
        return false;
    }
}

function extractPort(serverUrl) {
    if (!serverUrl) return null;
    const m = `${serverUrl}`.match(/:(\d{2,5})(?:\/|$)/);
    return m ? Number(m[1]) : null;
}

function withPort(serverUrl, port) {
    try {
        const u = new URL(serverUrl);
        u.port = String(port);
        return u.toString().replace(/\/+$/, "");
    } catch {
        return `http://localhost:${port}`;
    }
}

function isPortInUse(port) {
    if (!port) return false;
    const probe = (host) => {
        try {
            const out = spawnSync(process.platform === "win32" ? "powershell" : "bash",
                process.platform === "win32"
                    ? ["-NoProfile", "-Command", `(Test-NetConnection -ComputerName ${host} -Port ${port} -WarningAction SilentlyContinue -InformationLevel Quiet) 2>$null`]
                    : ["-c", `(echo >/dev/tcp/${host}/${port}) 2>/dev/null && echo open || echo closed`],
                { stdio: "pipe", windowsHide: true });
            if (process.platform !== "win32") {
                return `${out.stdout || ""}`.trim() === "open";
            }
            return out.status === 0;
        } catch {
            return false;
        }
    };
    return probe("127.0.0.1") || probe("localhost");
}

async function pickFreePort(preferred, log) {
    if (typeof preferred !== "number" || !Number.isFinite(preferred)) preferred = DEFAULT_PORT;
    const candidates = [...new Set([preferred, ...FALLBACK_PORTS])];
    for (const port of candidates) {
        const reachableAlready = await isServerReachable(`http://127.0.0.1:${port}`).catch(() => false);
        if (reachableAlready) continue;
        if (isPortInUse(port)) continue;
        if (port !== preferred) {
            log?.(`[kronos] port ${preferred} busy, switching to ${port}.`);
        }
        return port;
    }
    log?.(`[kronos] all candidate ports occupied; using ${preferred} anyway and hoping the kernel/launchd tells us later.`);
    return preferred;
}

function killSpawnedDevServer() {
    if (spawnedDevServer && !spawnedDevServer.killed && spawnedDevServer.exitCode === null) {
        try {
            if (process.platform === "win32") {
                spawn("taskkill", ["/pid", String(spawnedDevServer.pid), "/f", "/t"], {
                    detached: true,
                    stdio: "ignore",
                }).unref();
            } else {
                spawnedDevServer.kill("SIGTERM");
                setTimeout(() => {
                    try { spawnedDevServer.kill("SIGKILL"); } catch { /* ignore */ }
                }, 5_000).unref();
            }
        } catch {
            // ignore
        }
    }
}

process.on("exit", () => {
    killActiveAgentChild();
    killSpawnedDevServer();
});
process.on("SIGINT", () => {
    killActiveAgentChild();
    killSpawnedDevServer();
    if (process.listenerCount("SIGINT") <= 1) {
        process.exit(130);
    }
});
process.on("SIGTERM", () => {
    killActiveAgentChild();
    killSpawnedDevServer();
    if (process.listenerCount("SIGTERM") <= 1) {
        process.exit(143);
    }
});

async function ensureServerRunning({ server, log, mode = "prod", pollMs = 1500, timeoutMs = 90_000 } = {}) {
    const target = normalizeServer(server);
    if (!target || target === "off") return { spawned: false, alreadyRunning: false, skipped: true };

    if (await isServerReachable(target)) {
        return { spawned: false, alreadyRunning: true, server: target };
    }

    const runner = detectPackageRunner();
    if (!runner) {
        return {
            spawned: false,
            alreadyRunning: false,
            error: "no-runner",
            message: "Neither `bun` nor `npm` was found on PATH. Install one (or pass --no-server).",
        };
    }

    const checkout = findKronosCheckout();
    if (!checkout) {
        return {
            spawned: false,
            alreadyRunning: false,
            error: "no-checkout",
            message: "No Kronos checkout found. Place the kronos CLI in a folder with package.json (name=\"kronos\") or set KRONOS_INSTALL_DIR.",
        };
    }

    let startChild;
    try {
        const requestedPort = extractPort(target);
        const effectivePort = await pickFreePort(requestedPort, log);
        const nextServer = requestedPort && requestedPort !== effectivePort
            ? withPort(target, effectivePort)
            : target;
        spawnedPort = effectivePort;
        spawnedDir = checkout;
        spawnedRunner = runner;

        const portArgs = mode === "dev"
            ? ["run", "dev", "--", "--port", String(effectivePort)]
            : ["run", "start", "--", "--port", String(effectivePort)];

        if (mode === "dev") {
            log?.(`[kronos] spawning \`${runner} ${portArgs.join(" ")}\` in ${checkout}...`);
            startChild = runRunner(portArgs, checkout, log);
        } else {
            const hasBuild = fs.existsSync(path.join(checkout, ".next"));
            if (!hasBuild) {
                log?.(`[kronos] no .next/ build detected — running \`${runner} run build\` first...`);
                await runRunnerAwait(["run", "build"], checkout, log);
            } else {
                log?.(`[kronos] using existing .next/ build...`);
            }
            log?.(`[kronos] spawning \`${runner} ${portArgs.join(" ")}\` in ${checkout}...`);
            startChild = runRunner(portArgs, checkout, log);
        }

        spawnedDevServer = startChild;
        startChild.stdout.on("data", (chunk) => {
            const text = `${chunk}`.replace(/\r/g, "");
            for (const line of text.split("\n")) {
                const trimmed = line.trim();
                if (trimmed) log?.(`[dev] ${trimmed}`);
            }
        });
        startChild.stderr.on("data", (chunk) => {
            const text = `${chunk}`.replace(/\r/g, "");
            for (const line of text.split("\n")) {
                const trimmed = line.trim();
                if (trimmed) log?.(`[dev] ${trimmed}`);
            }
        });
        startChild.on("error", (err) => log?.(`[dev] error: ${err.message}`));

        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            await sleep(pollMs);
            if (await isServerReachable(nextServer)) {
                log?.(`[kronos] dev server up at ${nextServer} (via ${runner}).`);
                return { spawned: true, alreadyRunning: false, checkout, server: nextServer, runner, pid: startChild.pid, port: effectivePort };
            }
            if (startChild.exitCode !== null) {
                return {
                    spawned: false,
                    alreadyRunning: false,
                    error: `dev-server-exit-${startChild.exitCode}`,
                    checkout,
                    runner,
                    port: effectivePort,
                    message: `\`${runner} ${portArgs.join(" ")}\` exited with code ${startChild.exitCode} before reaching ${nextServer}. Use --port <p> or set KRONOS_PORT to pick a different port.`,
                };
            }
        }
        return {
            spawned: false,
            alreadyRunning: false,
            error: "timeout",
            checkout,
            runner,
            port: effectivePort,
            message: `\`${runner} ${portArgs.join(" ")}\` did not respond at ${nextServer} within ${Math.round(timeoutMs / 1000)}s.`,
        };
    } catch (error) {
        return {
            spawned: false,
            alreadyRunning: false,
            error: "build-failed",
            checkout,
            message: error instanceof Error ? error.message : String(error),
        };
    }
}

async function promptWithDefault(prompts, key, existing, fallback, message) {
    const initial = (existing && existing[key]) || fallback;
    const response = await prompts.text({
        message,
        initialValue: initial,
        placeholder: `${initial}`,
    });
    if (prompts.isCancel(response)) return null;
    if (response === undefined || response === null || `${response}`.length === 0) return initial;
    return `${response}`.trim() || initial;
}

function sanitiseAlias(input) {
    return `${input || ""}`
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 32);
}

function openUrl(url) {
    try {
        let child;
        if (process.platform === "win32") {
            child = spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" });
        } else if (process.platform === "darwin") {
            child = spawn("open", [url], { detached: true, stdio: "ignore" });
        } else {
            child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
        }
        if (child && typeof child.unref === "function") child.unref();
        return true;
    } catch {
        return false;
    }
}

async function probeServer(prompts, serverInput) {
    const server = normalizeServer(serverInput);
    const spinner = prompts.spinner();
    spinner.start(`Probing ${server}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
        const healthEndpoint = `${server}/api/health`.replace("localhost", "127.0.0.1");
        try {
            const res = await fetch(healthEndpoint, { method: "GET", signal: controller.signal });
            if (res.ok) {
                spinner.stop("Server reachable ✅");
                return { ok: true };
            }
            spinner.stop(`Reachable but HTTP ${res.status}`);
            return { ok: false, status: res.status };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            spinner.stop(`Could not reach ${server} (${msg}). Start it with \`npm run dev\` if you want jobs delivered.`);
            return { ok: false, error: msg };
        }
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchAgentAliases({ server, token }) {
    if (!server || !token) return { ok: false, aliases: [], reason: "missing-token" };
    const endpoint = `${normalizeServer(server)}/api/bridge/agents?token=${encodeURIComponent(token)}`.replace("localhost", "127.0.0.1");
    try {
        const res = await fetch(endpoint, { method: "GET" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            return { ok: false, aliases: [], errors: [data?.error?.message || `HTTP ${res.status}`] };
        }
        if (Array.isArray(data?.data)) {
            return { ok: true, aliases: data.data };
        }
        if (Array.isArray(data?.data?.agents)) {
            return { ok: true, aliases: data.data.agents };
        }
        return { ok: true, aliases: [] };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, aliases: [], errors: [message] };
    }
}

async function ensureAgentAlias({ server, token, alias, name }) {
    if (!server || !token || !alias) {
        return { ok: false, errors: ["missing-credentials"] };
    }
    const endpoint = `${normalizeServer(server)}/api/bridge/agents`.replace("localhost", "127.0.0.1");
    try {
        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
                alias,
                name: name || alias,
                agentType: "CUSTOM",
                connectionTier: "WEBHOOK",
            }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.success === false) {
            return { ok: false, errors: [data?.error?.message || `HTTP ${res.status}`] };
        }
        return { ok: true, agent: data.data, alreadyExisted: Boolean(data.data?.alreadyExisted) };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, errors: [message] };
    }
}

async function pickAlias(prompts, existingAlias, fetchedAliases) {
    if (fetchedAliases.length > 0) {
        const choices = fetchedAliases.map((a) => ({
            value: a.alias,
            label: `@${a.alias}${a.name ? ` — ${a.name}` : ""}`,
        }));
        choices.push({ value: "__new__", label: "+ Enter a different / new alias..." });
        const initial = choices.find((c) => c.value === existingAlias)?.value || choices[0].value;
        const picked = await prompts.select({
            message: "Pick the alias to run",
            initialValue: initial,
            options: choices,
        });
        if (prompts.isCancel(picked)) return null;
        if (picked === "__new__") return "__new__";
        return picked;
    }
    const v = await prompts.text({
        message: "Agent alias to run (must match Settings → Create Agent)",
        initialValue: existingAlias,
        placeholder: existingAlias || "my-agent",
    });
    if (prompts.isCancel(v)) return null;
    return `${v ?? ""}`.trim() || existingAlias;
}

async function commandSetup(rawArgs) {
    const args = parseArgs(rawArgs);
    if (args.help || args.h) {
        console.log(`kronos setup

Interactive TUI wizard to configure Kronos bridge credentials and defaults.
Saves everything to ${CONFIG_FILE}. Works with both the node CLI and bun-compiled binaries.

Options:
  --non-interactive  exit if the input is not a TTY (use login --token instead)
`);
        return;
    }

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.error(
            "`kronos setup` requires an interactive terminal. " +
            "Use `kronos login --token <token>` for non-interactive use.",
        );
        process.exitCode = 1;
        return;
    }

    bootstrapDotenvLocal();
    bootstrapLogDir();

    const prompts = await loadClackPrompts();
    const existing = readConfig();

    const currentServer = resolveServer(parseArgs(rawArgs), undefined, existing.server || DEFAULTS.server);
    if (!rawArgs.includes("--no-server")) {
        const setupArgs = parseArgs(rawArgs);
        const ensure = await ensureServerRunning({
            server: currentServer,
            mode: resolveServerMode(setupArgs, rawArgs),
            log: (m) => process.stderr.write(`${m}\n`),
        });
        if (ensure.error) {
            process.stderr.write(`[kronos] ${ensure.message || ensure.error}\n`);
        } else if (ensure.spawned) {
            process.stderr.write(`[kronos] dev server up at ${ensure.server}.\n`);
        } else if (ensure.alreadyRunning) {
            process.stderr.write(`[kronos] using existing server at ${ensure.server}.\n`);
        }
    }

    prompts.intro("🕰️  Kronos — bridge setup");

    const mode = await prompts.select({
        message: "What do you want to configure?",
        initialValue: "full",
        options: [
            { label: "Full setup (server, agent, alias, token)", value: "full" },
            { label: "Save / rotate bridge token only", value: "token" },
            { label: "Re-pick the agent command", value: "agent" },
            { label: "Re-pick the server URL", value: "server" },
            { label: "Show current config", value: "show" },
            { label: "Cancel", value: "cancel" },
        ],
    });

    if (prompts.isCancel(mode) || mode === "cancel") {
        prompts.cancel("Setup cancelled.");
        return;
    }

    if (mode === "show") {
        const clean = { ...existing };
        if (clean.token) clean.token = `${clean.token.slice(0, 4)}…(redacted)`;
        prompts.note(JSON.stringify(clean, null, 2), "Current ~/.kronos/config.json");
        prompts.outro("Done.");
        return;
    }

    const next = { ...existing };

    // ---------- 1. Server URL (always persisted, even on Enter-default) ----------
    if (mode === "server" || mode === "full") {
        const v = await promptWithDefault(
            prompts,
            "server",
            existing,
            normalizeServer(DEFAULTS.server),
            "Kronos server URL",
        );
        if (v === null) { prompts.cancel("Setup cancelled."); return; }
        next.server = normalizeServer(v);
    }
    if (next.server === undefined) next.server = normalizeServer(DEFAULTS.server);

    // ---------- 2. Agent command (always persisted) ----------
    if (mode === "agent" || mode === "full") {
        const v = await promptWithDefault(
            prompts,
            "agent",
            existing,
            DEFAULTS.agent,
            "Default ACP agent command (used by `kronos agent`)",
        );
        if (v === null) { prompts.cancel("Setup cancelled."); return; }
        next.agent = v;
    }
    if (next.agent === undefined) next.agent = DEFAULTS.agent;

    // ---------- 3. Probe the server (so we know where to point the browser) ----------
    await probeServer(prompts, next.server);

    // ---------- 4. Open dashboard to /settings so the user can sign in & generate token ----------
    if (mode === "full" || mode === "token") {
        const settingsUrl = `${normalizeServer(next.server)}/settings`;
        prompts.note(
            `Open ${settingsUrl} in your browser to:
  • Sign in if you haven't already
  • Click "Generate" under "Bridge Token"  (the value appears in the input box)
  • Click "Create Agent" if your alias doesn't exist yet`,
            "Need a token?",
        );

        const wantsOpen = await prompts.confirm({
            message: `Open ${settingsUrl} in your browser now?`,
            initialValue: true,
        });
        if (prompts.isCancel(wantsOpen)) {
            prompts.cancel("Setup cancelled.");
            return;
        }

        if (wantsOpen) {
            const ok = openUrl(settingsUrl);
            if (ok) {
                prompts.log.info("Browser opened. Generate the token, then paste it below.");
            } else {
                prompts.log.warn(`Couldn't auto-open the browser. Open ${settingsUrl} manually.`);
            }
        }
    }

    // ---------- 5. Collect the bridge token ----------
    if (mode === "full" || mode === "token") {
        const wasEmpty = !existing.token;
        const tokenPrompt = await prompts.password({
            message: wasEmpty
                ? "Bridge token (from Settings → Generate)"
                : "New bridge token (leave blank to keep existing)",
            validate: (value) => {
                if (mode === "token" && !value) return "Bridge token is required.";
                if (!value) return undefined;
                if (value.trim().length < 8) return "Token looks too short — paste the full token.";
                return undefined;
            },
        });
        if (prompts.isCancel(tokenPrompt)) { prompts.cancel("Setup cancelled."); return; }
        const trimmed = `${tokenPrompt ?? ""}`.trim();
        if (trimmed) {
            next.token = trimmed;
        } else if (mode === "token") {
            prompts.cancel("No token provided.");
            return;
        }
    }

    // ---------- 6. Pick or create the alias ----------
    if (mode === "full") {
        const fetched = next.token && next.server
            ? await fetchAgentAliases({ server: next.server, token: next.token })
            : { ok: false, aliases: [] };
        if (fetched.errors && fetched.errors.length > 0) {
            prompts.log.warn(`Couldn't fetch existing aliases: ${fetched.errors.join("; ")}`);
        }
        const choice = await pickAlias(prompts, next.alias || existing.alias, fetched.aliases || []);
        if (choice === null) { prompts.cancel("Setup cancelled."); return; }
        if (choice === "__new__") {
            const v = await prompts.text({
                message: "New alias @handle (must match Settings → Create Agent)",
                placeholder: next.alias || "my-agent",
            });
            if (prompts.isCancel(v)) { prompts.cancel("Setup cancelled."); return; }
            next.alias = sanitiseAlias(v);
        } else {
            next.alias = choice;
        }

        if (!next.alias || !/^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/.test(next.alias)) {
            const sanitised = sanitiseAlias(next.alias);
            if (!sanitised) { prompts.cancel("Invalid alias."); return; }
            next.alias = sanitised;
        }

        // Attempt auto-create via the bridge-token-authenticated endpoint
        if (next.token && next.server) {
            const known = (fetched.aliases || []).some((a) => a.alias === next.alias);
            if (!known) {
                const confirmCreate = await prompts.confirm({
                    message: `Create @${next.alias} on ${normalizeServer(next.server)} now?`,
                    initialValue: true,
                });
                if (!prompts.isCancel(confirmCreate) && confirmCreate) {
                    const result = await ensureAgentAlias({
                        server: next.server,
                        token: next.token,
                        alias: next.alias,
                    });
                    if (result.ok) {
                        if (result.alreadyExisted) {
                            prompts.log.success(`@${next.alias} already exists on the server.`);
                        } else {
                            prompts.log.success(`Created @${next.alias} on the server.`);
                        }
                    } else {
                        prompts.log.warn(
                            `Couldn't auto-create @${next.alias} (${result.errors?.join("; ") || "unknown error"}). ` +
                            `Open ${normalizeServer(next.server)}/settings and click "Create Agent" to finish manually.`,
                        );
                    }
                } else {
                    prompts.log.warn(
                        `Heads up — @${next.alias} must exist in Settings → Create Agent before jobs can be delivered.`,
                    );
                }
            }
        }
    }

    // ---------- 7. Save ----------
    next.updatedAt = new Date().toISOString();
    writeConfig(next);

    const redacted = { ...next };
    if (redacted.token) redacted.token = `${redacted.token.slice(0, 4)}…(redacted)`;
    prompts.note(JSON.stringify(redacted, null, 2), "Saved ~/.kronos/config.json");

    // ---------- 8. Final probe + handoff ----------
    if (next.server) await probeServer(prompts, next.server);

    const startNow = await prompts.confirm({
        message: next.alias
            ? `Start the agent as @${next.alias} now?  (Ctrl+C ends it)`
            : "Start the worker now?",
        initialValue: false,
    });
    if (prompts.isCancel(startNow)) {
        prompts.outro(next.alias ? `Saved. Next: kronos up --alias ${next.alias}` : "Saved. Run `kronos up` whenever you're ready.");
        return;
    }
    if (startNow) {
        prompts.outro("Launching server & worker — press Ctrl+C to stop.");
        const argsList = ["--drive-acp", "--continuous", "--queue-transport", "streamable-http"];
        if (next.alias) argsList.push("--alias", next.alias);
        if (next.token) argsList.push("--token", next.token);
        if (next.server) argsList.push("--server", next.server);
        await commandWatchStdio(argsList);
        return;
    }
    prompts.outro(
        next.alias
            ? `Saved. Next: kronos up --alias ${next.alias}`
            : "Saved. Next: kronos up --alias <your-alias>",
    );
}

async function commandLogin(rawArgs) {
    const args = parseArgs(rawArgs);
    let token = typeof args.token === "string"
        ? args.token.trim()
        : (typeof args._[0] === "string" ? args._[0].trim() : "");
    const server = normalizeServer(
        typeof args.server === "string"
            ? args.server
            : (typeof args._[1] === "string" ? args._[1] : undefined),
    );

    if (!token && process.stdin.isTTY) {
        token = await promptToken();
    }
    if (!token) {
        console.error("Missing token. Use --token <token> or run interactively.");
        process.exitCode = 1;
        return;
    }

    const existing = readConfig();
    writeConfig({
        ...existing,
        token,
        server,
        updatedAt: new Date().toISOString(),
    });
    console.log(`Saved login config to ${CONFIG_FILE}`);
}

async function commandWatchStdio(rawArgs) {
    const args = parseArgs(rawArgs);
    const config = readConfig();

    const positionalAlias = typeof args._[0] === "string" ? args._[0] : undefined;
    const positionalToken = typeof args._[1] === "string" ? args._[1] : undefined;
    const positionalServer = typeof args._[2] === "string" ? args._[2] : undefined;

    const alias = `${args.alias || positionalAlias || config.alias || ""}`.trim();
    const token = `${args.token || positionalToken || config.token || ""}`.trim();
    const server = resolveServer(args, positionalServer, config.server || DEFAULTS.server);
    const verbose = Boolean(args.verbose);
    const driveAcp = Boolean(args["drive-acp"]);
    const continuousDriveAcp = Boolean(args.continuous || args.loop || args["watch-queue"]);
    const driveAcpAgentCommand = typeof args.agent === "string"
        ? args.agent
        : (typeof args["agent-cmd"] === "string"
            ? args["agent-cmd"]
            : (`${process.env.KRONOS_ACP_AGENT_CMD || config.agent || "opencode acp"}`.trim()));
    const dbPath = typeof args["db-path"] === "string" ? args["db-path"] : undefined;
    const taskBodyOverride = typeof args["task-body-override"] === "string" ? args["task-body-override"] : undefined;


    if (!alias) {
        console.error("Missing --alias <alias>.");
        process.exitCode = 1;
        return;
    }
    if (!token) {
        console.error("Missing token. Use --token <token> or run `kronos login` first.");
        process.exitCode = 1;
        return;
    }

    const skipServer = rawArgs.includes("--no-server") || args["no-server"];
    if (!skipServer && !(await isServerReachable(server))) {
        const ensure = await ensureServerRunning({
            server,
            mode: resolveServerMode(args, rawArgs),
            log: (m) => { if (verbose) console.error(m); },
        });
        if (ensure.error) {
            console.error(`[kronos] ${ensure.message || `dev server unreachable: ${ensure.error}`}`);
            if (ensure.error !== "no-checkout") {
                console.error("[kronos] agent cannot start without a reachable Kronos server.");
                console.error("  Start the server yourself (`bun run dev` / `npm run dev`) or pass --no-server to try anyway.");
            }
            process.exitCode = 1;
            return;
        }
        if (!ensure.alreadyRunning) {
            console.error(`[kronos] dev server booted at ${ensure.server} via ${ensure.runner}.`);
        } else {
            console.error(`[kronos] using existing server at ${ensure.server}.`);
        }
    }

    const rawPollMs = Number(args["poll-ms"] ?? args.interval ?? 3000);
    const pollMs = Number.isFinite(rawPollMs) ? Math.max(500, Math.floor(rawPollMs)) : 3000;
    const queueTransportRaw = `${args["queue-transport"] || args.transport || ""}`.trim().toLowerCase();
    const queueTransport = ["polling", "streamable-http"].includes(queueTransportRaw)
        ? queueTransportRaw
        : "polling";

    const mentionPreprocessEnabled = !Boolean(rawArgs.includes("--no-mention-preprocess") || args["no-mention-preprocess"]);
    const customCwd = (typeof args.cwd === "string" ? args.cwd : undefined)
        || (typeof args["work-dir"] === "string" ? args["work-dir"] : undefined);
    const cloudEndpoint = `${server}/api/acp/events`;
    const pending = [];
    const seenSessions = new Set();
    let flushInFlight = false;
    let flushFailureCount = 0;
    let flushTimer = null;
    let shouldStop = false;

    const log = (...parts) => {
        if (verbose) console.log(...parts);
    };

    const enqueue = (event) => {
        pending.push(event);
        scheduleFlush(0);
    };

    async function postCloudEvent(event) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
            const payload = {
                eventType: event.eventType,
                alias,
                sessionId: event.sessionId || undefined,
                token,
                timestamp: event.timestamp || new Date().toISOString(),
                status: event.status || undefined,
                failureReason: event.failureReason || undefined,
                latestAgentMessage: event.latestAgentMessage || undefined,
            };

            const res = await fetch(cloudEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });

            if (!res.ok) {
                const body = await res.text().catch(() => "");
                const error = new Error(`HTTP ${res.status}${body ? `: ${body}` : ""}`);
                if (res.status >= 400 && res.status < 500 && res.status !== 429) {
                    // Permanent client-side error (bad alias/auth/etc): do not retry forever.
                    error.permanent = true;
                    error.status = res.status;
                }
                throw error;
            }
        } finally {
            clearTimeout(timeout);
        }
    }

    function scheduleFlush(delayMs) {
        if (shouldStop) return;
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = setTimeout(() => {
            flushTimer = null;
            void flushQueue();
        }, delayMs);
    }

    const MAX_FLUSH_RETRIES = 10;

    async function flushQueue() {
        if (flushInFlight) return;
        flushInFlight = true;
        try {
            while (pending.length > 0) {
                const next = pending[0];
                try {
                    await postCloudEvent(next);
                    pending.shift();
                    flushFailureCount = 0;
                    log("[cloud] sent", next.eventType, next.sessionId || "-");
                } catch (error) {
                    if (error && error.permanent) {
                        console.error("[cloud] permanent error, dropping event:", String(error.message || error));
                        if (error.status === 401 || error.status === 403) {
                            console.error("[cloud] authentication/authorization failed. Exiting.");
                            shouldStop = true;
                        }
                        pending.shift();
                        flushFailureCount = 0;
                        continue;
                    }

                    flushFailureCount += 1;
                    if (flushFailureCount > MAX_FLUSH_RETRIES) {
                        console.error(`[cloud] max retries (${MAX_FLUSH_RETRIES}) exceeded, dropping event:`, next.eventType, next.sessionId || "-");
                        pending.shift();
                        flushFailureCount = 0;
                        continue;
                    }

                    const waitMs = backoffMs(flushFailureCount);
                    log("[cloud] send failed (attempt", flushFailureCount, "), retrying in", waitMs, "ms:", String(error));
                    scheduleFlush(waitMs);
                    return;
                }
            }
        } finally {
            flushInFlight = false;
            // If more events arrived while we were in-flight, re-schedule immediately.
            if (pending.length > 0 && !shouldStop && !flushTimer) {
                scheduleFlush(0);
            }
        }
    }

    function handleParsedEvent(event) {
        const sessionKey = event.sessionId || "__unknown__";

        if (!seenSessions.has(sessionKey) && event.eventType !== "session/new") {
            enqueue({
                eventType: "session/new",
                sessionId: event.sessionId,
                timestamp: event.timestamp,
                status: "running",
            });
            seenSessions.add(sessionKey);
        }

        if (event.eventType === "session/new") {
            seenSessions.add(sessionKey);
            enqueue(event);
            return;
        }

        enqueue(event);
        if (event.eventType === "session/end") {
            seenSessions.delete(sessionKey);
        }
    }

    async function stopAndExit(code = 0) {
        shouldStop = true;
        if (flushTimer) clearTimeout(flushTimer);
        // Ensure we fully flush everything remaining
        while (flushInFlight || pending.length > 0) {
            if (!flushInFlight) await flushQueue();
            else await new Promise(r => setTimeout(r, 50));
        }
        process.exit(code);
    }

    process.on("SIGINT", () => void stopAndExit(0));
    process.on("SIGTERM", () => void stopAndExit(0));

    console.log(`Watching ACP via stdin as @${alias}`);
    console.log(`Cloud endpoint: ${cloudEndpoint}`);

    if (driveAcp) {
        if (!continuousDriveAcp) {
            try {
                const result = await runDrivenAcpSession({
                    alias,
                    agentCommand: driveAcpAgentCommand,
                    dbPath,
                    log,
                    handleParsedEvent,
                    taskBodyOverride,
                    mentionPreprocessEnabled,
                    cwd: customCwd,
                });
                console.log(`[drive-acp] completed session ${result.sessionId} for task: ${result.taskBody}`);
                await stopAndExit(0);
            } catch (error) {
                console.error(`[drive-acp] failed: ${error instanceof Error ? error.message : String(error)}`);
                await stopAndExit(1);
            }
            return;
        }

        if (queueTransport === "streamable-http") {
            const queueStreamEndpoint = `${server}/api/bridge/tasks?alias=${encodeURIComponent(alias)}&token=${encodeURIComponent(token)}`;
            console.log("[drive-acp] continuous mode enabled (transport streamable-http)");

            let reconnectAttempt = 0;
            let streamUnsupported = false;
            const seenQueueTaskIds = new Set();
            while (!shouldStop) {
                try {
                    const response = await fetch(queueStreamEndpoint, {
                        headers: {
                            Accept: "text/event-stream",
                        },
                    });

                    if (!response.ok) {
                        if (response.status === 401 || response.status === 403) {
                            console.error(`[drive-acp] Queue stream authentication/authorization failed (HTTP ${response.status}). Exiting.`);
                            await stopAndExit(1);
                            return;
                        }
                        if (response.status === 404 || response.status === 405 || response.status === 501) {
                            streamUnsupported = true;
                            break;
                        }
                        const body = await response.text().catch(() => "");
                        throw new Error(`HTTP ${response.status}${body ? `: ${body}` : ""}`);
                    }

                    reconnectAttempt = 0;
                    await readSseStream(response, async ({ event, data }) => {
                        if (shouldStop || event !== "task") return;

                        let payload;
                        try {
                            payload = JSON.parse(data);
                        } catch {
                            log("[drive-acp] ignored non-JSON task event");
                            return;
                        }

                        const taskBody = typeof payload?.taskBody === "string" ? payload.taskBody.trim() : "";
                        const taskId = typeof payload?.taskId === "string" ? payload.taskId.trim() : "";
                        if (!taskBody) {
                            log("[drive-acp] ignored empty task payload");
                            return;
                        }
                        if (taskId && seenQueueTaskIds.has(taskId)) {
                            log(`[drive-acp] skipped duplicate queued task ${taskId}`);
                            return;
                        }
                        if (taskId) {
                            seenQueueTaskIds.add(taskId);
                            if (seenQueueTaskIds.size > 5000) {
                                const first = seenQueueTaskIds.values().next().value;
                                if (first) seenQueueTaskIds.delete(first);
                            }
                        }

                        try {
                            const result = await runDrivenAcpSession({
                                alias,
                                agentCommand: driveAcpAgentCommand,
                                dbPath,
                                log,
                                handleParsedEvent,
                                taskBodyOverride: taskBody,
                                mentionPreprocessEnabled,
                                cwd: customCwd,
                            });
                            console.log(`[drive-acp] completed session ${result.sessionId} for task: ${result.taskBody}`);
                        } catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            if (message.includes("Missing ACP SDK dependency (@agentclientprotocol/sdk)")) {
                                console.error(`[drive-acp] failed: ${message}`);
                                await stopAndExit(1);
                                return;
                            }
                            console.error(`[drive-acp] failed: ${message}`);
                        }
                    });
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    reconnectAttempt += 1;
                    const waitMs = backoffMs(reconnectAttempt, 1000, 15000);
                    log(`[drive-acp] queue stream disconnected, reconnecting in ${waitMs}ms: ${message}`);
                    if (!shouldStop) await sleep(waitMs);
                }
            }

            if (streamUnsupported && !shouldStop) {
                console.warn("[drive-acp] queue stream endpoint unavailable on server, falling back to polling transport");
            } else {
                await stopAndExit(0);
                return;
            }
        }

        console.log(`[drive-acp] continuous mode enabled (poll ${pollMs}ms)`);
        while (!shouldStop) {
            let idle = false;
            try {
                const result = await runDrivenAcpSession({
                    alias,
                    agentCommand: driveAcpAgentCommand,
                    dbPath,
                    log,
                    handleParsedEvent,
                    mentionPreprocessEnabled,
                    cwd: customCwd,
                });
                console.log(`[drive-acp] completed session ${result.sessionId} for task: ${result.taskBody}`);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (message.includes("Missing ACP SDK dependency (@agentclientprotocol/sdk)")) {
                    console.error(`[drive-acp] failed: ${message}`);
                    await stopAndExit(1);
                    return;
                }
                if (message.includes("No active task found")) {
                    idle = true;
                    log("[drive-acp] idle; no active task");
                } else {
                    console.error(`[drive-acp] failed: ${message}`);
                }
            }

            if (shouldStop) break;
            await sleep(idle ? pollMs : 1000);
        }
        await stopAndExit(0);
        return;
    }

    const rl = readline.createInterface({
        input: process.stdin,
        crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
        log("[stdio] line", line);
        const events = parseMessage(line);
        log("[stdio] parsed events", events.length);
        for (const event of events) {
            handleParsedEvent(event);
        }
    });

    rl.on("close", async () => {
        // Wait until everything pending is successfully flushed
        while (flushInFlight || pending.length > 0) {
            if (!flushInFlight) await flushQueue();
            else await new Promise(r => setTimeout(r, 50));
        }
        if (shouldStop) {
            process.exit(1);
        } else {
            process.exit(0);
        }
    });
}

// ------------------------------------------------------------------------
// commandProxy: Transparent stdio bridge for local child processes
// ------------------------------------------------------------------------
async function commandProxy(rawArgs) {
    const args = parseArgs(rawArgs);
    const config = readConfig();

    const alias = `${args.alias || ""}`.trim();
    const token = `${args.token || config.token || ""}`.trim();
    const server = resolveServer(args, undefined, config.server || DEFAULTS.server);
    const agentCmd = `${args.agent || config.agent || "opencode acp"}`.trim();
    const verbose = Boolean(args.verbose);

    if (!alias) {
        console.error("Missing --alias <alias>.");
        process.exitCode = 1;
        return;
    }
    if (!token) {
        console.error("Missing token. Use --token <token> or run `kronos login` first.");
        process.exitCode = 1;
        return;
    }

    const skipServer = rawArgs.includes("--no-server") || args["no-server"];
    if (!skipServer && !(await isServerReachable(server))) {
        const ensure = await ensureServerRunning({
            server,
            mode: resolveServerMode(args, rawArgs),
            log: (m) => { if (verbose) console.error(m); },
        });
        if (ensure.error) {
            console.error(`[kronos] ${ensure.message || `dev server unreachable: ${ensure.error}`}`);
            process.exitCode = 1;
            return;
        }
        if (verbose) {
            console.error(`[kronos] using dev server at ${ensure.server} (via ${ensure.runner}).`);
        }
    }

    // Split the agent command into binary and arguments
    const cmdParts = agentCmd.split(" ");
    const binary = cmdParts[0];
    const binaryArgs = cmdParts.slice(1);

    const log = (...parts) => {
        if (verbose) console.error("[bridge]", ...parts);
    };

    const cloudEndpoint = `${server}/api/acp/events`;
    const pending = [];
    let flushInFlight = false;
    let shouldStop = false;

    // Flush logic using modern fetch (Node 18+) for Next.js API compatibility
    async function postCloudEvent(event) {
        // Enforce IPv4 on Windows to prevent Node 18+ fetch from failing on ::1 IPv6 localhost
        const safeEndpoint = cloudEndpoint.replace('localhost', '127.0.0.1');

        const payload = {
            eventType: event.eventType,
            alias,
            token,
        };
        if (event.sessionId) payload.sessionId = event.sessionId;
        if (event.status) payload.status = event.status;
        if (event.latestAgentMessage) payload.latestAgentMessage = event.latestAgentMessage;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        try {
            log("Sending to cloud:", payload);
            const res = await fetch(safeEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });

            if (!res.ok) {
                const text = await res.text().catch(() => "");
                throw new Error(`HTTP ${res.status} ${text}`);
            }
        } finally {
            clearTimeout(timeout);
        }
    }

    async function flushQueue() {
        if (flushInFlight || pending.length === 0) return;
        flushInFlight = true;
        try {
            while (pending.length > 0) {
                const event = pending[0];
                try {
                    await postCloudEvent(event);
                    pending.shift();
                } catch (err) {
                    log("Failed to forward event to cloud:", err.message);
                    if (!shouldStop) {
                        await sleep(2000); // Wait before retrying if not stopping
                        break;
                    } else {
                        // If stopping, drop the failed event and continue flushing the rest
                        pending.shift();
                    }
                }
            }
        } finally {
            flushInFlight = false;
        }
    }

    const enqueue = (event) => {
        pending.push(event);
        flushQueue();
    };

    log(`Spawning agent: ${binary} ${binaryArgs.join(" ")}`);
    const child = spawn(binary, binaryArgs, {
        stdio: ['pipe', 'pipe', 'pipe']
    });
    activeAgentChild = child;

    // 1. Transparent Pipe: Parent Stdin -> Child Stdin
    process.stdin.pipe(child.stdin);

    // 2. Transparent Pipe: Child Stderr -> Parent Stderr
    child.stderr.pipe(process.stderr);

    // 3. Transparent Pipe: Child Stdout -> Parent Stdout (AND TAP FOR ACP EVENTS)
    let buffer = "";
    child.stdout.on('data', (chunk) => {
        // Send directly to the parent stdout natively for the editor to read
        process.stdout.write(chunk);

        // Tap the stream and extract events
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');

        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || "";

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const parsed = JSON.parse(line);
                const event = parseIncomingPayload(parsed);
                if (event) {
                    log("Tapped local event:", event);
                    enqueue(event);
                }
            } catch (e) {
                // Not a JSON line, normal agent output, ignore
            }
        }
    });

    // Handle exiting gracefully
    child.on('error', (err) => {
        console.error(`Failed to start subprocess: ${err.message}`);
        process.exitCode = 1;
    });

    child.on('exit', async (code) => {
        log(`Agent subprocess exited with code ${code}`);
        shouldStop = true;
        if (activeAgentChild === child) activeAgentChild = null;

        // One final flush attempt
        while (flushInFlight || pending.length > 0) {
            await flushQueue();
            if (pending.length > 0) await sleep(500);
        }

        process.exitCode = code || 0;
    });
}

// ------------------------------------------------------------------------
// All-in-one supervisor commands (server + worker)
// ------------------------------------------------------------------------
async function commandServe(rawArgs) {
    const args = parseArgs(rawArgs);
    const config = readConfig();
    const server = resolveServer(args, undefined, config.server || DEFAULTS.server);

    if (args.help || args.h) {
        console.log(`kronos serve

Start the Kronos Next.js dev server and block until killed.

Auto-discovers the kronos checkout by walking up from the current directory,
honoring KRONOS_INSTALL_DIR, or walking up from the binary's own path.

Uses \`bun run start\` (or \`npm run start\` if bun is unavailable), auto-running
\`build\` first when \`.next/\` is missing. Pass --dev for \`next dev\` (HMR).

Options:
  --server <url>  override the server URL (default: ${DEFAULTS.server})
  --mode prod|dev default prod (use built bundle); --dev for HMR
  --no-server     skip auto-bootstrap (assume server is already running)

Spawns the start script in the detected checkout, waits for /api/health to
respond, then blocks. Ctrl+C stops the worker and the server.
`);
        return;
    }

    console.log(`[kronos] serve → ensuring ${server} is reachable...`);
    const skipServer = rawArgs.includes("--no-server") || args["no-server"];
    let ensure = { alreadyRunning: true, server };
    if (!skipServer) {
        ensure = await ensureServerRunning({
            server,
            mode: resolveServerMode(args, rawArgs),
            log: (m) => console.log(m),
        });
        if (ensure.error) {
            console.error(`[kronos] ${ensure.message || ensure.error}`);
            process.exitCode = 1;
            return;
        }
    }

    console.log(`[kronos] server up at ${ensure.server}. Ctrl+C to stop.`);
    await new Promise(() => {});
}

async function commandUp(rawArgs) {
    const args = parseArgs(rawArgs);
    const config = readConfig();
    const server = resolveServer(args, undefined, config.server || DEFAULTS.server);

    if (args.help || args.h) {
        console.log(`kronos up

Start the dev server (if not already running) AND the agent worker in one command.

\`\`\`
$ kronos up --alias my-agent    # production start + worker
$ kronos up --alias my-agent --dev  # next dev (HMR) + worker
\`\`\`

Server mode:
  - default: \`bun run start\` (or \`npm run start\`); auto-runs \`bun run build\`
    first if \`.next/\` is absent.
  - --dev:   \`bun run dev\` for HMR.

Options:
  --server <url>   override the server URL
  --alias <alias>  alias to consume
  --mode prod|dev  default prod
  --no-server      skip auto-bootstrap
  See \`kronos agent --help\` for full agent options.
`);
        return;
    }

    const skipServer = rawArgs.includes("--no-server") || args["no-server"];
    if (!skipServer) {
        const ensure = await ensureServerRunning({
            server,
            mode: resolveServerMode(args, rawArgs),
            log: (m) => console.log(m),
        });
        if (ensure.error) {
            console.error(`[kronos] ${ensure.message || ensure.error}`);
            process.exitCode = 1;
            return;
        }
        if (ensure.spawned) console.log(`[kronos] dev server spawned via ${ensure.runner} in ${ensure.checkout}.`);
        else if (ensure.alreadyRunning) console.log(`[kronos] using existing server at ${ensure.server}.`);
    }

    await commandWatchStdio([
        "--drive-acp",
        "--continuous",
        "--queue-transport",
        "streamable-http",
        ...rawArgs,
    ]);
}

async function commandDown(rawArgs) {
    const args = parseArgs(rawArgs);
    if (args.help || args.h) {
        console.log(`kronos down

Stop a dev server spawned by this CLI process. If the dev server was spawned in
a different terminal, you'll need to stop it manually (taskkill / kill).

On Windows, kills the entire process tree spawned by \`npm run dev\`.
`);
        return;
    }
    if (!spawnedDevServer) {
        console.log("[kronos] no spawned dev server in this process. If you started it elsewhere:");
        console.log("  Windows : taskkill /im node.exe | findstr /i kronos  (or use Task Manager)");
        console.log("  Unix    : ps -ef | grep 'npm run dev'");
        return;
    }
    console.log(`[kronos] stopping dev server (pid ${spawnedDevServer.pid})...`);
    killSpawnedDevServer();
    await sleep(1500);
    if (spawnedDevServer.exitCode === null) {
        console.log("[kronos] giving it 5 more seconds, then SIGKILL fallback.");
        try { spawnedDevServer.kill("SIGKILL"); } catch { /* ignore */ }
    } else {
        console.log(`[kronos] dev server exited with code ${spawnedDevServer.exitCode}.`);
    }
}


async function main() {
    const [, , command, ...rawArgs] = process.argv;
    if (!command || command === "help" || command === "--help" || command === "-h") {
        printHelp();
        return;
    }

    if (command === "--version" || command === "-V" || command === "version") {
        console.log(`kronos ${VERSION}`);
        return;
    }

    if (command === "setup") {
        await commandSetup(rawArgs);
        return;
    }

    if (command === "up") {
        await commandUp(rawArgs);
        return;
    }

    if (command === "serve") {
        await commandServe(rawArgs);
        return;
    }

    if (command === "down") {
        await commandDown(rawArgs);
        return;
    }

    if (command === "login") {
        await commandLogin(rawArgs);
        return;
    }

    if (command === "watch-stdio") {
        await commandWatchStdio(rawArgs);
        return;
    }

    if (command === "watch-queue") {
        await commandWatchStdio(["--drive-acp", "--continuous", "--queue-transport", "streamable-http", ...rawArgs]);
        return;
    }

    if (command === "agent") {
        await commandWatchStdio([
            "--drive-acp",
            "--continuous",
            "--queue-transport",
            "streamable-http",
            ...rawArgs,
        ]);
        return;
    }

    if (command === "proxy") {
        await commandProxy(rawArgs);
        return;
    }

    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exitCode = 1;
}

main().catch((err) => {
    console.error("[kronos] Fatal error:", err.message || err);
    process.exit(1);
});

module.exports = {
    parseArgs,
    readConfig,
    writeConfig,
    normalizeServer,
    toIsoTimestamp,
    normalizeEventType,
    parseIncomingPayload,
    parseMessage,
    backoffMs,
    fetchPendingTaskForAlias,
    runDrivenAcpSession,
    promptToken,
    commandSetup,
    commandUp,
    commandServe,
    commandDown,
    commandLogin,
    commandWatchStdio,
    commandProxy,
    main,
    // helpers (also used internally)
    openUrl,
    sanitiseAlias,
    probeServer,
    fetchAgentAliases,
    ensureAgentAlias,
    pickAlias,
    promptWithDefault,
    loadClackPrompts,
    findKronosCheckout,
    isServerReachable,
    ensureServerRunning,
    killSpawnedDevServer,
    detectPackageRunner,
    resolveServerMode,
    runRunnerAwait,
};

