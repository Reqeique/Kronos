/**
 * DEMO MODE — Hardcoded static data for Vercel demo deployment.
 * No database required. Set NEXT_PUBLIC_DEMO_MODE=true in Vercel env vars.
 */

export const DEMO_USER = {
    id: "demo-user-id",
    email: "demo@kronos.app",
    name: "Demo User",
};

const now = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

export const DEMO_AGENTS = [
    {
        id: "agent-1",
        userId: DEMO_USER.id,
        name: "Gemini CLI",
        alias: "gemini-cli",
        agentType: "CUSTOM",
        connectionTier: "WEBHOOK",
        acpServerUrl: null,
        lastActiveAt: new Date(now - 0.5 * HOUR).toISOString(),
        createdAt: new Date(now - 30 * DAY).toISOString(),
        updatedAt: new Date(now - 0.5 * HOUR).toISOString(),
    },
    {
        id: "agent-2",
        userId: DEMO_USER.id,
        name: "Code Reviewer",
        alias: "reviewer",
        agentType: "CUSTOM",
        connectionTier: "WEBHOOK",
        acpServerUrl: null,
        lastActiveAt: new Date(now - 1.5 * HOUR).toISOString(),
        createdAt: new Date(now - 28 * DAY).toISOString(),
        updatedAt: new Date(now - 1.5 * HOUR).toISOString(),
    },
    {
        id: "agent-3",
        userId: DEMO_USER.id,
        name: "Support Bot",
        alias: "support",
        agentType: "CUSTOM",
        connectionTier: "WEBHOOK",
        acpServerUrl: null,
        lastActiveAt: new Date(now - 2 * HOUR).toISOString(),
        createdAt: new Date(now - 25 * DAY).toISOString(),
        updatedAt: new Date(now - 2 * HOUR).toISOString(),
    },
    {
        id: "agent-4",
        userId: DEMO_USER.id,
        name: "Data Analyst",
        alias: "analyst",
        agentType: "CUSTOM",
        connectionTier: "WEBHOOK",
        acpServerUrl: null,
        lastActiveAt: new Date(now - 3 * HOUR).toISOString(),
        createdAt: new Date(now - 20 * DAY).toISOString(),
        updatedAt: new Date(now - 3 * HOUR).toISOString(),
    },
    {
        id: "agent-5",
        userId: DEMO_USER.id,
        name: "Release Helper",
        alias: "release",
        agentType: "CUSTOM",
        connectionTier: "WEBHOOK",
        acpServerUrl: null,
        lastActiveAt: new Date(now - 4 * HOUR).toISOString(),
        createdAt: new Date(now - 15 * DAY).toISOString(),
        updatedAt: new Date(now - 4 * HOUR).toISOString(),
    },
];

const taskDescriptions = [
    "Summarize support incidents and tag priorities",
    "Review PR #241 and leave release-risk notes",
    "Generate daily KPI digest for leadership",
    "Run dependency drift audit and security scan",
    "Draft incident postmortem timeline",
    "Validate webhook replay protection rules",
    "Triage stale backlog tasks older than 14 days",
    "Prepare sprint handoff notes for platform team",
    "Analyze auth failure spikes from overnight logs",
    "Compile release readiness checklist",
];

function makeTaskRuns() {
    const runs: {
        id: string;
        userId: string;
        agentId: string;
        taskBody: string;
        status: string;
        schedulingMode: string;
        scheduledAt: string;
        dispatchedAt: string | null;
        startedAt: string | null;
        completedAt: string | null;
        slackMessageTs: string | null;
        slackChannelId: string | null;
        webhookToken: string | null;
        acpSessionId: string | null;
        timeoutMinutes: number;
        pauseCount: number;
        totalWaitDuration: number;
        totalActiveDuration: number;
        failureReason: string | null;
        latestAgentMessage: string | null;
        completionPath: string | null;
        cronSchedule: string | null;
        createdAt: string;
        updatedAt: string;
        agent: { alias: string; name: string };
    }[] = [];

    const start = now - 14 * DAY;

    DEMO_AGENTS.forEach((agent, agentIndex) => {
        for (let i = 0; i < 14; i++) {
            const slot = agentIndex * 14 + i;
            const scheduledMs = start + slot * 3 * HOUR;
            const description = taskDescriptions[(slot + agentIndex) % taskDescriptions.length];
            const taskBody = `[${new Date(scheduledMs).toLocaleDateString("en-US")}] ${description} (${agent.alias})`;
            const past = scheduledMs <= now;

            let status = "SCHEDULED";
            let dispatchedAt: string | null = null;
            let startedAt: string | null = null;
            let completedAt: string | null = null;
            let failureReason: string | null = null;
            let completionPath: string | null = null;
            let pauseCount = 0;
            let totalWaitDuration = 0;
            let totalActiveDuration = 0;

            if (past) {
                const mod = slot % 10;
                if (mod <= 5) {
                    status = "COMPLETED";
                } else if (mod === 6) {
                    status = "FAILED";
                    failureReason = "Rate limit on upstream service";
                } else if (mod === 7) {
                    status = "TIMED_OUT";
                    failureReason = "Worker exceeded timeout window";
                } else if (mod === 8) {
                    status = "WAITING";
                    pauseCount = 1;
                    totalWaitDuration = 11 * 60;
                } else {
                    status = "IN_PROGRESS";
                }

                const dispatchMs = scheduledMs + 2 * 60 * 1000;
                const startMs = dispatchMs + 10 * 1000;
                dispatchedAt = new Date(dispatchMs).toISOString();
                startedAt = new Date(startMs).toISOString();
                completionPath = status === "COMPLETED" ? "WEBHOOK" : null;

                if (status === "COMPLETED" || status === "FAILED" || status === "TIMED_OUT") {
                    const finishMs = startMs + (12 + (slot % 18)) * 60 * 1000;
                    completedAt = new Date(finishMs).toISOString();
                    totalActiveDuration = Math.round((finishMs - startMs) / 1000);
                } else {
                    totalActiveDuration = 15 * 60;
                }
            }

            const createdAtMs = scheduledMs - HOUR;
            const updatedAtMs = completedAt
                ? new Date(completedAt).getTime()
                : startedAt
                    ? new Date(startedAt).getTime()
                    : dispatchedAt
                        ? new Date(dispatchedAt).getTime()
                        : scheduledMs;

            runs.push({
                id: `task-${slot}`,
                userId: DEMO_USER.id,
                agentId: agent.id,
                taskBody,
                status,
                schedulingMode: "AUTONOMOUS",
                scheduledAt: new Date(scheduledMs).toISOString(),
                dispatchedAt,
                startedAt,
                completedAt,
                slackMessageTs: null,
                slackChannelId: null,
                webhookToken: null,
                acpSessionId: null,
                timeoutMinutes: 60,
                pauseCount,
                totalWaitDuration,
                totalActiveDuration,
                failureReason,
                latestAgentMessage: null,
                completionPath,
                cronSchedule: null,
                createdAt: new Date(createdAtMs).toISOString(),
                updatedAt: new Date(updatedAtMs).toISOString(),
                agent: { alias: agent.alias, name: agent.name },
            });
        }
    });

    return runs.sort(
        (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
    );
}

export const DEMO_TASK_RUNS = makeTaskRuns();
