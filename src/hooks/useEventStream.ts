"use client";

import { useEffect, useRef } from "react";

interface TaskRunEvent {
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
}

interface UseEventStreamOptions {
    onTaskRunUpdated?: (event: TaskRunEvent) => void;
    enabled?: boolean;
}

export function useEventStream({ onTaskRunUpdated, enabled = true }: UseEventStreamOptions = {}) {
    const eventSourceRef = useRef<EventSource | null>(null);

    useEffect(() => {
        if (!enabled) return;

        const connect = () => {
            const es = new EventSource("/api/events");
            eventSourceRef.current = es;

            es.addEventListener("taskRunUpdated", (e) => {
                try {
                    const data = JSON.parse(e.data) as TaskRunEvent;
                    onTaskRunUpdated?.(data);
                } catch {
                    // ignore parse error
                }
            });

            es.onerror = () => {
                es.close();
                // Reconnect after 5s
                setTimeout(connect, 5000);
            };
        };

        connect();

        return () => {
            eventSourceRef.current?.close();
        };
    }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

    return null;
}
