import DashboardClient from "@/components/DashboardClient"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { redirect } from "next/navigation"
import { DEMO_AGENTS, DEMO_TASK_RUNS, DEMO_USER } from "@/lib/demo-data"

const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "true"

export default async function DashboardPage() {
  // ── Demo mode: skip auth and DB entirely ──────────────────────────────────
  if (IS_DEMO) {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    const thirtyDaysAhead = Date.now() + 30 * 24 * 60 * 60 * 1000

    const serializedAgents = DEMO_AGENTS.map((agent) => ({
      id: agent.id,
      name: agent.name,
      alias: agent.alias,
      agentType: agent.agentType,
      connectionTier: agent.connectionTier,
      lastActiveAt: agent.lastActiveAt,
    }))

    const serializedTaskRuns = DEMO_TASK_RUNS.filter((run) => {
      const t = new Date(run.scheduledAt).getTime()
      return t >= thirtyDaysAgo && t <= thirtyDaysAhead
    }).map((run) => ({
      id: run.id,
      agentId: run.agentId,
      taskBody: run.taskBody,
      status: run.status,
      schedulingMode: run.schedulingMode,
      scheduledAt: run.scheduledAt,
      dispatchedAt: run.dispatchedAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      timeoutMinutes: run.timeoutMinutes,
      slackChannelId: run.slackChannelId,
      webhookToken: run.webhookToken,
      pauseCount: run.pauseCount,
      totalActiveDuration: run.totalActiveDuration,
      totalWaitDuration: run.totalWaitDuration,
      failureReason: run.failureReason,
      latestAgentMessage: run.latestAgentMessage,
      completionPath: run.completionPath,
      cronSchedule: run.cronSchedule,
      agent: run.agent,
    }))

    return (
      <DashboardClient
        initialAgents={serializedAgents}
        initialTaskRuns={serializedTaskRuns}
        user={{ name: DEMO_USER.name, email: DEMO_USER.email }}
      />
    )
  }

  // ── Normal mode ───────────────────────────────────────────────────────────
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  const userId = (session.user as { id: string }).id

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const thirtyDaysAhead = new Date()
  thirtyDaysAhead.setDate(thirtyDaysAhead.getDate() + 30)

  const [agents, taskRuns] = await Promise.all([
    prisma.agent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.taskRun.findMany({
      where: {
        userId,
        scheduledAt: { gte: thirtyDaysAgo, lte: thirtyDaysAhead },
      },
      include: { agent: { select: { alias: true, name: true } } },
      orderBy: { scheduledAt: "asc" },
    }),
  ])

  const serializedAgents = (agents || []).map((agent: any) => ({
    id: agent.id,
    name: agent.name,
    alias: agent.alias,
    agentType: agent.agentType,
    connectionTier: agent.connectionTier,
    lastActiveAt: agent.lastActiveAt?.toISOString() ?? null,
  }))

  const serializedTaskRuns = (taskRuns || []).map((run: any) => ({
    id: run.id,
    agentId: run.agentId,
    taskBody: run.taskBody,
    status: run.status,
    schedulingMode: run.schedulingMode,
    scheduledAt: run.scheduledAt.toISOString(),
    dispatchedAt: run.dispatchedAt?.toISOString() ?? null,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    timeoutMinutes: run.timeoutMinutes,
    slackChannelId: run.slackChannelId,
    webhookToken: run.webhookToken,
    pauseCount: run.pauseCount,
    totalActiveDuration: run.totalActiveDuration,
    totalWaitDuration: run.totalWaitDuration,
    failureReason: run.failureReason,
    latestAgentMessage: run.latestAgentMessage,
    completionPath: run.completionPath,
    cronSchedule: run.cronSchedule ?? null,
    agent: run.agent,
  }))

  return (
    <DashboardClient
      initialAgents={serializedAgents}
      initialTaskRuns={serializedTaskRuns}
      user={{
        name: session.user.name ?? "User",
        email: session.user.email ?? "",
      }}
    />
  )
}
