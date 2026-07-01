#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const { Readable, Writable } = require("node:stream");
const { setTimeout: sleep } = require("node:timers/promises");
const BetterSqlite3 = require("better-sqlite3");

const DEFAULT_SERVER = process.env.KRONOS_API_BASE_URL || "http://localhost:3000";
const CONFIG_DIR = path.join(os.homedir(), ".kronos");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

function printHelp() {
    console.log(`kronos CLI

Usage:
  kronos login --token <token> [--server <url>]
  kronos proxy --agent <"command"> --alias <alias> [--token <token>] [--server <url>]
  kronos watch-stdio --alias <alias> [--token <token>] [--server <url>] [--drive-acp] [--agent <"command">] [--cwd <path>]
  kronos watch-queue --alias <alias> [--token <token>] [--server <url>] --agent <"command"> [--queue-transport <streamable-http|polling>] [--poll-ms <n>] [--no-mention-preprocess] [--cwd <path>]

Notes:
  - login stores token/server in ~/.kronos/config.json
  - proxy spawns an agent as a subprocess and taps its stdio layer transparently
  - watch-stdio reads ACP NDJSON events from stdin and forwards to /api/acp/events
  - watch-stdio --drive-acp runs an ACP client loop against --agent and forwards lifecycle events
  - watch-queue is a persistent task consumer (streamable-http by default; polling optional)
  - by default, @file mentions in task prompts are autocompleted to project paths before sending to ACP
  - token can be provided by --token or saved via login
  - The --cwd option (or --work-dir) changes the directory used for mention resolution and agent execution (defaults to process.cwd())
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

function fetchPendingTaskForAlias(alias, dbPathInput, currentDir) {
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
        : fetchPendingTaskForAlias(alias, dbPath, rootDir);
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

    let childExited = false;
    child.on("exit", () => {
        childExited = true;
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

                for (;;) {
                    const message = await session.nextUpdate();
                    if (message.kind === "stop") break;
                    // Forward agent message chunks to the cloud
                    if (message.kind === "session_update") {
                        const update = message.update;
                        const updateType = update?.sessionUpdate || update?.type;
                        if (updateType === "agent_message_chunk" || updateType === "message_chunk") {
                            const text = update?.content?.text || (typeof update?.content === "string" ? update.content : "") || "";
                            if (typeof text === "string" && text.trim()) {
                                handleParsedEvent({
                                    eventType: "session/prompt",
                                    sessionId,
                                    timestamp: new Date().toISOString(),
                                    latestAgentMessage: text.trim(),
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

    const alias = `${args.alias || positionalAlias || ""}`.trim();
    const token = `${args.token || positionalToken || config.token || ""}`.trim();
    const server = normalizeServer(
        typeof args.server === "string"
            ? args.server
            : (positionalServer || config.server),
    );
    const verbose = Boolean(args.verbose);
    const driveAcp = Boolean(args["drive-acp"]);
    const continuousDriveAcp = Boolean(args.continuous || args.loop || args["watch-queue"]);
    const driveAcpAgentCommand = typeof args.agent === "string"
        ? args.agent
        : (typeof args["agent-cmd"] === "string"
            ? args["agent-cmd"]
            : `${process.env.KRONOS_ACP_AGENT_CMD || ""}`.trim());
    const rawPollMs = Number(args["poll-ms"] ?? args.interval ?? 3000);
    const pollMs = Number.isFinite(rawPollMs) ? Math.max(500, Math.floor(rawPollMs)) : 3000;
    const queueTransportRaw = `${args["queue-transport"] || args.transport || ""}`.trim().toLowerCase();
    const queueTransport = ["polling", "streamable-http"].includes(queueTransportRaw)
        ? queueTransportRaw
        : "polling";
    const dbPath = typeof args["db-path"] === "string" ? args["db-path"] : undefined;
    const taskBodyOverride = typeof args["task-body-override"] === "string" ? args["task-body-override"] : undefined;
    const mentionPreprocessEnabled = !Boolean(args["no-mention-preprocess"]);
    const customCwd = typeof args.cwd === "string" ? args.cwd : (typeof args["work-dir"] === "string" ? args["work-dir"] : undefined);

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
    if (driveAcp && !driveAcpAgentCommand) {
        console.error("Missing --agent <\"command\"> for --drive-acp (or set KRONOS_ACP_AGENT_CMD).");
        process.exitCode = 1;
        return;
    }

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

    async function flushQueue() {
        if (flushInFlight) return;
        flushInFlight = true;
        try {
            while (pending.length > 0) {
                // If stopped and not graceful, optionally break
                // But generally better to flush everything before exit!
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
                    const waitMs = backoffMs(flushFailureCount);
                    log("[cloud] send failed, retrying in ms", waitMs, String(error));
                    scheduleFlush(waitMs);
                    return;
                }
            }
        } finally {
            flushInFlight = false;
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
    const server = normalizeServer(args.server || config.server);
    const agentCmd = `${args.agent || ""}`.trim();
    const verbose = Boolean(args.verbose);

    if (!agentCmd) {
        console.error("Missing --agent <command> e.g. --agent \"claude-code\"");
        process.exitCode = 1;
        return;
    }
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

    // We start the child process natively
    log(`Spawning agent: ${binary} ${binaryArgs.join(" ")}`);
    const child = spawn(binary, binaryArgs, {
        stdio: ['pipe', 'pipe', 'pipe']
    });

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

        // One final flush attempt
        while (flushInFlight || pending.length > 0) {
            await flushQueue();
            if (pending.length > 0) await sleep(500);
        }

        process.exitCode = code || 0;
    });
}

async function main() {
    const [, , command, ...rawArgs] = process.argv;
    if (!command || command === "help" || command === "--help" || command === "-h") {
        printHelp();
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

    if (command === "proxy") {
        await commandProxy(rawArgs);
        return;
    }

    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exitCode = 1;
}

void main();

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
    commandLogin,
    commandWatchStdio,
    commandProxy,
    main,
};

