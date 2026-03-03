"use client"

import * as React from "react"
import { EyeIcon, SendIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export interface TaskRunTableItem {
  id: string
  agentId: string
  taskBody: string
  status: string
  schedulingMode: string
  scheduledAt: string
  startedAt: string | null
  completedAt: string | null
  timeoutMinutes: number
  slackChannelId: string | null
  agent?: { alias: string; name: string }
}

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: "#6b7280",
  DISPATCHED: "#3b82f6",
  IN_PROGRESS: "#2563eb",
  WAITING: "#eab308",
  COMPLETED: "#22c55e",
  FAILED: "#ef4444",
  TIMED_OUT: "#f97316",
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatDuration(startedAt: string | null, completedAt: string | null) {
  if (!startedAt || !completedAt) return "-"
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return "-"

  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

interface TaskRunsTableProps {
  taskRuns: TaskRunTableItem[]
  onOpenDetails: (id: string) => void
}

export function TaskRunsTable({ taskRuns, onOpenDetails }: TaskRunsTableProps) {
  const [dispatchingId, setDispatchingId] = React.useState<string | null>(null)

  const handleDispatchNow = React.useCallback(async (id: string) => {
    setDispatchingId(id)

    try {
      await fetch("/api/task-runs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "dispatch" }),
      })
    } finally {
      setDispatchingId(null)
    }
  }, [])

  return (
    <div className="px-4 lg:px-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Latest Task Runs</CardTitle>
          <CardDescription>
            Recent scheduled and in-flight runs across your agents.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {taskRuns.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-20 text-center text-muted-foreground">
                      No task runs yet. Create your first task from the header or sidebar.
                    </TableCell>
                  </TableRow>
                ) : (
                  taskRuns.map((run) => {
                    const canDispatch =
                      run.status === "SCHEDULED" &&
                      run.schedulingMode !== "OBSERVED" &&
                      Boolean(run.slackChannelId)

                    const color = STATUS_COLORS[run.status] ?? STATUS_COLORS.SCHEDULED

                    return (
                      <TableRow key={run.id}>
                        <TableCell className="max-w-[360px] truncate font-medium" title={run.taskBody}>
                          {run.taskBody}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          @{run.agent?.alias ?? "unknown"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="border"
                            style={{
                              backgroundColor: `${color}1A`,
                              borderColor: `${color}66`,
                              color: "var(--foreground)",
                            }}
                          >
                            {run.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {run.schedulingMode}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(run.scheduledAt)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDuration(run.startedAt, run.completedAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-2">
                            {canDispatch && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={dispatchingId === run.id}
                                onClick={() => void handleDispatchNow(run.id)}
                              >
                                <SendIcon className="mr-1 size-3.5" />
                                {dispatchingId === run.id ? "Sending" : "Dispatch"}
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onOpenDetails(run.id)}
                            >
                              <EyeIcon className="mr-1 size-3.5" />
                              Details
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
