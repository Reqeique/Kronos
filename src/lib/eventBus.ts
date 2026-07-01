import { EventEmitter } from "events";

// ─── Typed Event Bus ─────────────────────────────────────
// Single-process pub/sub for real-time SSE events.
// In production with multiple workers, swap for Redis pub/sub.

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

class KronosEventBus extends EventEmitter {
    private static instance: KronosEventBus;

    private constructor() {
        super();
        this.setMaxListeners(500); // Support up to 500 concurrent SSE clients
    }

    static getInstance(): KronosEventBus {
        if (!KronosEventBus.instance) {
            KronosEventBus.instance = new KronosEventBus();
        }
        return KronosEventBus.instance;
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
