import prisma from "./prisma";
import { dispatchTaskMessage } from "./slack";
import logger from "./logger";
import eventBus from "./eventBus";
import { buildLifecycleUpdate, getEffectiveActiveDurationMs } from "./taskRunLifecycle";

let schedulerRunning = false;
let schedulerInterval: ReturnType<typeof setInterval> | null = null;

// Scheduler: polls for tasks due to dispatch and timeout processing.
export async function runSchedulerTick(): Promise<void> {
    const now = new Date();

    // 1) Dispatch SCHEDULED tasks whose scheduledAt has passed.
    const dueTasks = await prisma.taskRun.findMany({
        where: {
            status: "SCHEDULED",
            scheduledAt: { lte: now },
        },
        include: { agent: true, user: true },
    });

    for (const task of dueTasks) {
        try {
            if (task.schedulingMode === "OBSERVED") {
                const observedUpdate = await prisma.taskRun.update({
                    where: { id: task.id },
                    data: buildLifecycleUpdate(task, "DISPATCHED", now),
                });

                eventBus.emitTaskRunUpdated({
                    id: observedUpdate.id,
                    status: observedUpdate.status,
                    agentId: observedUpdate.agentId,
                    dispatchedAt: observedUpdate.dispatchedAt?.toISOString() ?? now.toISOString(),
                });

                logger.info("Scheduler marked OBSERVED task as dispatched", {
                    taskRunId: task.id,
                    agentAlias: task.agent.alias,
                });
                continue;
            }

            if (task.user.slackAccessToken && task.slackChannelId) {
                await dispatchTaskMessage(task.id, task.userId);
            } else {
                await prisma.taskRun.update({
                    where: { id: task.id },
                    data: buildLifecycleUpdate(task, "DISPATCHED", now),
                });
            }

            eventBus.emitTaskRunUpdated({
                id: task.id,
                status: "DISPATCHED",
                agentId: task.agentId,
                dispatchedAt: now.toISOString(),
            });

            logger.info("Scheduler dispatched task", { taskRunId: task.id, agentAlias: task.agent.alias });
        } catch (err) {
            logger.error("Scheduler failed to dispatch task", {
                taskRunId: task.id,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    // 2) Timeout IN_PROGRESS/WAITING tasks using active time (wait time excluded).
    const runningTasks = await prisma.taskRun.findMany({
        where: {
            status: { in: ["IN_PROGRESS", "WAITING"] },
            startedAt: { not: null },
        },
    });

    for (const task of runningTasks) {
        if (!task.startedAt) continue;

        const activeElapsedMinutes = getEffectiveActiveDurationMs(task, now) / 60000;
        if (activeElapsedMinutes >= task.timeoutMinutes) {
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

            logger.warn("Task timed out", { taskRunId: task.id, activeElapsedMinutes });
        }
    }
}

export function startScheduler(intervalMs = 30_000): void {
    if (schedulerRunning) return;
    schedulerRunning = true;
    logger.info("Scheduler started", { intervalMs });

    runSchedulerTick().catch((err) =>
        logger.error("Scheduler tick error", { error: String(err) }),
    );

    schedulerInterval = setInterval(() => {
        runSchedulerTick().catch((err) =>
            logger.error("Scheduler tick error", { error: String(err) }),
        );
    }, intervalMs);
}

export function stopScheduler(): void {
    if (schedulerInterval) {
        clearInterval(schedulerInterval);
        schedulerInterval = null;
    }
    schedulerRunning = false;
    logger.info("Scheduler stopped");
}
