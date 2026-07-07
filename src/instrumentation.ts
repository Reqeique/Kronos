import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { ensurePrismaReady } from "@/lib/prisma";
import { startScheduler } from "@/lib/scheduler";

// Install EPIPE protection before any other dependency writes to the
// console. The module is side-effecting; importing it once is sufficient.
import "@/lib/epipeGuard";

function writeBootMarker(line: string): void {
    try {
        const dir =
            process.env.KRONOS_INSTRUMENTATION_LOG_DIR ||
            (process.env.KRONOS_LOG_DIR ? process.env.KRONOS_LOG_DIR : "");
        if (!dir) return;
        const abs = resolve(dir);
        mkdirSync(abs, { recursive: true });
        appendFileSync(join(abs, "instrumentation.log"), `${new Date().toISOString()} ${line}\n`);
    } catch {
        /* best effort */
    }
}

writeBootMarker(
    `register() invoked NEXT_RUNTIME=${process.env.NEXT_RUNTIME || "<unset>"}`,
);

export async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs") {
        writeBootMarker(`register() skipped - runtime=${process.env.NEXT_RUNTIME}`);
        return;
    }
    if (process.env.NEXT_RUNTIME_KRONOS_SCHEDULER === "0") {
        writeBootMarker("register() skipped - opt-out via env");
        return;
    }
    try {
        await ensurePrismaReady();
        writeBootMarker("ensurePrismaReady() ok");
        startScheduler();
        writeBootMarker("startScheduler() invoked");
    } catch (err) {
        writeBootMarker(
            `register() error: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
    }
}
