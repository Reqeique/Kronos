/**
 * Global EPIPE protection for the Next.js dev server.
 *
 * Symptom (reproduced on a fresh working directory + detached terminal):
 *   - server runs as an orphaned process whose stdout FD pipe has already
 *     been closed by the original terminal session.
 *   - a downstream dependency writes a console warning (the prime offender is
 *     `next-auth` emitting `[auth][warn] NO_SECRET` when `NEXTAUTH_SECRET`
 *     is missing from process.env).
 *   - the write raises an uncaughtException with code = "EPIPE".
 *   - Without this guard, Next.js' request handler dies mid-flight, leaving
 *     the HTTP response socket open.  The browser hangs forever ("freeze").
 *
 * Fix:
 *   1. Override `process.stdout.write` and `process.stderr.write` so the
 *      broken FD is treated as silent (returns true and emits the returned
 *      callback's EPIPE without bubbling). Writes are mirrored to
 *      `${KRONOS_LOG_DIR}/kronos-current.log` so nothing is lost.
 *   2. Install a `process.on("uncaughtException")` listener that ignores
 *      `EPIPE` codes so request handlers do not get torn down by stray
 *      console output.
 *
 * Side effect: anything written to stdout/stderr after the pipe died is
 * captured to the fallback log file instead. This file persists across
 * the dev-server run so users can paste it for debugging.
 *
 * Idempotent: safe to call multiple times; install is gated via a flag on
 * `globalThis` to avoid listener leaks during dev-server HMR.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type TagsWithGuard = typeof globalThis & {
    __kronosEpipeGuardInstalled?: boolean;
};

function isEpipe(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    return (err as { code?: string }).code === "EPIPE";
}

function getFallbackPath(): string | null {
    const dir = process.env.KRONOS_LOG_DIR;
    if (!dir || !dir.trim()) return null;
    try {
        const abs = resolve(dir);
        mkdirSync(abs, { recursive: true });
        return join(abs, "kronos-current.log");
    } catch {
        return null;
    }
}

function writeFallback(line: string | Uint8Array): void {
    if (process.env.NODE_ENV === "test" && process.env.KRONOS_TEST_ALLOW_FALLBACK !== "1") return;
    const target = getFallbackPath();
    if (!target) return;
    try {
        mkdirSync(dirname(target), { recursive: true });
        const text = typeof line === "string" ? line : Buffer.from(line).toString("utf8");
        appendFileSync(target, text, { encoding: "utf8" });
    } catch {
        /* swallow */
    }
}

export function installEpipeGuard(): void {
    const g = globalThis as TagsWithGuard;
    if (g.__kronosEpipeGuardInstalled) return;
    g.__kronosEpipeGuardInstalled = true;

    const origStdoutWrite = process.stdout.write.bind(process.stdout);
    const origStderrWrite = process.stderr.write.bind(process.stderr);

    const wrap =
        (
            original: (chunk: string | Uint8Array, ...rest: unknown[]) => boolean,
            markDead: () => void,
            isDeadRef: { dead: boolean },
        ) =>
        (chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
            if (isDeadRef.dead) {
                writeFallback(chunk);
                return true;
            }
            try {
                return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
            } catch (err) {
                if (isEpipe(err)) {
                    isDeadRef.dead = true;
                    markDead();
                    writeFallback(chunk);
                    return true;
                }
                throw err;
            }
        };

    const stdoutDeadRef = { dead: false };
    const stderrDeadRef = { dead: false };

    const wrappedStdout = wrap(
        (chunk: string | Uint8Array, ...rest: unknown[]): boolean =>
            (origStdoutWrite as (c: string | Uint8Array, ...r: unknown[]) => boolean)(chunk, ...rest),
        () => {},
        stdoutDeadRef,
    );
    const wrappedStderr = wrap(
        (chunk: string | Uint8Array, ...rest: unknown[]): boolean =>
            (origStderrWrite as (c: string | Uint8Array, ...r: unknown[]) => boolean)(chunk, ...rest),
        () => {},
        stderrDeadRef,
    );

    (process.stdout.write as unknown) = wrappedStdout;
    (process.stderr.write as unknown) = wrappedStderr;

    // Expose current wrapped functions for test inspection.
    (g as { __kronosStdoutWrite?: typeof wrappedStdout }).__kronosStdoutWrite = wrappedStdout;
    (g as { __kronosStderrWrite?: typeof wrappedStderr }).__kronosStderrWrite = wrappedStderr;
    (g as { __kronosStdoutDeadRef?: typeof stdoutDeadRef }).__kronosStdoutDeadRef = stdoutDeadRef;
    (g as { __kronosStderrDeadRef?: typeof stderrDeadRef }).__kronosStderrDeadRef = stderrDeadRef;

    process.on("uncaughtException", (err) => {
        if (isEpipe(err)) {
            stdoutDeadRef.dead = true;
            stderrDeadRef.dead = true;
            return;
        }
        // re-surface other uncaught exceptions via stderr after restoring the original
        try {
            origStderrWrite(String(err) + "\n");
        } catch {
            writeFallback(String(err) + "\n");
        }
    });
}

let autoInstalled = false;
export function autoInstallEpipeGuard(): void {
    if (autoInstalled) return;
    autoInstalled = true;
    try {
        installEpipeGuard();
    } catch {
        /* ignore */
    }
}

autoInstallEpipeGuard();
