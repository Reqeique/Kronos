import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { errorResponse, Errors, successResponse } from "@/lib/errors";
import eventBus from "@/lib/eventBus";
import logger from "@/lib/logger";
import { verifyBridgeToken } from "@/lib/bridgeToken";
import {
    buildLifecycleUpdate,
    isTerminalStatus,
} from "@/lib/taskRunLifecycle";
import { handleRecurringTask } from "@/lib/recurringTasks";
import { randomUUID } from "node:crypto";

type AcpEventType = "session/new" | "session/pause" | "session/resume" | "session/prompt" | "session/end";

interface AcpEventBody {
    eventType?: string;
    taskId?: string;
    alias?: string;
    sessionId?: string;
    token?: string;
    timestamp?: string;
    status?: string;
    result?: string;
    latestAgentMessage?: string;
    failureReason?: string;
}

interface TaskRunWithAgent {
    id: string;
    userId: string;
    agentId: string;
    status: string;
    schedulingMode: string;
    scheduledAt: Date;
    dispatchedAt: Date | null;
    startedAt: Date | null;
    webhookToken: string | null;
    acpSessionId: string | null;
    pauseCount: number;
    totalWaitDuration: number;
    totalActiveDuration: number;
    latestAgentMessage?: string | null;
    updatedAt: Date;
    agent: {
        alias: string;
        name: string;
    };
}

function normalizeEventType(input: string | undefined): AcpEventType | null {
    if (!input) return null;
    const value = input.trim().toLowerCase();
    if (value === "session/new" || value === "session.new" || value === "new") return "session/new";
    if (value === "session/pause" || value === "session.pause" || value === "pause" || value === "permission") return "session/pause";
    if (value === "session/resume" || value === "session.resume" || value === "resume") return "session/resume";
    if (value === "session/prompt" || value === "session.prompt" || value === "prompt") return "session/prompt";
    if (value === "session/end" || value === "session.end" || value === "end") return "session/end";
    return null;
}

function parseTimestamp(input: string | undefined): Date {
    if (!input) return new Date();
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) return new Date();
    return parsed;
}

function classifyTerminalStatus(inputStatus?: string, inputResult?: string, failureReason?: string): {
    status: "COMPLETED" | "FAILED" | "TIMED_OUT";
    failureReason: string | null;
} {
    const normalized = `${inputStatus ?? inputResult ?? ""}`.trim().toLowerCase();
    const reason = failureReason?.trim() || null;

    if (normalized === "timeout" || normalized === "timed_out" || normalized === "timed-out") {
        return { status: "TIMED_OUT", failureReason: reason ?? "ACP session timed out" };
    }
    if (["failed", "failure", "error", "cancelled", "canceled"].includes(normalized) || reason) {
        return { status: "FAILED", failureReason: reason ?? "ACP session ended with failure" };
    }
    return { status: "COMPLETED", failureReason: null };
}

// POST /api/acp/events
// Ingest ACP lifecycle events and map to TaskRun state.
// Supports:
// 1) taskId + token (headless/agent path)
// 2) alias + authenticated session (alias-first user path)
// 3) alias + token (CLI bridge path)
export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        const sessionUserId = session?.user ? (session.user as { id: string }).id : null;

        const body = (await req.json()) as AcpEventBody;
        const eventType = normalizeEventType(body.eventType);
        if (!eventType) {
            throw Errors.badRequest("eventType must be one of: session/new, session/pause, session/resume, session/end");
        }

        const eventAt = parseTimestamp(body.timestamp);
        let taskRun: TaskRunWithAgent | null = null;

        if (body.taskId) {
            taskRun = await prisma.taskRun.findUnique({
                where: { id: body.taskId },
                include: { agent: { select: { alias: true, name: true } } },
            });
            if (!taskRun) throw Errors.notFound("Task run");

            if (sessionUserId) {
                if (taskRun.userId !== sessionUserId) throw Errors.forbidden();
            } else {
                if (!body.token || taskRun.webhookToken !== body.token) throw Errors.unauthorized();
            }
        } else {
            if (!body.alias) throw Errors.badRequest("Provide either taskId or alias");
            if (!sessionUserId && !body.token) throw Errors.unauthorized();
            const bridgeUserId = !sessionUserId
                ? (verifyBridgeToken(body.token)?.userId ?? null)
                : null;
            const authenticatedUserId = sessionUserId ?? bridgeUserId;

            const findActiveTaskRun = async (whereBase: Record<string, unknown>) => {
                if (body.sessionId) {
                    const bySession = await prisma.taskRun.findFirst({
                        where: {
                            ...whereBase,
                            acpSessionId: body.sessionId,
                            agent: { alias: body.alias },
                            status: { notIn: ["COMPLETED", "FAILED", "TIMED_OUT"] },
                        },
                        include: { agent: { select: { alias: true, name: true } } },
                        orderBy: { updatedAt: "desc" },
                    });
                    if (bySession) return bySession;
                }

                return prisma.taskRun.findFirst({
                    where: {
                        ...whereBase,
                        agent: { alias: body.alias },
                        status: { notIn: ["COMPLETED", "FAILED", "TIMED_OUT"] },
                    },
                    include: { agent: { select: { alias: true, name: true } } },
                    orderBy: [{ dispatchedAt: "desc" }, { scheduledAt: "desc" }],
                });
            };

            if (authenticatedUserId) {
                taskRun = await findActiveTaskRun({ userId: authenticatedUserId });
            }

            if (!taskRun && body.token) {
                taskRun = await findActiveTaskRun({ webhookToken: body.token });
            }

            // Bridge token mode can create an OBSERVED run on first attach.
            if (!taskRun && authenticatedUserId && eventType === "session/new") {
                const agent = await prisma.agent.findUnique({
                    where: { userId_alias: { userId: authenticatedUserId, alias: body.alias } },
                    select: { id: true, alias: true, name: true },
                });

                if (agent) {
                    taskRun = await prisma.taskRun.create({
                        data: {
                            userId: authenticatedUserId,
                            agentId: agent.id,
                            taskBody: "Observed terminal session",
                            status: "DISPATCHED",
                            schedulingMode: "OBSERVED",
                            scheduledAt: eventAt,
                            dispatchedAt: eventAt,
                            webhookToken: randomUUID(),
                            acpSessionId: body.sessionId ?? null,
                        },
                        include: { agent: { select: { alias: true, name: true } } },
                    });

                    logger.info("ACP bridge auto-created OBSERVED task run", {
                        taskRunId: taskRun.id,
                        alias: agent.alias,
                    });
                }
            }

            if (!taskRun) {
                throw Errors.notFound(`Active task run for @${body.alias}`);
            }
        }

        if (eventType === "session/pause" || eventType === "session/resume") {
            if (taskRun.schedulingMode !== "SUPERVISED") {
                return successResponse({
                    id: taskRun.id,
                    status: taskRun.status,
                    ignored: true,
                    reason: "pause/resume events are only applied in SUPERVISED mode",
                });
            }
        }

        if (eventType === "session/new" || eventType === "session/prompt") {
            if (isTerminalStatus(taskRun.status)) {
                return successResponse({ id: taskRun.id, status: taskRun.status, alreadyCompleted: true });
            }

            const updateData = buildLifecycleUpdate(taskRun, "IN_PROGRESS", eventAt, { failureReason: null });
            if (body.sessionId) updateData.acpSessionId = body.sessionId;
            if (body.latestAgentMessage?.trim()) {
                updateData.latestAgentMessage = body.latestAgentMessage.trim();
            }

            const updated = await prisma.taskRun.update({
                where: { id: taskRun.id },
                data: updateData,
            });

            eventBus.emitTaskRunUpdated({
                id: updated.id,
                status: updated.status,
                agentId: updated.agentId,
                startedAt: updated.startedAt?.toISOString() ?? null,
                dispatchedAt: updated.dispatchedAt?.toISOString() ?? null,
                totalActiveDuration: updated.totalActiveDuration,
                totalWaitDuration: updated.totalWaitDuration,
                latestAgentMessage: updated.latestAgentMessage,
            });

            logger.info(`ACP session ${eventType === "session/new" ? "started" : "prompting"}`, {
                taskRunId: updated.id,
                alias: taskRun.agent.alias,
                sessionId: body.sessionId ?? null,
                mode: taskRun.schedulingMode,
            });

            return successResponse({
                id: updated.id,
                status: updated.status,
                startedAt: updated.startedAt,
                latestAgentMessage: updated.latestAgentMessage,
            });
        }

        if (eventType === "session/pause") {
            if (isTerminalStatus(taskRun.status) || taskRun.status === "WAITING") {
                return successResponse({ id: taskRun.id, status: taskRun.status, alreadyApplied: true });
            }

            const updateData = buildLifecycleUpdate(taskRun, "WAITING", eventAt);
            if (body.sessionId) updateData.acpSessionId = body.sessionId;

            const updated = await prisma.taskRun.update({
                where: { id: taskRun.id },
                data: updateData,
            });

            eventBus.emitTaskRunUpdated({
                id: updated.id,
                status: updated.status,
                agentId: updated.agentId,
                pauseCount: updated.pauseCount,
                startedAt: updated.startedAt?.toISOString() ?? null,
                totalActiveDuration: updated.totalActiveDuration,
                totalWaitDuration: updated.totalWaitDuration,
            });

            logger.info("ACP session paused", {
                taskRunId: updated.id,
                alias: taskRun.agent.alias,
                sessionId: body.sessionId ?? null,
            });

            return successResponse({
                id: updated.id,
                status: updated.status,
                pauseCount: updated.pauseCount,
            });
        }

        if (eventType === "session/resume") {
            if (isTerminalStatus(taskRun.status)) {
                return successResponse({ id: taskRun.id, status: taskRun.status, alreadyCompleted: true });
            }
            if (taskRun.status !== "WAITING") {
                return successResponse({ id: taskRun.id, status: taskRun.status, alreadyApplied: true });
            }

            const updateData = buildLifecycleUpdate(taskRun, "IN_PROGRESS", eventAt);
            if (body.sessionId) updateData.acpSessionId = body.sessionId;

            const updated = await prisma.taskRun.update({
                where: { id: taskRun.id },
                data: updateData,
            });

            eventBus.emitTaskRunUpdated({
                id: updated.id,
                status: updated.status,
                agentId: updated.agentId,
                startedAt: updated.startedAt?.toISOString() ?? null,
                totalActiveDuration: updated.totalActiveDuration,
                totalWaitDuration: updated.totalWaitDuration,
            });

            logger.info("ACP session resumed", {
                taskRunId: updated.id,
                alias: taskRun.agent.alias,
                sessionId: body.sessionId ?? null,
            });

            return successResponse({
                id: updated.id,
                status: updated.status,
            });
        }

        if (isTerminalStatus(taskRun.status)) {
            return successResponse({ id: taskRun.id, status: taskRun.status, alreadyCompleted: true });
        }

        const terminal = classifyTerminalStatus(body.status, body.result, body.failureReason);
        const updateData = buildLifecycleUpdate(taskRun, terminal.status, eventAt, {
            completionPath: "ACP",
            failureReason: terminal.failureReason,
        });
        if (body.sessionId) updateData.acpSessionId = body.sessionId;
        if (body.latestAgentMessage?.trim()) {
            updateData.latestAgentMessage = body.latestAgentMessage.trim();
        }

        const updated = await prisma.taskRun.update({
            where: { id: taskRun.id },
            data: updateData,
        });

        eventBus.emitTaskRunUpdated({
            id: updated.id,
            status: updated.status,
            agentId: updated.agentId,
            completedAt: updated.completedAt?.toISOString() ?? null,
            completionPath: updated.completionPath,
            totalActiveDuration: updated.totalActiveDuration,
            totalWaitDuration: updated.totalWaitDuration,
            latestAgentMessage: updated.latestAgentMessage,
        });

        logger.info("ACP session ended", {
            taskRunId: updated.id,
            alias: taskRun.agent.alias,
            status: updated.status,
            sessionId: body.sessionId ?? null,
        });

        if (updated.status === "COMPLETED") {
            // Check and schedule next recurring run in the background
            void handleRecurringTask(updated.id);
        }

        return successResponse({
            id: updated.id,
            status: updated.status,
            completedAt: updated.completedAt,
            completionPath: updated.completionPath,
            latestAgentMessage: updated.latestAgentMessage,
        });
    } catch (error) {
        return errorResponse(error);
    }
}
