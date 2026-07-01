"use client";

import { X, Clock, Play, CheckCircle2, AlertCircle, Timer, Pause, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SchedulingModeIcon, TaskStatusIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

interface TaskRun {
    id: string;
    agentId: string;
    taskBody: string;
    sessionTitle?: string | null;
    status: string;
    schedulingMode: string;
    scheduledAt: string;
    dispatchedAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    timeoutMinutes: number;
    slackChannelId: string | null;
    webhookToken: string | null;
    pauseCount: number;
    totalActiveDuration: number;
    totalWaitDuration: number;
    failureReason: string | null;
    latestAgentMessage: string | null;
    completionPath: string | null;
    agent?: { alias: string; name: string };
}

interface BlockDetailPanelProps {
    taskRun: TaskRun;
    onClose: () => void;
}

const STATUS_INFO: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; color: string }> = {
    SCHEDULED: { label: "Scheduled", variant: "secondary", color: "bg-gray-500/10 text-gray-500 border-gray-500/20" },
    DISPATCHED: { label: "Dispatched", variant: "default", color: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
    IN_PROGRESS: { label: "In Progress", variant: "default", color: "bg-blue-600/10 text-blue-600 border-blue-600/20" },
    WAITING: { label: "Waiting", variant: "secondary", color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20" },
    COMPLETED: { label: "Completed", variant: "secondary", color: "bg-green-500/10 text-green-600 border-green-500/20" },
    FAILED: { label: "Failed", variant: "destructive", color: "bg-red-500/10 text-red-600 border-red-500/20" },
    TIMED_OUT: { label: "Timed Out", variant: "destructive", color: "bg-orange-500/10 text-orange-600 border-orange-500/20" },
};

const PATH_LABELS: Record<string, string> = {
    ACP: "ACP Protocol",
    WEBHOOK: "Webhook",
    SLACK_REACTION: "Slack Reaction",
};

function formatDuration(ms: number): string {
    const secs = Math.floor(ms / 1000);
    const mins = Math.floor(secs / 60);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    if (mins > 0) return `${mins}m ${secs % 60}s`;
    return `${secs}s`;
}

function fmt(dateStr: string | null): string {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export default function BlockDetailPanel({ taskRun, onClose }: BlockDetailPanelProps) {
    const statusInfo = STATUS_INFO[taskRun.status] ?? STATUS_INFO.SCHEDULED;
    const alias = taskRun.agent?.alias ?? "Unknown";

    const actualDuration =
        taskRun.startedAt && taskRun.completedAt
            ? new Date(taskRun.completedAt).getTime() - new Date(taskRun.startedAt).getTime()
            : null;

    const activeDuration = taskRun.totalActiveDuration;
    const waitDuration = taskRun.totalWaitDuration;

    return (
        <div className="w-[400px] border-l bg-background flex flex-col h-full animate-in slide-in-from-right duration-300">
            <div className="flex items-center justify-between p-4 border-b">
                <Badge variant="outline" className={cn("flex items-center gap-1.5 px-2 py-0.5 font-medium", statusInfo.color)}>
                    <TaskStatusIcon status={taskRun.status} className="h-3.5 w-3.5" />
                    {statusInfo.label}
                </Badge>
                <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
                    <X className="h-4 w-4" />
                </Button>
            </div>

            <ScrollArea className="flex-1">
                <div className="p-6 space-y-6">
                    <div className="space-y-1">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Agent</span>
                        <div className="text-lg font-bold">@{alias}</div>
                    </div>

                    <Separator />

                    <div className="space-y-2">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Task</span>
                        {taskRun.sessionTitle && (
                            <div className="text-sm font-semibold leading-snug">{taskRun.sessionTitle}</div>
                        )}
                        <div className="text-sm bg-muted/50 p-3 rounded-lg border leading-relaxed text-muted-foreground">
                            {taskRun.taskBody}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-y-4 gap-x-8">
                        <div className="space-y-1">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Mode</span>
                            <div className="flex items-center gap-2 text-sm font-medium">
                                <SchedulingModeIcon mode={taskRun.schedulingMode} className="h-4 w-4" />
                                {taskRun.schedulingMode}
                            </div>
                        </div>
                        <div className="space-y-1">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Timeout</span>
                            <div className="text-sm font-medium flex items-center gap-2">
                                <Timer className="h-4 w-4 text-muted-foreground" />
                                {taskRun.timeoutMinutes}min
                            </div>
                        </div>
                        {taskRun.completionPath && (
                            <div className="space-y-1">
                                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Path</span>
                                <div className="text-sm font-medium">
                                    {PATH_LABELS[taskRun.completionPath] ?? taskRun.completionPath}
                                </div>
                            </div>
                        )}
                        {taskRun.pauseCount > 0 && (
                            <div className="space-y-1">
                                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pauses</span>
                                <div className="text-sm font-medium flex items-center gap-2">
                                    <Pause className="h-4 w-4 text-muted-foreground" />
                                    {taskRun.pauseCount}
                                </div>
                            </div>
                        )}
                    </div>

                    <Separator />

                    <div className="space-y-3">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Timeline</span>
                        <div className="space-y-2">
                            {[
                                { label: "Scheduled", value: taskRun.scheduledAt, icon: Clock },
                                { label: "Dispatched", value: taskRun.dispatchedAt, icon: Play },
                                { label: "Started", value: taskRun.startedAt, icon: Play },
                                { label: "Completed", value: taskRun.completedAt, icon: CheckCircle2 },
                            ].map(({ label, value, icon: Icon }) => (
                                <div key={label} className="flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-2 text-muted-foreground">
                                        <Icon className="h-3.5 w-3.5" />
                                        <span>{label}</span>
                                    </div>
                                    <span className="font-medium">{fmt(value)}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {(actualDuration || activeDuration > 0) && (
                        <div className="bg-muted/30 rounded-xl p-4 border space-y-3">
                            {actualDuration && (
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold text-muted-foreground">Total Duration</span>
                                    <span className="text-sm font-bold">{formatDuration(actualDuration)}</span>
                                </div>
                            )}
                            {taskRun.schedulingMode === "SUPERVISED" && (
                                <>
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold text-muted-foreground">Active Compute</span>
                                        <span className="text-sm font-medium">{formatDuration(activeDuration)}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold text-muted-foreground">Wait Time</span>
                                        <span className="text-sm font-medium">{formatDuration(waitDuration)}</span>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {taskRun.failureReason && (
                        <div className="bg-destructive/10 border-destructive/20 border rounded-xl p-4 space-y-2">
                            <div className="flex items-center gap-2 text-destructive">
                                <AlertCircle className="h-4 w-4" />
                                <span className="text-xs font-bold uppercase tracking-wider">Failure Reason</span>
                            </div>
                            <p className="text-sm leading-relaxed text-destructive/90">{taskRun.failureReason}</p>
                        </div>
                    )}

                    {taskRun.latestAgentMessage && (
                        <div className="bg-blue-500/5 border-blue-500/20 border rounded-xl p-4 space-y-2">
                            <div className="flex items-center gap-2 text-blue-600">
                                <Info className="h-4 w-4" />
                                <span className="text-xs font-bold uppercase tracking-wider">Latest Agent Output</span>
                            </div>
                            <p className="text-sm leading-relaxed whitespace-pre-wrap">{taskRun.latestAgentMessage}</p>
                        </div>
                    )}

                    {taskRun.webhookToken && taskRun.status === "DISPATCHED" && (
                        <div className="bg-blue-500/5 border-blue-500/20 border rounded-xl p-4 space-y-3">
                            <div className="flex items-center gap-2 text-blue-600">
                                <Info className="h-4 w-4" />
                                <span className="text-xs font-bold uppercase tracking-wider">Webhook Token</span>
                            </div>
                            <code className="block w-full text-[10px] p-2 bg-blue-500/10 rounded font-mono break-all text-blue-700">
                                {taskRun.webhookToken}
                            </code>
                            <p className="text-[10px] text-blue-600/70 italic">
                                POST to <code>/api/webhook/complete</code> with this token
                            </p>
                        </div>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}

