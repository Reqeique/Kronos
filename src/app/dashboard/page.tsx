import DashboardClient from "@/components/DashboardClient"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { redirect } from "next/navigation"

export default async function DashboardPage() {
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

  const serializedAgents = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    alias: agent.alias,
    agentType: agent.agentType,
    connectionTier: agent.connectionTier,
    lastActiveAt: agent.lastActiveAt?.toISOString() ?? null,
  }))

  const serializedTaskRuns = taskRuns.map((run) => ({
    id: run.id,
    agentId: run.agentId,
    taskBody: run.taskBody,
    sessionTitle: run.sessionTitle ?? null,
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
