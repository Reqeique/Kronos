// Binary min-heap keyed by `at` (epoch ms), used by the scheduler to find the
// nearest-due scheduled task in O(1) and push/reschedule in O(log S) instead
// of scanning every scheduled task on every tick.
//
// Entries are intentionally { at, id } only; status is re-checked against the
// DB when an entry is popped so stale/already-dispatched ids are skipped
// lazily (no removal churn across every state transition in the app).

export interface HeapEntry {
    at: number;
    id: string;
}

export class SchedulerHeap {
    private items: HeapEntry[] = [];
    // Id -> index in `items`, so we can detect duplicates and keep the heap
    // free of stale-but-same-id re-pushes after a reschedule.
    private indexById = new Map<string, number>();

    get size(): number {
        return this.items.length;
    }

    clear(): void {
        this.items = [];
        this.indexById.clear();
    }

    peek(): HeapEntry | undefined {
        return this.items[0];
    }

    push(entry: HeapEntry): void {
        const existing = this.indexById.get(entry.id);
        if (existing !== undefined) {
            // Keep the earlier of the two known times if a duplicate id is
            // pushed. Strictly a defensive guard; the scheduler re-checks DB
            // status on pop regardless, so a stale later entry is harmless.
            if (entry.at < this.items[existing].at) {
                this.decreaseKey(existing, entry.at);
            }
            return;
        }

        const i = this.items.length;
        this.items.push(entry);
        this.indexById.set(entry.id, i);
        this.siftUp(i);
    }

    /** Pop and return all entries with `at <= now`, in earliest-first order. */
    popDue(now: number): HeapEntry[] {
        const out: HeapEntry[] = [];
        while (this.items.length > 0 && this.items[0].at <= now) {
            out.push(this.pop());
        }
        return out;
    }

    private pop(): HeapEntry {
        const top = this.items[0];
        const last = this.items.pop()!;
        this.indexById.delete(top.id);

        if (this.items.length > 0) {
            this.items[0] = last;
            this.indexById.set(last.id, 0);
            this.siftDown(0);
        }
        return top;
    }

    private decreaseKey(i: number, at: number): void {
        if (at >= this.items[i].at) return;
        this.items[i] = { ...this.items[i], at };
        this.siftUp(i);
    }

    private siftUp(i: number): void {
        let idx = i;
        while (idx > 0) {
            const parent = (idx - 1) >> 1;
            if (this.items[parent].at <= this.items[idx].at) break;
            this.swap(parent, idx);
            idx = parent;
        }
    }

    private siftDown(i: number): void {
        let idx = i;
        const n = this.items.length;
        while (true) {
            const left = idx * 2 + 1;
            const right = left + 1;
            let smallest = idx;
            if (left < n && this.items[left].at < this.items[smallest].at) smallest = left;
            if (right < n && this.items[right].at < this.items[smallest].at) smallest = right;
            if (smallest === idx) break;
            this.swap(smallest, idx);
            idx = smallest;
        }
    }

    private swap(a: number, b: number): void {
        const tmp = this.items[a];
        this.items[a] = this.items[b];
        this.items[b] = tmp;
        this.indexById.set(this.items[a].id, a);
        this.indexById.set(this.items[b].id, b);
    }
}
