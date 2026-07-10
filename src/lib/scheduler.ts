import prisma from "./prisma";
import { dispatchTaskMessage } from "./slack";
import logger from "./logger";
import eventBus from "./eventBus";
import { SchedulerHeap } from "./schedulerHeap";
import { buildLifecycleUpdate, getEffectiveActiveDurationMs } from "./taskRunLifecycle";

// EPIPE-safe logging wrapper. In Next.js dev with orphaned stdout (detached
// terminal, killed parent process), process.stdout.write can throw EPIPE
// synchronously. If a logger call inside the scheduler throws, it must NOT
// abort scheduler logic (boot, arm, dispatch). This wrapper swallows logger
// exceptions so the scheduler keeps running even when logging is broken.
type LogFn = (msg: string, data?: Record<string, unknown>) => void;
const safeLog: Record<"info" | "warn" | "error", LogFn> = {
    info: (msg, data) => { try { logger.info(msg, data); } catch { /* EPIPE — swallow */ } },
    warn: (msg, data) => { try { logger.warn(msg, data); } catch { /* EPIPE — swallow */ } },
    error: (msg, data) => { try { logger.error(msg, data); } catch { /* EPIPE — swallow */ } },
};

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
const REARM_GREACE_MS = 1_000; // wake a touch before the nearest deadline
const TIMEOUT_FALLBACK_MS = 30_000; // sweep bound when running tasks lack a deadline

let running = false;
let dueHeap: SchedulerHeap | null = null;
let dueTimer: ReturnType<typeof setTimeout> | null = null;
let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
let firing = false;

const isRunning = (): boolean => running;

export function startScheduler(_intervalMs = 30_000): void {
    if (running && dueHeap) return; // already booted
    running = true;
    safeLog.info("Scheduler started (adaptive heap)");
    void boot();
}

async function boot(): Promise<void> {
    dueHeap = new SchedulerHeap();
    try {
        const scheduled = await prisma.taskRun.findMany({
            where: { status: "SCHEDULED" },
            select: { id: true, scheduledAt: true },
        });
        for (const t of scheduled) {
            dueHeap.push({ id: t.id, at: t.scheduledAt.getTime() });
        }
        safeLog.info("Scheduler heap hydrated", { count: dueHeap.size });
    } catch (err) {
        safeLog.error("Scheduler hydration failed", { error: String(err) });
    } finally {
        // CRITICAL: armDue + watchdog must run even if logger threw EPIPE
        // above. Without this, a broken stdout kills the timer and the
        // scheduler silently dies (observed in production: 5 SCHEDULED tasks
        // never dispatched because armDue was unreachable after an EPIPE).
        armDue();
        armTimeoutWatchdog();
    }
}

/** Notify the scheduler that a new (or rescheduled) task is due at `scheduledAtMs`. */
export function notifyScheduled(taskId: string, scheduledAtMs: number): void {
    if (!running) return;
    // If the heap isn't initialized yet (boot still in flight or crashed
    // mid-boot), kick off a lazy boot. The task will be picked up by the
    // hydration scan, and boot's finally will arm the timer.
    if (!dueHeap) {
        void boot();
        return;
    }
    dueHeap.push({ id: taskId, at: scheduledAtMs });
    // Only re-arm if this entry is closer than the current armed deadline.
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
            await dispatchScheduledTask(entry.id, new Date(entry.at));
        }
    } catch (err) {
        safeLog.error("Scheduler fire error", { error: String(err) });
    } finally {
        firing = false;
        armDue();
    }
}

async function dispatchScheduledTask(taskId: string, scheduledAt: Date): Promise<void> {
    // Re-check the DB: the task may have been dispatched early, deleted, or
    // completed before its due time. This keeps correctness without wiring
    // removal into every state transition.
    const task = await prisma.taskRun.findUnique({
        where: { id: taskId },
        include: { agent: true, user: true },
    });

    if (!task || task.status !== "SCHEDULED") return;
    if (task.scheduledAt.getTime() > Date.now()) {
        // Not actually due yet (clock drift vs stored time): re-queue.
        dueHeap?.push({ id: taskId, at: task.scheduledAt.getTime() });
        return;
    }
    if (task.scheduledAt.getTime() !== scheduledAt.getTime() && task.scheduledAt.getTime() > scheduledAt.getTime()) {
        dueHeap?.push({ id: taskId, at: task.scheduledAt.getTime() });
        return;
    }

    try {
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
            taskRunId: task.id,
            error: err instanceof Error ? err.message : String(err),
        });
        // Re-arm retry by pushing back into the heap on the next tick window.
        dueHeap?.push({ id: task.id, at: Date.now() + 5_000 });
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
