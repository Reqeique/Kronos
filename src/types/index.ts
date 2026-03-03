// ─── Task Status (State Machine) ─────────────────────────
// SCHEDULED → DISPATCHED → IN_PROGRESS → [WAITING] → IN_PROGRESS → COMPLETED | FAILED | TIMED_OUT
export type TaskStatus =
    | "SCHEDULED"
    | "DISPATCHED"
    | "IN_PROGRESS"
    | "WAITING"
    | "COMPLETED"
    | "FAILED"
    | "TIMED_OUT";

// ─── Scheduling Modes ────────────────────────────────────
export type SchedulingMode = "AUTONOMOUS" | "SUPERVISED" | "OBSERVED";

// ─── Agent Types ─────────────────────────────────────────
export type AgentType =
    | "CLAUDE_CODE"
    | "CLAUDE_COWORK"
    | "NANOBOT"
    | "OPENCALW"
    | "CUSTOM";

// ─── Connection Tiers ────────────────────────────────────
export type ConnectionTier = "ACP" | "WEBHOOK" | "SLACK_REACTION";

// ─── Completion Paths ────────────────────────────────────
export type CompletionPath = "ACP" | "WEBHOOK" | "SLACK_REACTION";

// ─── Status Colors (for calendar UI) ─────────────────────
export const STATUS_COLORS: Record<TaskStatus, string> = {
    SCHEDULED: "#6b7280",   // Gray
    DISPATCHED: "#3b82f6",  // Blue outline
    IN_PROGRESS: "#2563eb", // Blue filled
    WAITING: "#eab308",     // Yellow
    COMPLETED: "#22c55e",   // Green
    FAILED: "#ef4444",      // Red
    TIMED_OUT: "#f97316",   // Orange
};

// ─── Mode Icons ──────────────────────────────────────────
export const MODE_ICONS: Record<SchedulingMode, string> = {
    AUTONOMOUS: "shield",
    SUPERVISED: "eye",
    OBSERVED: "monitor",
};

// ─── Valid State Transitions ─────────────────────────────
export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
    SCHEDULED: ["DISPATCHED"],
    DISPATCHED: ["IN_PROGRESS", "FAILED", "TIMED_OUT"],
    IN_PROGRESS: ["WAITING", "COMPLETED", "FAILED", "TIMED_OUT"],
    WAITING: ["IN_PROGRESS", "FAILED", "TIMED_OUT"],
    COMPLETED: [],
    FAILED: [],
    TIMED_OUT: [],
};

// ─── API Response Envelope ───────────────────────────────
export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
        traceId: string;
    };
}

// ─── Agent DTO ───────────────────────────────────────────
export interface AgentDTO {
    id: string;
    name: string;
    alias: string;
    agentType: AgentType;
    connectionTier: ConnectionTier;
    lastActiveAt: string | null;
}

// ─── TaskRun DTO ─────────────────────────────────────────
export interface TaskRunDTO {
    id: string;
    agentId: string;
    agentAlias: string;
    taskBody: string;
    status: TaskStatus;
    schedulingMode: SchedulingMode;
    scheduledAt: string;
    dispatchedAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    timeoutMinutes: number;
    pauseCount: number;
    totalWaitDuration: number;
    totalActiveDuration: number;
    failureReason: string | null;
    latestAgentMessage?: string | null;
    completionPath: CompletionPath | null;
}
