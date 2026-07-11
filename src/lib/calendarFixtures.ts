import type { CalendarTaskEvent } from "@/components/CalendarView";

function isoOffset(base: Date, ms: number): string {
    return new Date(base.getTime() + ms).toISOString();
}

function todayAt(hour: number, minute = 0, second = 0): Date {
    const d = new Date();
    d.setHours(hour, minute, second, 0);
    return d;
}

export function buildCalendarFixtures(): CalendarTaskEvent[] {
    const base = todayAt(14, 0, 0);
    const events: CalendarTaskEvent[] = [];

    const mk = (
        id: string,
        title: string,
        startOffsetMs: number,
        endOffsetMs: number,
        status: string,
        alias: string,
        mode: string,
    ): CalendarTaskEvent => ({
        id,
        title,
        start: isoOffset(base, startOffsetMs),
        end: isoOffset(base, endOffsetMs),
        status,
        alias,
        mode,
    });

    events.push(
        mk("fixture-subsecond-1", "Sub-second task A", 0, 2_000, "COMPLETED", "agent-1", "queued"));
    events.push(
        mk("fixture-subsecond-2", "Sub-second task B", 30_000, 38_000, "COMPLETED", "agent-2", "queued"));

    events.push(
        mk("fixture-short-1", "Short task A (8s)", 60_000, 68_000, "COMPLETED", "agent-1", "queued"));
    events.push(
        mk("fixture-short-2", "Short task B (15s)", 120_000, 135_000, "COMPLETED", "agent-2", "queued"));

    events.push(
        mk("fixture-medium-1", "Medium task A (90s)", 180_000, 270_000, "COMPLETED", "agent-3", "queued"));
    events.push(
        mk("fixture-medium-2", "Medium task B (3min)", 300_000, 480_000, "COMPLETED", "agent-1", "queued"));

    events.push(
        mk("fixture-long-1", "Long task (18min)", 600_000, 600_000 + 18 * 60_000, "COMPLETED", "agent-4", "queued"));

    events.push(
        mk("fixture-overlap-1", "Overlap A (2s)", 30_000, 32_000, "COMPLETED", "agent-1", "queued"));
    events.push(
        mk("fixture-overlap-2", "Overlap B (8s)", 30_000, 38_000, "COMPLETED", "agent-2", "queued"));
    events.push(
        mk("fixture-overlap-3", "Overlap C (20s)", 30_000, 50_000, "COMPLETED", "agent-3", "queued"));
    events.push(
        mk("fixture-overlap-4", "Overlap D (3min)", 30_000, 30_000 + 3 * 60_000, "COMPLETED", "agent-4", "queued"));

    events.push(
        mk("fixture-in-progress", "In progress (started 3min ago)", -3 * 60_000, -3 * 60_000 + 30 * 60_000, "IN_PROGRESS", "agent-2", "queued"));

    return events;
}
