import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import prisma from "./prisma";
import { dispatchTaskMessage } from "./slack";
import logger from "./logger";
import eventBus from "./eventBus";
import { SchedulerHeap } from "./schedulerHeap";
import { buildLifecycleUpdate, getEffectiveActiveDurationMs } from "./taskRunLifecycle";

// Direct file diagnostics — bypasses stdout/stderr/logger entirely so we can
// always see what the scheduler is doing, even when the parent pipe is dead.
// The same KRONOS_LOG_DIR fallback file that epipeGuard uses.
const BOOT_LOG_PATH =
    process.env.KRONOS_SCHEDULER_BOOT_LOG ||
    (process.env.KRONOS_LOG_DIR
        ? `${process.env.KRONOS_LOG_DIR.replace(/[\\/]+$/, "")}/scheduler-boot.log`
        : null);
function bootDiag(line: string): void {
    if (!BOOT_LOG_PATH) return;
    if (process.env.NODE_ENV === "test" && process.env.KRONOS_TEST_ALLOW_FALLBACK !== "1") return;
    try {
        mkdirSync(dirname(BOOT_LOG_PATH), { recursive: true });
        appendFileSync(BOOT_LOG_PATH, `${new Date().toISOString()} ${line}\n`);
    } catch {
        /* swallow */
    }
}

// EPIPE-safe logging wrapper. On Windows with an orphaned stdout pipe (detached
// terminal, killed parent), process.stdout.write throws EPIPE. On some Node
// versions this is synchronous (caught by try/catch below); on others it's
// emitted asynchronously as uncaughtException (caught by the dedicated
// handler installed at module load). Either way, logging must NEVER abort
// scheduler logic (boot, arm, dispatch).
type LogFn = (msg: string, data?: Record<string, unknown>) => void;
const safeLog: Record<"info" | "warn" | "error", LogFn> = {
    info: (msg, data) => { try { logger.info(msg, data); } catch { /* EPIPE — swallow */ } },
    warn: (msg, data) => { try { logger.warn(msg, data); } catch { /* EPIPE — swallow */ } },
    error: (msg, data) => { try { logger.error(msg, data); } catch { /* EPIPE — swallow */ } },
};

// Install a scheduler-local uncaughtException guard so async EPIPE from logger
// writes (which escape try/catch) cannot tear down the process during boot
// or dispatch. The epipeGuard in instrumentation.ts does the same, but Next.js
// bundle-realm isolation can prevent it from intercepting this chunk's writes.
let epitGuardInstalled = false;
function installSchedEpipeGuard(): void {
    if (epitGuardInstalled) return;
    epitGuardInstalled = true;
    process.on("uncaughtException", (err: unknown) => {
        if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "EPIPE") {
            safeLog.warn("EPIPE swallowed by scheduler guard", {});
            return;
        }
        throw err;
    });
}
installSchedEpipeGuard();

// ─── Adaptive scheduler ──────────────────────────────────
// Replaces the fixed 30s `setInterval` that scanned every SCHEDULED (and
// IN_PROGRESS/WAITING) row on each tick. A min-heap keyed by next-fire-time
// is hydrated from the DB on boot and kept in sync as tasks are created via
// `notifyScheduled()`. The scheduler arms a single `setTimeout` to the
// nearest entry's `scheduledAt`, so it only wakes when something is actually
// due — O(1) peek, O(log S) push/pop — instead of O(S) per tick.
//
// Stale entries (a task whose status changed before its due time, e.g. it was
// dispatched early, deleted, or already completed) are skipped lazily: the DB
// is re-checked at pop time, so the heap never causes a wrong dispatch.

const MAX_TIMER_MS = 2 ** 31 - 1; // setTimeout clamp on most engines
const REARM_GREACE_MS = 0; // 0 = fire exactly at deadline. Non-zero causes a spin loop
const TIMEOUT_FALLBACK_MS = 30_000; // sweep bound when running tasks lack a deadline

let running = false;
let dueHeap: SchedulerHeap | null = null;
let dueTimer: ReturnType<typeof setTimeout> | null = null;
let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
let firing = false;

const isRunning = (): boolean => running;

export function startScheduler(_intervalMs = 30_000): void {
    bootDiag(`startScheduler() enter; running=${running} dueHeap=${!!dueHeap}`);

    // If we already have a heap, keep using it. Otherwise create it RIGHT NOW
    // and arm the timer BEFORE doing anything else. Lessons learned:
    //   - safeLog can silently swallow EPIPE, so we can't trust it for boot.
    //   - bootDiag goes to a file, so we always know if we got here.
    if (running && dueHeap) {
        bootDiag("startScheduler() already booted, no-op");
        return;
    }

    running = true;
    dueHeap = new SchedulerHeap();
    armDue();
    armTimeoutWatchdog();

    bootDiag("startScheduler() armed sync timer; heap initialized");
    safeLog.info("Scheduler started (adaptive heap)");
    void boot();
}

async function boot(): Promise<void> {
    bootDiag("boot() enter");
    if (!dueHeap) {
        bootDiag("boot() aborted - dueHeap is null");
        return;
    }
    try {
        const scheduled = await prisma.taskRun.findMany({
            where: { status: "SCHEDULED" },
            select: { id: true, scheduledAt: true },
        });
        bootDiag(`boot() hydrated ${scheduled.length} tasks from DB`);
        for (const t of scheduled) {
            dueHeap.push({ id: t.id, at: t.scheduledAt.getTime() });
        }
        safeLog.info("Scheduler heap hydrated", { count: dueHeap.size });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        bootDiag(`boot() hydration FAILED: ${msg}`);
        safeLog.error("Scheduler hydration failed", { error: msg });
    } finally {
        armDue();
        bootDiag(`boot() complete; dueHeap.size=${dueHeap.size} peek=${JSON.stringify(dueHeap.peek() ?? null)}`);
    }
}

/** Notify the scheduler that a new (or rescheduled) task is due at `scheduledAtMs`. */
export function notifyScheduled(taskId: string, scheduledAtMs: number): void {
    if (!running) {
        // Cold path: scheduler never started. Kick a synchronous arm. This
        // path matters in tests/CLI where instrumentation.register() has not
        // booted us yet.
        startScheduler();
        if (!dueHeap) return; // arm failed; give up rather than recurse
    } else if (!dueHeap) {
        startScheduler();
        if (!dueHeap) return;
    }
    dueHeap.push({ id: taskId, at: scheduledAtMs });
    rearmIfEarlier(scheduledAtMs);
}

function armDue(): void {
    if (dueTimer) {
        clearTimeout(dueTimer);
        dueTimer = null;
    }
    if (!running || !dueHeap) return;

    const next = dueHeap.peek();
    if (!next) {
        // Nothing pending: park indefinitely; notifyScheduled() re-arms.
        dueTimer = setTimeout(() => void fireDue(), MAX_TIMER_MS);
        return;
    }

    const delay = Math.max(0, next.at - Date.now()) - REARM_GREACE_MS;
    dueTimer = setTimeout(() => void fireDue(), Math.min(Math.max(delay, 0), MAX_TIMER_MS));
}

function rearmIfEarlier(scheduledAtMs: number): void {
    const next = dueHeap?.peek();
    if (!next || scheduledAtMs <= next.at) {
        armDue();
    }
}

async function fireDue(): Promise<void> {
    if (firing || !running || !dueHeap) {
        armDue();
        return;
    }
    firing = true;
    try {
        const now = Date.now();
        const due = dueHeap.popDue(now);
        for (const entry of due) {
            try {
                await dispatchScheduledTask(entry.id, new Date(entry.at));
            } catch (err) {
                safeLog.error("Error dispatching individual task in fireDue", {
                    taskId: entry.id,
                    error: err instanceof Error ? err.message : String(err),
                });
                // Re-push so the entry isn't lost from a sibling dispatch failure.
                dueHeap?.push({ id: entry.id, at: entry.at });
            }
        }
    } catch (err) {
        safeLog.error("Scheduler fire error", { error: String(err) });
    } finally {
        firing = false;
        armDue();
    }
}

async function dispatchScheduledTask(taskId: string, scheduledAt: Date): Promise<void> {
    try {
        const task = await prisma.taskRun.findUnique({
            where: { id: taskId },
            include: { agent: true, user: true },
        });

        if (!task || task.status !== "SCHEDULED") return;
        if (task.scheduledAt.getTime() > Date.now()) {
            dueHeap?.push({ id: taskId, at: task.scheduledAt.getTime() });
            return;
        }
        if (task.scheduledAt.getTime() !== scheduledAt.getTime() && task.scheduledAt.getTime() > scheduledAt.getTime()) {
            dueHeap?.push({ id: taskId, at: task.scheduledAt.getTime() });
            return;
        }

        if (task.schedulingMode === "OBSERVED") {
            const observedUpdate = await prisma.taskRun.update({
                where: { id: task.id },
                data: buildLifecycleUpdate(task, "DISPATCHED", scheduledAt),
            });
            eventBus.emitTaskRunUpdated({
                id: observedUpdate.id,
                status: observedUpdate.status,
                agentId: observedUpdate.agentId,
                dispatchedAt: observedUpdate.dispatchedAt?.toISOString() ?? scheduledAt.toISOString(),
            });
            safeLog.info("Scheduler marked OBSERVED task as dispatched", {
                taskRunId: task.id,
                agentAlias: task.agent.alias,
            });
            return;
        }

        if (task.user.slackAccessToken && task.slackChannelId) {
            await dispatchTaskMessage(task.id, task.userId);
        } else {
            await prisma.taskRun.update({
                where: { id: task.id },
                data: buildLifecycleUpdate(task, "DISPATCHED", scheduledAt),
            });
        }

        eventBus.emitTaskRunUpdated({
            id: task.id,
            status: "DISPATCHED",
            agentId: task.agentId,
            dispatchedAt: scheduledAt.toISOString(),
        });

        safeLog.info("Scheduler dispatched task", { taskRunId: task.id, agentAlias: task.agent.alias });
    } catch (err) {
        safeLog.error("Scheduler failed to dispatch task", {
            taskRunId: taskId,
            error: err instanceof Error ? err.message : String(err),
        });
        dueHeap?.push({ id: taskId, at: Date.now() + 5_000 });
    }
}

// ─── Timeout watchdog (adaptive) ─────────────────────────
// Previously part of the 30s tick (full scan of IN_PROGRESS/WAITING). Now it
// arms to the nearest per-task deadline (startedAt + timeoutMinutes) when
// running tasks exist, with a bounded fallback sweep otherwise.

function armTimeoutWatchdog(): void {
    if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
    }
    if (!running) return;

    timeoutTimer = setTimeout(() => void runTimeoutSweep(), TIMEOUT_FALLBACK_MS);
}

async function runTimeoutSweep(): Promise<void> {
    try {
        const now = new Date();
        const runningTasks = await prisma.taskRun.findMany({
            where: {
                status: { in: ["IN_PROGRESS", "WAITING"] },
                startedAt: { not: null },
            },
        });

        let nextDeadline = Number.POSITIVE_INFINITY;

        for (const task of runningTasks) {
            if (!task.startedAt) continue;

            const activeElapsedMinutes = getEffectiveActiveDurationMs(task, now) / 60000;
            const deadlineMs =
                task.startedAt.getTime() + task.timeoutMinutes * 60_000;

            if (activeElapsedMinutes >= task.timeoutMinutes) {
                try {
                    const updated = await prisma.taskRun.update({
                        where: { id: task.id },
                        data: buildLifecycleUpdate(task, "TIMED_OUT", now, {
                            failureReason: "Timeout threshold reached",
                        }),
                    });

                    eventBus.emitTaskRunUpdated({
                        id: updated.id,
                        status: updated.status,
                        agentId: updated.agentId,
                        completedAt: updated.completedAt?.toISOString() ?? now.toISOString(),
                        totalActiveDuration: updated.totalActiveDuration,
                        totalWaitDuration: updated.totalWaitDuration,
                    });

                    safeLog.warn("Task timed out", { taskRunId: task.id, activeElapsedMinutes });
                } catch (err) {
                    safeLog.error("Scheduler failed to time out task", {
                        taskRunId: task.id,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            } else {
                nextDeadline = Math.min(nextDeadline, deadlineMs);
            }
        }

        if (Number.isFinite(nextDeadline)) {
            const delay = Math.max(0, nextDeadline - Date.now() - REARM_GREACE_MS);
            timeoutTimer = setTimeout(
                () => void runTimeoutSweep(),
                Math.min(Math.max(delay, 1_000), MAX_TIMER_MS),
            );
        } else {
            armTimeoutWatchdog();
        }
    } catch (err) {
        safeLog.error("Scheduler timeout sweep error", { error: String(err) });
        armTimeoutWatchdog();
    }
}

export function stopScheduler(): void {
    running = false;
    if (dueTimer) {
        clearTimeout(dueTimer);
        dueTimer = null;
    }
    if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
    }
    dueHeap = null;
    safeLog.info("Scheduler stopped");
}

// Kept for any external callers/tests that referenced the old tick entrypoint.
export async function runSchedulerTick(): Promise<void> {
    if (!running || !dueHeap) {
        await boot();
        return;
    }
    await fireDue();
    await runTimeoutSweep();
}

export { isRunning };
