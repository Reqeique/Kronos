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
    const lastIdRef = useRef<number>(0);

    useEffect(() => {
        if (!enabled) return;

        const connect = () => {
            // Pass the last id we saw as a query param so our manual
            // reconnect can still trigger server-side replay, since
            // EventSource cannot set custom headers itself. The browser's
            // own auto-reconnect additionally sends the `Last-Event-ID`
            // header, which the server also honors.
            const url =
                lastIdRef.current > 0
                    ? `/api/events?lastId=${lastIdRef.current}`
                    : "/api/events";
            const es = new EventSource(url);
            eventSourceRef.current = es;

            es.addEventListener("taskRunUpdated", (e) => {
                try {
                    const data = JSON.parse(e.data) as TaskRunEvent;
                    // The server now emits an `id:` line per event; the
                    // browser records it on the MessageEvent as lastEventId.
                    if (e.lastEventId) lastIdRef.current = Number(e.lastEventId);
                    onTaskRunUpdated?.(data);
                } catch {
                    // ignore parse error
                }
            });

            es.onerror = () => {
                es.close();
                // Reconnect after 5s, carrying the last id we saw so the
                // server replays anything emitted while we were down.
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
