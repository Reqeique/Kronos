import { EventEmitter } from "events";

// ─── Typed Event Bus ─────────────────────────────────────
// Single-process pub/sub for real-time SSE events.
//
// Anchored to `globalThis` via `Symbol.for(...)` so that Next.js's per-bundle
// module registries (instrumentation hook, route handlers, scheduler, etc.)
// share ONE EventEmitter instance. Without this, SSE emitters and subscribers
// land in different module realms and events silently drop in production.
//
// Scope: single OS process, single V8 isolate. For distributed deployments
// (PM2 cluster workers, containers, serverless), swap for Redis pub/sub.

export interface TaskRunEvent {
    type: "taskRunUpdated";
    payload: {
        id: string;
        status: string;
        agentId: string;
        completedAt?: string | null;
        startedAt?: string | null;
        dispatchedAt?: string | null;
        pauseCount?: number;
        completionPath?: string | null;
        totalActiveDuration?: number;
        totalWaitDuration?: number;
        latestAgentMessage?: string | null;
        sessionTitle?: string | null;
    };
}

// ─── Last-Event-ID replay ring buffer ─────────────────────
// Every emitted task-run update is assigned a monotonic id and
// stored in a bounded ring. SSE clients that reconnect send the
// last `id:` they saw as the `Last-Event-ID` header; the server
// replays every buffered event with id > lastSeen in order.
//
// Tuning: RING_SIZE must be large enough to cover the worst
// expected disconnect window (e.g. ~1000 events at high churn).
const RING_SIZE = 1000;

interface SequencedEvent {
    id: number;
    payload: TaskRunEvent["payload"];
}

// EventEmitter's listener shape — untyped sink so we can register envelope
// handlers via the base class's `any`-parameter signature without fighting
// Node's generic `.on` overloads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventListener = (...args: any[]) => void;

const GLOBAL_BUS_KEY = Symbol.for("kronos.eventBus.v1");

type GlobalScope = typeof globalThis & {
    [GLOBAL_BUS_KEY]?: KronosEventBus;
};

class KronosEventBus extends EventEmitter {
    private seq = 0;
    private ring: SequencedEvent[] = [];

    private constructor() {
        super();
        this.setMaxListeners(500); // Support up to 500 concurrent SSE clients
    }

    static getInstance(): KronosEventBus {
        const g = globalThis as GlobalScope;
        if (!g[GLOBAL_BUS_KEY]) {
            g[GLOBAL_BUS_KEY] = new KronosEventBus();
        }
        return g[GLOBAL_BUS_KEY]!;
    }

    getSeqId(): number {
        return this.seq;
    }

    // Returns all buffered events whose id is strictly greater than
    // lastId, in ascending id order. Returns [] if lastId is current
    // or ahead (e.g. server restarted and forgot the ids).
    since(lastId: number): SequencedEvent[] {
        if (this.seq === 0) return [];
        // The ring is the tail of the id space. If lastId is older than
        // the oldest buffered id, we can only replay from the buffer's
        // head (oldest) onward — older events are lost; the client must
        // re-fetch current state via the REST API.
        const oldest = this.ring[0]?.id ?? this.seq;
        const from = lastId < oldest ? oldest : lastId + 1;
        return this.ring.filter((e) => e.id >= from).sort((a, b) => a.id - b.id);
    }

    emitTaskRunUpdated(payload: TaskRunEvent["payload"]) {
        const id = ++this.seq;
        this.ring.push({ id, payload });
        // Keep only the most recent RING_SIZE events (trim from the head).
        if (this.ring.length > RING_SIZE) {
            this.ring.splice(0, this.ring.length - RING_SIZE);
        }
        // Live listeners receive the envelope; the compatibility wrapper
        // (onTaskRunUpdated) unwraps it back to the bare payload.
        this.emit("taskRunUpdated", { id, payload });
    }

    onTaskRunUpdated(callback: (payload: TaskRunEvent["payload"]) => void) {
        // Unwrap the sequenced envelope so existing call sites keep
        // receiving the bare payload they expect.
        const wrapped = (envelope: SequencedEvent) => callback(envelope.payload);
        this.on("taskRunUpdated", wrapped as EventListener);
        return () => this.off("taskRunUpdated", wrapped as EventListener);
    }

    // Like onTaskRunUpdated but hands the caller the monotonic id too,
    // so SSE emitters can include `id:` frames. Used by /api/events.
    onSequencedTaskRunUpdated(
        callback: (id: number, payload: TaskRunEvent["payload"]) => void,
    ) {
        const wrapped = (envelope: SequencedEvent) =>
            callback(envelope.id, envelope.payload);
        this.on("taskRunUpdated", wrapped as EventListener);
        return () => this.off("taskRunUpdated", wrapped as EventListener);
    }
}

export const eventBus = KronosEventBus.getInstance();
export default eventBus;
