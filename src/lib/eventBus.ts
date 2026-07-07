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

const GLOBAL_BUS_KEY = Symbol.for("kronos.eventBus.v1");

type GlobalScope = typeof globalThis & {
    [GLOBAL_BUS_KEY]?: KronosEventBus;
};

class KronosEventBus extends EventEmitter {
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

    emitTaskRunUpdated(payload: TaskRunEvent["payload"]) {
        this.emit("taskRunUpdated", payload);
    }

    onTaskRunUpdated(callback: (payload: TaskRunEvent["payload"]) => void) {
        this.on("taskRunUpdated", callback);
        return () => this.off("taskRunUpdated", callback);
    }
}

export const eventBus = KronosEventBus.getInstance();
export default eventBus;
