import type { CalendarTaskEvent } from "@/components/CalendarView";

export type CalendarStrategy = "current" | "floor" | "extend" | "dot";

export const MIN_VISUAL_DURATION_MS = 15 * 60_000;
export const DOT_THRESHOLD_MS = 60_000;

export const STRATEGY_LABELS: Record<CalendarStrategy, string> = {
    current: "1 — Current",
    floor: "2 — Visual floor",
    extend: "3 — Extend end",
    dot: "4 — Dot for short",
};

export const STRATEGY_DESCRIPTIONS: Record<CalendarStrategy, string> = {
    current:
        "Baseline. end = completedAt | startedAt + timeout | scheduledAt + timeout. No min-height, default overlap.",
    floor: `end unchanged, but CSS min-height floors the block so sub-second tasks are still visible. In-progress grows to now.`,
    extend: `end forced to at least start + ${MIN_VISUAL_DURATION_MS / 60_000}min. Modifies the data the calendar sees (true duration lies in tooltips).`,
    dot: `Tasks shorter than ${DOT_THRESHOLD_MS / 1000}s render as a compact dot on the time axis via a custom timeGridEvent component.`,
};

export function isInProgress(event: CalendarTaskEvent): boolean {
    return event.status === "IN_PROGRESS";
}

export function applyCurrentStrategy(event: CalendarTaskEvent): CalendarTaskEvent {
    return event;
}

export function applyFloorStrategy(event: CalendarTaskEvent, now: number): CalendarTaskEvent {
    if (isInProgress(event)) {
        const startMs = Date.parse(event.start);
        const projectedEnd = Math.max(now, startMs + 1000);
        return { ...event, end: new Date(projectedEnd).toISOString() };
    }
    return event;
}

export function applyExtendStrategy(event: CalendarTaskEvent, now: number): CalendarTaskEvent {
    const startMs = Date.parse(event.start);
    const actualEndMs = Date.parse(event.end);
    const inProgressEnd = isInProgress(event) ? Math.max(now, startMs + 1000) : actualEndMs;
    const extendedEnd = Math.max(inProgressEnd, startMs + MIN_VISUAL_DURATION_MS);
    return { ...event, end: new Date(extendedEnd).toISOString() };
}

export function isDotEvent(event: CalendarTaskEvent, now: number): boolean {
    const startMs = Date.parse(event.start);
    let endMs = Date.parse(event.end);
    if (isInProgress(event)) {
        endMs = Math.max(endMs, now);
    }
    return endMs - startMs < DOT_THRESHOLD_MS;
}

export function applyStrategy(
    strategy: CalendarStrategy,
    event: CalendarTaskEvent,
    now: number,
): CalendarTaskEvent {
    switch (strategy) {
        case "floor":
            return applyFloorStrategy(event, now);
        case "extend":
            return applyExtendStrategy(event, now);
        case "current":
        case "dot":
        default:
            return applyCurrentStrategy(event);
    }
}
