"use client";

import { useEffect, useMemo } from "react";
import { createCalendarControlsPlugin } from "@schedule-x/calendar-controls";
import { createDragAndDropPlugin } from "@schedule-x/drag-and-drop";
import { createEventModalPlugin } from "@schedule-x/event-modal";
import { ScheduleXCalendar, useNextCalendarApp } from "@schedule-x/react";
import { viewDay, viewMonthGrid, viewWeek, type CalendarApp } from "@schedule-x/calendar";
import { useTheme } from "next-themes";
import "temporal-polyfill/global";

export type CalView = "timeGridDay" | "timeGridWeek" | "dayGridMonth";

export interface CalendarTaskEvent {
    id: string;
    title: string;
    start: string;
    end: string;
    status: string;
    alias: string;
    mode: string;
}

interface CalendarViewProps {
    events: CalendarTaskEvent[];
    view: CalView;
    onEventClick: (taskRunId: string) => void;
    onDateSelect: (start: Date, end: Date) => void;
}

type ScheduleEventInput = {
    id: string;
    title: string;
    start: Temporal.ZonedDateTime;
    end: Temporal.ZonedDateTime;
    calendarId: string;
    status: string;
    alias: string;
    mode: string;
};

type CalendarEventsInput = Parameters<CalendarApp["events"]["set"]>[0];

function toZonedDateTime(dateTime: string, timezone: string): Temporal.ZonedDateTime | null {
    try {
        return Temporal.Instant.from(dateTime).toZonedDateTimeISO(timezone);
    } catch {
        try {
            return Temporal.ZonedDateTime.from(dateTime).withTimeZone(timezone);
        } catch {
            return null;
        }
    }
}

export default function CalendarView({
    events,
    view,
    onEventClick,
    onDateSelect,
}: CalendarViewProps) {
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";
    const timezone = useMemo(
        () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        [],
    );

    const scheduleEvents = useMemo<ScheduleEventInput[]>(
        () => {
            const mapped: ScheduleEventInput[] = [];
            for (const event of events) {
                const start = toZonedDateTime(event.start, timezone);
                const end = toZonedDateTime(event.end, timezone);
                if (!start || !end) continue;
                mapped.push({
                    id: event.id,
                    title: event.title,
                    start,
                    end,
                    calendarId: event.status.toUpperCase(),
                    status: event.status,
                    alias: event.alias,
                    mode: event.mode,
                });
            }
            return mapped;
        },
        [events, timezone],
    );

    const calendarControls = useMemo(() => createCalendarControlsPlugin(), []);
    const dragAndDrop = useMemo(() => createDragAndDropPlugin(), []);
    const eventModal = useMemo(() => createEventModalPlugin(), []);

    const defaultView = useMemo(() => {
        if (view === "timeGridDay") return "day";
        if (view === "dayGridMonth") return "month-grid";
        return "week";
    }, [view]);

    const calendar = useNextCalendarApp(
        {
            views: [viewDay, viewWeek, viewMonthGrid],
            defaultView,
            isDark,
            timezone,
            theme: "shadcn",
            events: [],
            callbacks: {
                onEventClick: (event) => {
                    onEventClick(String(event.id));
                },
                onDoubleClickDateTime: (dateTime) => {
                    const start = new Date(dateTime.epochMilliseconds);
                    const end = new Date(start.getTime() + 30 * 60000);
                    onDateSelect(start, end);
                },
            },
            calendars: {
                SCHEDULED: {
                    colorName: "SCHEDULED",
                    lightColors: { main: "var(--status-scheduled)", container: "color-mix(in srgb, var(--status-scheduled) 20%, transparent)", onContainer: "var(--foreground)" },
                    darkColors: { main: "var(--status-scheduled)", container: "color-mix(in srgb, var(--status-scheduled) 30%, transparent)", onContainer: "var(--foreground)" },
                },
                DISPATCHED: {
                    colorName: "DISPATCHED",
                    lightColors: { main: "var(--status-dispatched)", container: "color-mix(in srgb, var(--status-dispatched) 20%, transparent)", onContainer: "var(--foreground)" },
                    darkColors: { main: "var(--status-dispatched)", container: "color-mix(in srgb, var(--status-dispatched) 30%, transparent)", onContainer: "var(--foreground)" },
                },
                IN_PROGRESS: {
                    colorName: "IN_PROGRESS",
                    lightColors: { main: "var(--status-in-progress)", container: "color-mix(in srgb, var(--status-in-progress) 20%, transparent)", onContainer: "var(--foreground)" },
                    darkColors: { main: "var(--status-in-progress)", container: "color-mix(in srgb, var(--status-in-progress) 30%, transparent)", onContainer: "var(--foreground)" },
                },
                WAITING: {
                    colorName: "WAITING",
                    lightColors: { main: "var(--status-waiting)", container: "color-mix(in srgb, var(--status-waiting) 20%, transparent)", onContainer: "var(--foreground)" },
                    darkColors: { main: "var(--status-waiting)", container: "color-mix(in srgb, var(--status-waiting) 30%, transparent)", onContainer: "var(--foreground)" },
                },
                COMPLETED: {
                    colorName: "COMPLETED",
                    lightColors: { main: "var(--status-completed)", container: "color-mix(in srgb, var(--status-completed) 20%, transparent)", onContainer: "var(--foreground)" },
                    darkColors: { main: "var(--status-completed)", container: "color-mix(in srgb, var(--status-completed) 30%, transparent)", onContainer: "var(--foreground)" },
                },
                FAILED: {
                    colorName: "FAILED",
                    lightColors: { main: "var(--status-failed)", container: "color-mix(in srgb, var(--status-failed) 20%, transparent)", onContainer: "var(--foreground)" },
                    darkColors: { main: "var(--status-failed)", container: "color-mix(in srgb, var(--status-failed) 30%, transparent)", onContainer: "var(--foreground)" },
                },
                TIMED_OUT: {
                    colorName: "TIMED_OUT",
                    lightColors: { main: "var(--status-timed-out)", container: "color-mix(in srgb, var(--status-timed-out) 20%, transparent)", onContainer: "var(--foreground)" },
                    darkColors: { main: "var(--status-timed-out)", container: "color-mix(in srgb, var(--status-timed-out) 30%, transparent)", onContainer: "var(--foreground)" },
                },
            },
        },
        [calendarControls, dragAndDrop, eventModal],
    );

    useEffect(() => {
        if (!calendar) return;
        calendar.events.set(scheduleEvents as unknown as CalendarEventsInput);
    }, [calendar, scheduleEvents]);

    return (
        <div className="calendar-view is-shadcn">
            {calendar ? <ScheduleXCalendar calendarApp={calendar} /> : null}
        </div>
    );
}
