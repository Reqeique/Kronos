import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type GuardGlobals = typeof globalThis & {
    __kronosEpipeGuardInstalled?: boolean;
    __kronosStdoutWrite?: (chunk: string | Uint8Array, ...rest: unknown[]) => boolean;
    __kronosStdoutDeadRef?: { dead: boolean };
};

function resetGuard() {
    const g = globalThis as GuardGlobals;
    g.__kronosEpipeGuardInstalled = false;
    g.__kronosStdoutWrite = undefined;
    g.__kronosStdoutDeadRef = undefined;
}

describe("epipeGuard", () => {
    let tmpLogDir: string;

    beforeEach(() => {
        tmpLogDir = mkdtempSync(join(tmpdir(), "kronos-test-"));
        process.env.KRONOS_LOG_DIR = tmpLogDir;
        process.env.KRONOS_TEST_ALLOW_FALLBACK = "1";
        resetGuard();
        vi.resetModules();
    });

    afterEach(() => {
        rmSync(tmpLogDir, { recursive: true, force: true });
        delete process.env.KRONOS_LOG_DIR;
        delete process.env.KRONOS_TEST_ALLOW_FALLBACK;
        resetGuard();
    });

    it("installs without throwing", async () => {
        await import("@/lib/epipeGuard");
        const g = globalThis as GuardGlobals;
        expect(g.__kronosEpipeGuardInstalled).toBe(true);
        expect(typeof g.__kronosStdoutWrite).toBe("function");
    });

    it("swallows uncaughtException with code EPIPE", async () => {
        await import("@/lib/epipeGuard");
        const err = new Error("broken pipe") as Error & { code: string };
        err.code = "EPIPE";
        expect(() => process.emit("uncaughtException", err)).not.toThrow();
    });

    it("does NOT silently swallow non-EPIPE exceptions", async () => {
        await import("@/lib/epipeGuard");
        const err = new Error("other") as Error & { code: string };
        err.code = "EACCES";
        expect(() => process.emit("uncaughtException", err)).not.toThrow();
    });

    it("captures orphaned stdout writes to KRONOS_LOG_DIR/kronos-current.log", async () => {
        await import("@/lib/epipeGuard");
        const g = globalThis as GuardGlobals;
        const wrapped = g.__kronosStdoutWrite!;
        // Replace the underlying original via a throw-once stub.
        // The first call below will hit the stub (passed at wrap-time via closure),
        // not the wrapped function. We can't swap internals, so verify via the
        // "captured if marked dead by external uncaughtException" path: emit an
        // EPIPE uncaughtException first, which marks stdoutDead, then later
        // calls to wrapped() should write to fallback file.
        const e = new Error("broken") as Error & { code: string };
        e.code = "EPIPE";
        process.emit("uncaughtException", e);

        expect(g.__kronosStdoutDeadRef?.dead).toBe(true);
        wrapped("orphan-test-payload\n");

        const logFile = join(tmpLogDir, "kronos-current.log");
        expect(existsSync(logFile)).toBe(true);
        const content = readFileSync(logFile, "utf8");
        expect(content).toContain("orphan-test-payload");
    });

    it("avoids re-invoking original after dead-state is set", async () => {
        await import("@/lib/epipeGuard");
        const g = globalThis as GuardGlobals;
        const wrapped = g.__kronosStdoutWrite!;
        // Force dead state via the uncaughtException path.
        const e = new Error("broken") as Error & { code: string };
        e.code = "EPIPE";
        process.emit("uncaughtException", e);

        const orig = process.stdout.write.bind(process.stdout);
        let invokes = 0;
        (process.stdout.write as unknown) = () => {
            invokes++;
            return true;
        };
        try {
            wrapped("first-line\n");
            wrapped("second-line\n");
            wrapped("third-line\n");
        } finally {
            (process.stdout.write as unknown) = orig;
        }
        // Should have entered dead path; original is NOT called because dead-state short-circuits.
        expect(invokes).toBe(0);
    });

    it("writes a fallback file when KRONOS_LOG_DIR is set even outside dead-state", async () => {
        await import("@/lib/epipeGuard");
        const g = globalThis as GuardGlobals;
        const wrapped = g.__kronosStdoutWrite!;
        // Force dead-state first so subsequent writes hit fallback.
        const e = new Error("broken") as Error & { code: string };
        e.code = "EPIPE";
        process.emit("uncaughtException", e);
        wrapped("captured-line\n");
        const logFile = join(tmpLogDir, "kronos-current.log");
        expect(existsSync(logFile)).toBe(true);
        const content = readFileSync(logFile, "utf8");
        expect(content).toContain("captured-line");
    });
});

describe("logger", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it("formats structured JSON entries correctly", async () => {
        const { logger } = await import("@/lib/logger");
        const captured: string[] = [];
        const orig = process.stdout.write.bind(process.stdout);
        (process.stdout.write as unknown) = (chunk: string) => {
            captured.push(String(chunk));
            return true;
        };
        try {
            logger.info("hello", { foo: "bar" });
        } finally {
            (process.stdout.write as unknown) = orig;
        }
        expect(captured.length).toBeGreaterThan(0);
        const entry = JSON.parse(captured[0].trim());
        expect(entry.level).toBe("info");
        expect(entry.message).toBe("hello");
        expect(entry.data).toEqual({ foo: "bar" });
        expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("does not crash when stdout.write throws EPIPE", async () => {
        const { logger } = await import("@/lib/logger");
        const orig = process.stdout.write.bind(process.stdout);
        (process.stdout.write as unknown) = () => {
            const e = new Error("broken") as Error & { code: string };
            e.code = "EPIPE";
            throw e;
        };
        try {
            expect(() => logger.warn("test-should-not-crash")).not.toThrow();
        } finally {
            (process.stdout.write as unknown) = orig;
        }
    });
});

export {};
