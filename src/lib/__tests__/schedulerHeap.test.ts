import { describe, it, expect } from "vitest";
import { SchedulerHeap } from "../schedulerHeap";

describe("SchedulerHeap", () => {
    it("peeks the earliest entry", () => {
        const h = new SchedulerHeap();
        h.push({ id: "b", at: 200 });
        h.push({ id: "a", at: 100 });
        h.push({ id: "c", at: 300 });
        expect(h.peek()?.id).toBe("a");
        expect(h.size).toBe(3);
    });

    it("popDue returns only entries that are due, earliest-first", () => {
        const h = new SchedulerHeap();
        h.push({ id: "b", at: 200 });
        h.push({ id: "a", at: 100 });
        h.push({ id: "c", at: 300 });
        const due = h.popDue(150);
        expect(due.map((e) => e.id)).toEqual(["a"]);
        expect(h.peek()?.id).toBe("b");
        const due2 = h.popDue(250);
        expect(due2.map((e) => e.id)).toEqual(["b"]);
        expect(h.peek()?.id).toBe("c");
    });

    it("handles out-of-order pushes maintaining heap order", () => {
        const h = new SchedulerHeap();
        const ids = Array.from({ length: 20 }, (_, i) => i);
        const shuffled = [...ids].reverse();
        for (const i of shuffled) h.push({ id: String(i), at: i * 10 });
        const out: string[] = [];
        while (h.size > 0) out.push(...h.popDue(Number.POSITIVE_INFINITY).map((e) => e.id));
        expect(out).toEqual(ids.map(String));
    });

    it("deduplicates by id, keeping the earlier time", () => {
        const h = new SchedulerHeap();
        h.push({ id: "x", at: 500 });
        h.push({ id: "x", at: 100 });
        expect(h.size).toBe(1);
        expect(h.peek()?.at).toBe(100);
    });

    it("clears", () => {
        const h = new SchedulerHeap();
        h.push({ id: "a", at: 1 });
        h.clear();
        expect(h.size).toBe(0);
        expect(h.peek()).toBeUndefined();
    });
});
