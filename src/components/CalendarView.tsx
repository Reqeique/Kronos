"use client";

import type React from "react";
import { useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { createCalendarControlsPlugin } from "@schedule-x/calendar-controls";
import { createDragAndDropPlugin } from "@schedule-x/drag-and-drop";
import { createEventModalPlugin } from "@schedule-x/event-modal";
import { ScheduleXCalendar, useNextCalendarApp } from "@schedule-x/react";
import { viewDay, viewMonthGrid, viewWeek, type CalendarApp } from "@schedule-x/calendar";
import { useTheme } from "next-themes";
import "temporal-polyfill/global";

import {
    isDotEvent,
    applyStrategy,
    type CalendarStrategy,
} from "@/lib/calendarStrategies";

const DotEvent = dynamic(() => import("@/components/DotEvent"), { ssr: false });

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
    strategy?: CalendarStrategy;
    nowMs?: number;
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
    _isDot?: boolean;
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

function strategyClass(strategy: CalendarStrategy | undefined): string {
    switch (strategy) {
        case "floor":
            return "calendar-view--floor";
        case "extend":
            return "calendar-view--extend";
        case "dot":
            return "calendar-view--dot";
        case "current":
        default:
            return "calendar-view--current";
    }
}

export default function CalendarView({
    events,
    view,
    onEventClick,
    onDateSelect,
    strategy = "current",
    nowMs,
}: CalendarViewProps) {
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";
    const timezone = useMemo(
        () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        [],
    );

    const now = typeof nowMs === "number" ? nowMs : Date.now();

    const scheduleEvents = useMemo<ScheduleEventInput[]>(
        () => {
            const mapped: ScheduleEventInput[] = [];
            for (const raw of events) {
                const transformed = applyStrategy(strategy, raw, now);
                const start = toZonedDateTime(transformed.start, timezone);
                const end = toZonedDateTime(transformed.end, timezone);
                if (!start || !end) continue;
                const _isDot = strategy === "dot" && isDotEvent(transformed, now);
                mapped.push({
                    id: transformed.id,
                    title: transformed.title,
                    start,
                    end,
                    calendarId: transformed.status.toUpperCase(),
                    status: transformed.status,
                    alias: transformed.alias,
                    mode: transformed.mode,
                    _isDot,
                });
            }
            return mapped;
        },
        [events, timezone, strategy, now],
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
            weekOptions: {
                eventOverlap: true,
                eventWidth: 92,
                gridStep: 15,
            },
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

    const useDots = strategy === "dot";

    return (
        <div className={`calendar-view is-shadcn ${strategyClass(strategy)}`}>
            {calendar ? (
                <ScheduleXCalendar
                    calendarApp={calendar}
                    customComponents={
                        useDots
                            ? { timeGridEvent: DotEvent as unknown as React.ComponentType<unknown> }
                            : undefined
                    }
                />
            ) : null}
       </div>
    );
}
