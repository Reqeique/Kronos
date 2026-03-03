import { describe, it, expect } from "vitest";
import { buildLifecycleUpdate, LifecycleTaskRun } from "./taskRunLifecycle";

describe("taskRunLifecycle", () => {
    const baseDate = new Date("2026-02-26T12:00:00.000Z");

    const mockTaskRun: LifecycleTaskRun = {
        status: "DISPATCHED",
        schedulingMode: "SUPERVISED",
        startedAt: null,
        dispatchedAt: baseDate,
        updatedAt: baseDate,
        pauseCount: 0,
        totalWaitDuration: 0,
        totalActiveDuration: 0,
    };

    it("transitions to IN_PROGRESS and sets startedAt", () => {
        const now = new Date(baseDate.getTime() + 1000);
        const update = buildLifecycleUpdate(mockTaskRun, "IN_PROGRESS", now);

        expect(update.status).toBe("IN_PROGRESS");
        expect(update.startedAt).toEqual(now);
    });

    it("increments pauseCount and updates totalActiveDuration when entering WAITING", () => {
        const startedAt = new Date(baseDate.getTime() + 1000);
        const inProgressTask: LifecycleTaskRun = {
            ...mockTaskRun,
            status: "IN_PROGRESS",
            startedAt,
            updatedAt: startedAt,
        };

        const now = new Date(startedAt.getTime() + 5000); // 5 seconds of activity
        const update = buildLifecycleUpdate(inProgressTask, "WAITING", now) as any;

        expect(update.status).toBe("WAITING");
        expect(update.pauseCount).toBe(1);
        expect(update.totalActiveDuration).toBe(5000);
    });

    it("updates totalWaitDuration when resuming from WAITING", () => {
        const startedAt = new Date(baseDate.getTime() + 1000);
        const waitingAt = new Date(startedAt.getTime() + 5000);
        const waitingTask: LifecycleTaskRun = {
            ...mockTaskRun,
            status: "WAITING",
            startedAt,
            updatedAt: waitingAt,
            pauseCount: 1,
            totalActiveDuration: 5000,
        };

        const now = new Date(waitingAt.getTime() + 3000); // 3 seconds of waiting
        const update = buildLifecycleUpdate(waitingTask, "IN_PROGRESS", now) as any;

        expect(update.status).toBe("IN_PROGRESS");
        expect(update.totalWaitDuration).toBe(3000);
    });

    it("calculates terminal durations correctly", () => {
        const startedAt = new Date(baseDate.getTime() + 1000);
        const inProgressTask: LifecycleTaskRun = {
            ...mockTaskRun,
            status: "IN_PROGRESS",
            startedAt,
            updatedAt: startedAt,
            totalActiveDuration: 2000,
            totalWaitDuration: 1000,
        };

        const now = new Date(startedAt.getTime() + 10000);
        // Total elapsed since start = 10s
        // totalWaitDuration = 1s
        // currentActive = 10 - 1 = 9s
        // activeDelta = 9 - 2 = 7s
        // final active = 2 + 7 = 9s

        const update = buildLifecycleUpdate(inProgressTask, "COMPLETED", now) as any;

        expect(update.status).toBe("COMPLETED");
        expect(update.totalActiveDuration).toBe(9000);
    });

    it("ignores pause for AUTONOMOUS mode in API (verification of logic used by route)", () => {
        // This test is more about how buildLifecycleUpdate is used, 
        // but let's verify it doesn't do anything weird if called.
        const autonomousTask: LifecycleTaskRun = {
            ...mockTaskRun,
            schedulingMode: "AUTONOMOUS",
            status: "IN_PROGRESS",
            startedAt: baseDate,
        };

        const now = new Date(baseDate.getTime() + 5000);
        const update = buildLifecycleUpdate(autonomousTask, "WAITING", now) as any;

        expect(update.status).toBe("WAITING");
        expect(update.pauseCount).toBe(1); // The function itself doesn't check mode, the route does.
    });
});
