export const TERMINAL_STATUSES = ["COMPLETED", "FAILED", "TIMED_OUT"] as const;

export type LifecycleTaskStatus =
    | "SCHEDULED"
    | "DISPATCHED"
    | "IN_PROGRESS"
    | "WAITING"
    | "COMPLETED"
    | "FAILED"
    | "TIMED_OUT";

export type SchedulingMode = "AUTONOMOUS" | "SUPERVISED" | "OBSERVED";

export interface LifecycleTaskRun {
    status: string;
    schedulingMode: string;
    startedAt: Date | null;
    dispatchedAt: Date | null;
    completedAt?: Date | null;
    updatedAt: Date;
    pauseCount: number;
    totalWaitDuration: number;
    totalActiveDuration: number;
}

export function isTerminalStatus(status: string): boolean {
    return TERMINAL_STATUSES.includes(status as (typeof TERMINAL_STATUSES)[number]);
}

export function isSchedulingMode(value: string): value is SchedulingMode {
    return value === "AUTONOMOUS" || value === "SUPERVISED" || value === "OBSERVED";
}

function clampPositiveMs(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.floor(value);
}

function elapsedSinceStartMs(taskRun: LifecycleTaskRun, at: Date): number {
    if (!taskRun.startedAt) return 0;
    return clampPositiveMs(at.getTime() - taskRun.startedAt.getTime());
}

function currentActiveElapsedMs(taskRun: LifecycleTaskRun, at: Date): number {
    const base = clampPositiveMs(taskRun.totalActiveDuration);
    if (!taskRun.startedAt || taskRun.status !== "IN_PROGRESS") {
        return base;
    }

    const elapsed = elapsedSinceStartMs(taskRun, at);
    const activeFromTimeline = clampPositiveMs(elapsed - taskRun.totalWaitDuration);
    return Math.max(base, activeFromTimeline);
}

function activeDeltaFromInProgress(taskRun: LifecycleTaskRun, at: Date): number {
    if (taskRun.status !== "IN_PROGRESS") return 0;
    const current = currentActiveElapsedMs(taskRun, at);
    return clampPositiveMs(current - taskRun.totalActiveDuration);
}

function waitDeltaFromWaiting(taskRun: LifecycleTaskRun, at: Date): number {
    if (taskRun.status !== "WAITING") return 0;
    return clampPositiveMs(at.getTime() - taskRun.updatedAt.getTime());
}

export function getEffectiveActiveDurationMs(taskRun: LifecycleTaskRun, at: Date): number {
    return currentActiveElapsedMs(taskRun, at);
}

export function buildLifecycleUpdate(
    taskRun: LifecycleTaskRun,
    newStatus: LifecycleTaskStatus,
    at: Date,
    options?: { failureReason?: string | null; completionPath?: "ACP" | "WEBHOOK" | "SLACK_REACTION" },
): Record<string, unknown> {
    const updateData: Record<string, unknown> = { status: newStatus };

    if (newStatus === "DISPATCHED" && !taskRun.dispatchedAt) {
        updateData.dispatchedAt = at;
    }

    if (newStatus === "IN_PROGRESS") {
        if (!taskRun.startedAt) updateData.startedAt = at;
        if (!taskRun.dispatchedAt) updateData.dispatchedAt = at;

        const waitDelta = waitDeltaFromWaiting(taskRun, at);
        if (waitDelta > 0) {
            updateData.totalWaitDuration = taskRun.totalWaitDuration + waitDelta;
        }
    }

    if (newStatus === "WAITING") {
        if (!taskRun.startedAt) updateData.startedAt = at;
        if (!taskRun.dispatchedAt) updateData.dispatchedAt = at;

        const activeDelta = activeDeltaFromInProgress(taskRun, at);
        if (activeDelta > 0) {
            updateData.totalActiveDuration = taskRun.totalActiveDuration + activeDelta;
        }
        updateData.pauseCount = taskRun.pauseCount + 1;
    }

    if (isTerminalStatus(newStatus)) {
        updateData.completedAt = at;

        const activeDelta = activeDeltaFromInProgress(taskRun, at);
        if (activeDelta > 0) {
            updateData.totalActiveDuration = taskRun.totalActiveDuration + activeDelta;
        }

        const waitDelta = waitDeltaFromWaiting(taskRun, at);
        if (waitDelta > 0) {
            updateData.totalWaitDuration = taskRun.totalWaitDuration + waitDelta;
        }
    }

    if (options && "failureReason" in options) {
        updateData.failureReason = options.failureReason ?? null;
    }
    if (options?.completionPath) {
        updateData.completionPath = options.completionPath;
    }

    return updateData;
}
