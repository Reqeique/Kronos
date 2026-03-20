"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"

import BlockDetailPanel from "@/components/BlockDetailPanel"
import { AppSidebar } from "@/components/app-sidebar"
import { ChartAreaInteractive, type TaskVolumePoint } from "@/components/chart-area-interactive"
import type { CalendarTaskEvent, CalView } from "@/components/CalendarView"
import CreateTaskModal from "@/components/CreateTaskModal"
import { SectionCards } from "@/components/section-cards"
import { SiteHeader } from "@/components/site-header"
import { TaskRunsTable } from "@/components/task-runs-table"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useEventStream } from "@/hooks/useEventStream"
import { toast } from "sonner"

const CalendarView = dynamic(() => import("@/components/CalendarView"), {
  ssr: false,
})

interface Agent {
  id: string
  name: string
  alias: string
  agentType: string
  connectionTier: string
  lastActiveAt: string | null
}

interface TaskRun {
  id: string
  agentId: string
  taskBody: string
  status: string
  schedulingMode: string
  scheduledAt: string
  dispatchedAt: string | null
  startedAt: string | null
  completedAt: string | null
  timeoutMinutes: number
  slackChannelId: string | null
  webhookToken: string | null
  pauseCount: number
  totalActiveDuration: number
  totalWaitDuration: number
  failureReason: string | null
  latestAgentMessage: string | null
  completionPath: string | null
  cronSchedule: string | null
  agent?: { alias: string; name: string }
}

type DashboardSection = "overview" | "runs" | "calendar"

function taskRunToEvent(run: TaskRun): CalendarTaskEvent {
  const alias = run.agent?.alias ?? "unknown"
  const hasStartTime = Boolean(run.completedAt ?? run.startedAt)

  const end = hasStartTime
    ? new Date(
      run.completedAt
        ? new Date(run.completedAt).getTime()
        : new Date(run.startedAt as string).getTime() + run.timeoutMinutes * 60000
    ).toISOString()
    : new Date(new Date(run.scheduledAt).getTime() + run.timeoutMinutes * 60000).toISOString()

  return {
    id: run.id,
    title: run.taskBody.slice(0, 60) + (run.taskBody.length > 60 ? "..." : ""),
    start: run.startedAt ?? run.dispatchedAt ?? run.scheduledAt,
    end,
    status: run.status,
    alias,
    mode: run.schedulingMode,
  }
}

/**
 * Expand a recurring task into virtual calendar events within a window.
 * Uses a simple cron-compatible calculation for common patterns.
 */
function expandRecurringEvents(run: TaskRun, windowEnd: Date): CalendarTaskEvent[] {
  if (!run.cronSchedule) return [taskRunToEvent(run)]

  const events: CalendarTaskEvent[] = [taskRunToEvent(run)]
  const alias = run.agent?.alias ?? "unknown"
  const title = run.taskBody.slice(0, 60) + (run.taskBody.length > 60 ? "..." : "")
  const durationMs = run.timeoutMinutes * 60000

  // Parse simple cron patterns: "min hour * * *" (daily) and "min hour * * dow" (weekly)
  const parts = run.cronSchedule.trim().split(/\s+/)
  if (parts.length !== 5) return events

  const [min, hour, , , dow] = parts
  const isWeekly = dow !== "*"

  const current = new Date(run.scheduledAt)
  // Advance to next occurrence from the base, generate up to windowEnd
  for (let i = 0; i < 365; i++) {
    // Advance by 1 day for daily, 7 days for weekly
    current.setDate(current.getDate() + (isWeekly ? 7 : 1))
    if (current > windowEnd) break

    // Apply hour/min from cron
    current.setHours(parseInt(hour, 10), parseInt(min, 10), 0, 0)

    const start = current.toISOString()
    const end = new Date(current.getTime() + durationMs).toISOString()

    events.push({
      id: `${run.id}-recurring-${i}`,
      title,
      start,
      end,
      status: "SCHEDULED",
      alias,
      mode: run.schedulingMode,
    })
  }

  return events
}

function toDateKey(isoDate: string) {
  const date = new Date(isoDate)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`
}

function buildTaskVolumeData(taskRuns: TaskRun[]): TaskVolumePoint[] {
  const buckets = new Map<string, { scheduled: number; completed: number }>()

  for (const run of taskRuns) {
    const scheduledKey = toDateKey(run.scheduledAt)
    const scheduledBucket = buckets.get(scheduledKey) ?? { scheduled: 0, completed: 0 }
    scheduledBucket.scheduled += 1
    buckets.set(scheduledKey, scheduledBucket)

    if (run.completedAt) {
      const completedKey = toDateKey(run.completedAt)
      const completedBucket = buckets.get(completedKey) ?? { scheduled: 0, completed: 0 }
      completedBucket.completed += 1
      buckets.set(completedKey, completedBucket)
    }
  }

  return Array.from(buckets.entries())
    .map(([date, value]) => ({ date, ...value }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

export default function DashboardClient({
  initialAgents,
  initialTaskRuns,
  user,
}: {
  initialAgents: Agent[]
  initialTaskRuns: TaskRun[]
  user: { name: string; email: string }
}) {
  const [agents, setAgents] = useState<Agent[]>(initialAgents)
  const [taskRuns, setTaskRuns] = useState<TaskRun[]>(initialTaskRuns)
  const [view, setView] = useState<CalView>("dayGridMonth")
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedRange, setSelectedRange] = useState<{ start: Date; end: Date } | null>(null)
  const [selectedTaskRunId, setSelectedTaskRunId] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<DashboardSection>("overview")
  const router = useRouter()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const slackStatus = params.get("slack")

    if (slackStatus === "connected") toast.success("Slack connected successfully.")
    if (slackStatus === "error") toast.error("Slack connection failed.")

    if (slackStatus) {
      const url = new URL(window.location.href)
      url.searchParams.delete("slack")
      window.history.replaceState({}, "", url)
    }
  }, [])

  useEventStream({
    onTaskRunUpdated: (event) => {
      setTaskRuns((prev) =>
        prev.map((run) =>
          run.id === event.id
            ? {
              ...run,
              ...event,
            }
            : run
        )
      )

      setAgents((prev) =>
        prev.map((agent) =>
          agent.id === event.agentId
            ? { ...agent, lastActiveAt: new Date().toISOString() }
            : agent
        )
      )
    },
  })

  const events: CalendarTaskEvent[] = useMemo(() => {
    // Expand recurring tasks to show future occurrences (90 days ahead)
    const windowEnd = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
    return taskRuns.flatMap((run) => expandRecurringEvents(run, windowEnd))
  }, [taskRuns])

  const handleDateSelect = useCallback((start: Date, end: Date) => {
    setSelectedRange({ start, end })
    setShowCreateModal(true)
  }, [])

  const handleTaskCreated = useCallback(
    (newRun: TaskRun) => {
      const agent = agents.find((value) => value.id === newRun.agentId)
      setTaskRuns((prev) => [
        ...prev,
        {
          ...newRun,
          agent: agent ? { alias: agent.alias, name: agent.name } : undefined,
        },
      ])
    },
    [agents]
  )

  const selectedTaskRun = useMemo(
    () => taskRuns.find((run) => run.id === selectedTaskRunId) ?? null,
    [taskRuns, selectedTaskRunId]
  )

  const stats = useMemo(() => {
    const active = taskRuns.filter((run) =>
      ["IN_PROGRESS", "DISPATCHED", "WAITING"].includes(run.status)
    ).length

    const completedToday = taskRuns.filter((run) => {
      if (run.status !== "COMPLETED" || !run.completedAt) return false
      const today = new Date()
      const completed = new Date(run.completedAt)
      return completed.toDateString() === today.toDateString()
    }).length

    const agentsOnline = agents.filter((agent) => Boolean(agent.lastActiveAt)).length

    const completedRuns = taskRuns.filter(
      (run) => run.status === "COMPLETED" && run.startedAt && run.completedAt
    )

    let avgDuration: string | null = null

    if (completedRuns.length > 0) {
      const avgMs =
        completedRuns.reduce((sum, run) => {
          return (
            sum +
            (new Date(run.completedAt as string).getTime() -
              new Date(run.startedAt as string).getTime())
          )
        }, 0) / completedRuns.length

      const mins = Math.round(avgMs / 60000)
      avgDuration = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`
    }

    return {
      active,
      completedToday,
      agentsOnline,
      avgDuration,
    }
  }, [agents, taskRuns])

  const taskVolumeData = useMemo(() => buildTaskVolumeData(taskRuns), [taskRuns])

  const recentRuns = useMemo(
    () =>
      [...taskRuns]
        .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
        .slice(0, 20),
    [taskRuns]
  )

  const today = useMemo(
    () =>
      new Date().toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    []
  )

  return (
    <SidebarProvider>
      <AppSidebar
        agents={agents}
        user={user}
        onCreateTask={() => setShowCreateModal(true)}
        onOpenSettings={() => router.push("/settings")}
        activeSection={activeSection}
        onNavigateSection={setActiveSection}
        variant="inset"
      />

      <SidebarInset>
        <SiteHeader
          title="Kronos Dashboard"
          subtitle={
            activeSection === "overview"
              ? `${today} - Overview`
              : activeSection === "runs"
                ? `${today} - Task Runs`
                : `${today} - Calendar`
          }
          onCreateTask={() => setShowCreateModal(true)}
        />

        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              {activeSection === "overview" ? (
                <>
                  <SectionCards stats={stats} />
                  <div className="px-4 lg:px-6">
                    <ChartAreaInteractive data={taskVolumeData} />
                  </div>
                </>
              ) : null}

              {activeSection === "runs" ? (
                <TaskRunsTable
                  taskRuns={recentRuns}
                  onOpenDetails={(id) => {
                    setSelectedTaskRunId(id)
                    setActiveSection("calendar")
                  }}
                />
              ) : null}

              {activeSection === "calendar" ? (
                <div className="px-4 pb-4 lg:px-6">
                  <Card>
                    <CardHeader className="relative pb-3">
                      <CardTitle>Calendar</CardTitle>
                      <CardDescription>
                        Schedule and inspect tasks by day, week, or month.
                      </CardDescription>
                      <div className="absolute right-4 top-4">
                        <ToggleGroup
                          type="single"
                          value={view}
                          onValueChange={(next) => {
                            if (next) setView(next as CalView)
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
                      <div className="flex min-h-[620px]">
                        <div className="flex-1 p-4 md:p-6">
                          <CalendarView
                            key={view}
                            events={events}
                            view={view}
                            onEventClick={(taskRunId) => setSelectedTaskRunId(taskRunId)}
                            onDateSelect={handleDateSelect}
                          />
                        </div>

                        {selectedTaskRun ? (
                          <BlockDetailPanel
                            taskRun={selectedTaskRun}
                            onClose={() => setSelectedTaskRunId(null)}
                          />
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </SidebarInset>

      {showCreateModal ? (
        <CreateTaskModal
          agents={agents}
          defaultStart={selectedRange?.start}
          onClose={() => {
            setShowCreateModal(false)
            setSelectedRange(null)
          }}
          onCreated={handleTaskCreated}
        />
      ) : null}
    </SidebarProvider>
  )
}

