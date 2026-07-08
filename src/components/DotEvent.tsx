"use client";

import type React from "react";

interface DotEventProps {
    calendarEvent?: {
        title?: string;
        status?: string;
        _isDot?: boolean;
    };
}

const STATUS_COLOR: Record<string, string> = {
    SCHEDULED: "var(--status-scheduled)",
    DISPATCHED: "var(--status-dispatched)",
    IN_PROGRESS: "var(--status-in-progress)",
    WAITING: "var(--status-waiting)",
    COMPLETED: "var(--status-completed)",
    FAILED: "var(--status-failed)",
    TIMED_OUT: "var(--status-timed-out)",
};

export default function DotEvent(props: DotEventProps): React.ReactElement | null {
    const event = props.calendarEvent;
    if (!event) return null;

    const isDot = event._isDot === true;
    const status = (event.status ?? "").toUpperCase();
    const color = STATUS_COLOR[status] ?? "var(--status-completed)";

    if (isDot) {
        return (
            <div
                className="sx-event-dot"
                data-testid="sx-event-dot"
                data-status={status}
                title={event.title}
                style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "9999px",
                    backgroundColor: color,
                    border: "1px solid color-mix(in srgb, " + color + " 60%, transparent)",
                    boxShadow: "0 0 0 2px color-mix(in srgb, " + color + " 25%, transparent)",
                }}
            />
        );
    }

    const title = event.title ?? "";
    return (
        <div style={{ padding: "2px 4px", fontSize: "11px", lineHeight: 1.2, overflow: "hidden" }}>
            <strong>{title}</strong>
       </div>
    );
}
