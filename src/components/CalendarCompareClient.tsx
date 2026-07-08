"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

import type { CalView } from "@/components/CalendarView";
import {
    STRATEGY_LABELS,
    STRATEGY_DESCRIPTIONS,
    type CalendarStrategy,
} from "@/lib/calendarStrategies";
import { buildCalendarFixtures } from "@/lib/calendarFixtures";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const CalendarView = dynamic(() => import("@/components/CalendarView"), {
    ssr: false,
});

const STRATEGIES: CalendarStrategy[] = ["current", "floor", "extend", "dot"];
const NOW_TICK_MS = 15_000;

interface CalendarCompareClientProps {
    userName: string;
}

export default function CalendarCompareClient({ userName }: CalendarCompareClientProps) {
    const [view, setView] = useState<CalView>("timeGridWeek");
    const [nowMs, setNowMs] = useState<number>(() => Date.now());

    useEffect(() => {
        const id = setInterval(() => setNowMs(Date.now()), NOW_TICK_MS);
        return () => clearInterval(id);
    }, []);

    const fixtures = useMemo(() => buildCalendarFixtures(), []);

    return (
        <div className="flex flex-1 flex-col gap-4 px-4 py-6 lg:gap-6 lg:px-6">
            <Card>
                <CardHeader className="relative pb-3">
                    <CardTitle>Calendar compare — short-lived task sandbox</CardTitle>
                    <CardDescription>
                        Four render strategies for the same synthetic dataset. Pick the one
                        that should ship. Hi {userName}, ticking every {NOW_TICK_MS / 1000}s.
                   </CardDescription>
                    <div className="absolute right-4 top-4">
                        <ToggleGroup
                            type="single"
                            value={view}
                            onValueChange={(next) => {
                                if (next) setView(next as CalView);
                            }}
                            variant="outline"
                        >
                            <ToggleGroupItem value="timeGridDay">Day</ToggleGroupItem>
                            <ToggleGroupItem value="timeGridWeek">Week</ToggleGroupItem>
                            <ToggleGroupItem value="dayGridMonth">Month</ToggleGroupItem>
                       </ToggleGroup>
                   </div>
               </CardHeader>
                <CardContent className="p-0">
                    <div className="flex min-h-[720px] flex-col p-4 md:p-6">
                        <Tabs defaultValue="current" className="w-full">
                            <TabsList className="mb-3 flex flex-wrap">
                                {STRATEGIES.map((s) => (
                                    <TabsTrigger key={s} value={s}>
                                        {STRATEGY_LABELS[s]}
                                   </TabsTrigger>
                                ))}
                           </TabsList>
                            {STRATEGIES.map((s) => (
                                <TabsContent key={s} value={s} className="m-0">
                                    <p className="mb-3 max-w-3xl text-sm text-muted-foreground">
                                        {STRATEGY_DESCRIPTIONS[s]}
                                   </p>
                                    <div className="h-[640px]">
                                        <CalendarView
                                            key={`${s}-${view}`}
                                            events={fixtures}
                                            view={view}
                                            strategy={s}
                                            nowMs={nowMs}
                                            onEventClick={() => {}}
                                            onDateSelect={() => {}}
                                        />
                                   </div>
                               </TabsContent>
                            ))}
                       </Tabs>
                   </div>
               </CardContent>
           </Card>
       </div>
    );
}
