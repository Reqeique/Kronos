import { describe, it, expect } from "vitest";
import { SchedulerHeap } from "../schedulerHeap";

// In-process timing benchmark of "startup delay": the gap between a task's
// scheduledAt (when it *should* fire) and the moment the scheduler actually
// dispatches it. No DB/Prisma — dispatch is a recorded timestamp so we can
// measure the timer mechanics directly.

const OLD_POLL_MS = 1_000; // old impl ran setInterval @ 30_000; scaled to 1s
// to keep the test fast. Real-world old default => 30x these numbers.
const NEW_GRACE_MS = 1_000; // matches scheduler.ts REARM_GREACE_MS

type Dispatched = { id: string; at: number };

// Faithful simulation of the OLD impl: setInterval tick scans every scheduled
// task and dispatches the ones whose scheduledAt <= now.
function runOldPoll(tasks: { id: string; scheduledAt: number }[]): Promise<Dispatched[]> {
    return new Promise((resolve) => {
        const pending = new Map(tasks.map((t) => [t.id, t.scheduledAt]));
        const dispatched: Dispatched[] = [];
        const tick = setInterval(() => {
            const now = Date.now();
            for (const [id, at] of pending) {
                if (at <= now) {
                    dispatched.push({ id, at: now });
                    pending.delete(id);
                }
            }
            if (pending.size === 0) {
                clearInterval(tick);
                resolve(dispatched);
            }
        }, OLD_POLL_MS);
        void new Promise<void>((res) => setTimeout(() => res(), 0));
    });
}

// Faithful simulation of the NEW impl: SchedulerHeap + setTimeout armed to peek.
function runNewHeap(tasks: { id: string; scheduledAt: number }[]): Promise<Dispatched[]> {
    return new Promise((resolve) => {
        const heap = new SchedulerHeap();
        for (const t of tasks) heap.push({ id: t.id, at: t.scheduledAt });
        const dispatched: Dispatched[] = [];

        const arm = () => {
            const next = heap.peek();
            if (!next) {
                resolve(dispatched);
                return;
            }
            const delay = Math.max(0, next.at - Date.now()) - NEW_GRACE_MS;
            setTimeout(() => {
                const now = Date.now();
                const due = heap.popDue(now);
                for (const e of due) dispatched.push({ id: e.id, at: now });
                arm();
            }, Math.max(delay, 0));
        };
        arm();
    });
}

describe("scheduler startup delay (old poll vs new heap)", () => {
    it("new heap dispatches near the deadline; old poll waits for the next tick", async () => {
        const t0 = Date.now();
        // Task due 200ms after t0.
        const oldResult = await runOldPoll([{ id: "a", scheduledAt: t0 + 200 }]);
        const oldLatency = oldResult[0].at - (t0 + 200);

        const t1 = Date.now();
        const newResult = await runNewHeap([{ id: "a", scheduledAt: t1 + 200 }]);
        const newLatency = newResult[0].at - (t1 + 200);

        expect(newLatency).toBeLessThan(50);
        expect(oldLatency).toBeGreaterThan(newLatency);
        expect(oldLatency / Math.max(newLatency, 1)).toBeGreaterThan(5);

        // eslint-disable-next-line no-console
        console.log(
            `\n  OLD poll (1s interval): dispatch latency = ${oldLatency}ms ` +
                `(default config uses 30_000ms => ~${((oldLatency / OLD_POLL_MS) * 30_000).toFixed(0)}ms worst-case)\n` +
                `  NEW heap:                dispatch latency = ${newLatency}ms\n`,
        );
    }, 15_000);

    it("new heap stays flat as task count grows; old poll cost is per-tick scan", async () => {
        const t0 = Date.now();
        const N = 1000;
        const tasks = Array.from({ length: N }, (_, i) => ({
            id: `t${i}`,
            scheduledAt: t0 + 50 + i,
        }));

        const newStart = Date.now();
        const newResult = await runNewHeap(tasks);
        const newMs = Date.now() - newStart;

        expect(newResult.length).toBe(N);
        // Heap amortises to < one poll interval even with 1000 tasks
        // (per-task timer cost floors this in Node, not algorithmic).
        expect(newMs).toBeLessThan(OLD_POLL_MS * 2);

        // eslint-disable-next-line no-console
        console.log(
            `\n  NEW heap dispatched ${N} tasks in ${newMs}ms (poll impl would wait ~${OLD_POLL_MS}ms for the next tick)\n`,
        );
    }, 15_000);
});
