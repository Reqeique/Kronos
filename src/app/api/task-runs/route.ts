import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { errorResponse, successResponse, Errors } from "@/lib/errors";
import { dispatchTaskMessage } from "@/lib/slack";
import eventBus from "@/lib/eventBus";
import { VALID_TRANSITIONS } from "@/types";
import type { TaskStatus } from "@/types";
import logger from "@/lib/logger";
import { v4 as uuidv4 } from "uuid";
import {
    buildLifecycleUpdate,
    isSchedulingMode,
} from "@/lib/taskRunLifecycle";

// GET /api/task-runs list task runs for current user
export async function GET(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) throw Errors.unauthorized();

        const userId = (session.user as { id: string }).id;
        const { searchParams } = new URL(req.url);

        const status = searchParams.get("status");
        const agentId = searchParams.get("agentId");
        const from = searchParams.get("from");
        const to = searchParams.get("to");

        const where: Record<string, unknown> = { userId };
        if (status) where.status = status;
        if (agentId) where.agentId = agentId;
        if (from || to) {
            where.scheduledAt = {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
            };
        }

        const taskRuns = await prisma.taskRun.findMany({
            where,
            include: { agent: { select: { alias: true, name: true } } },
            orderBy: { scheduledAt: "asc" },
        });

        return successResponse(taskRuns);
    } catch (error) {
        return errorResponse(error);
    }
}

// POST /api/task-runs create new task run in SCHEDULED state
export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) throw Errors.unauthorized();

        const userId = (session.user as { id: string }).id;
        const body = await req.json();

        const { agentId, taskBody, scheduledAt, schedulingMode, timeoutMinutes, slackChannelId, cronSchedule } = body;

        if (!agentId || !taskBody || !scheduledAt) {
            throw Errors.badRequest("agentId, taskBody, and scheduledAt are required");
        }

        const normalizedMode = `${schedulingMode ?? "AUTONOMOUS"}`.toUpperCase();
        if (!isSchedulingMode(normalizedMode)) {
            throw Errors.badRequest("schedulingMode must be AUTONOMOUS, SUPERVISED, or OBSERVED");
        }

        const agent = await prisma.agent.findFirst({ where: { id: agentId, userId } });
        if (!agent) throw Errors.notFound("Agent");

        const webhookToken = uuidv4();

        const taskRun = await prisma.taskRun.create({
            data: {
                userId,
                agentId,
                taskBody,
                status: "SCHEDULED",
                schedulingMode: normalizedMode,
                scheduledAt: new Date(scheduledAt),
                timeoutMinutes: timeoutMinutes ?? 60,
                slackChannelId: slackChannelId ?? null,
                cronSchedule: cronSchedule ?? null,
                webhookToken,
            },
        });

        // If overdue, try immediate dispatch for non-OBSERVED modes
        if (normalizedMode !== "OBSERVED" && new Date(scheduledAt) <= new Date()) {
            try {
                const user = await prisma.user.findUnique({ where: { id: userId } });
                if (user?.slackAccessToken && slackChannelId) {
                    await dispatchTaskMessage(taskRun.id, userId);
                    eventBus.emitTaskRunUpdated({
                        id: taskRun.id,
                        status: "DISPATCHED",
                        agentId: taskRun.agentId,
                        dispatchedAt: new Date().toISOString(),
                    });
                }
            } catch (dispatchErr) {
                logger.warn("Immediate dispatch failed, scheduler will retry", {
                    taskRunId: taskRun.id,
                    error: String(dispatchErr),
                });
            }
        }

        logger.info("Task run created", {
            taskRunId: taskRun.id,
            agentAlias: agent.alias,
            scheduledAt,
            mode: normalizedMode,
        });

        return successResponse({ ...taskRun, webhookToken }, 201);
    } catch (error) {
        return errorResponse(error);
    }
}

// PATCH /api/task-runs update task run status (state machine enforced)
export async function PATCH(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) throw Errors.unauthorized();

        const userId = (session.user as { id: string }).id;
        const body = await req.json();
        const { id, status: newStatus, failureReason, action } = body;

        if (!id) throw Errors.badRequest("id is required");

        const taskRun = await prisma.taskRun.findFirst({ where: { id, userId } });
        if (!taskRun) throw Errors.notFound("Task run");

        // Special action: dispatch now
        if (action === "dispatch") {
            if (taskRun.schedulingMode === "OBSERVED") {
                throw Errors.badRequest("OBSERVED tasks are read-only and cannot be manually dispatched");
            }

            const user = await prisma.user.findUnique({ where: { id: userId } });
            if (!user?.slackAccessToken) throw Errors.badRequest("Slack not connected");
            if (!taskRun.slackChannelId) throw Errors.badRequest("No Slack channel specified");

            await dispatchTaskMessage(id, userId);
            eventBus.emitTaskRunUpdated({ id, status: "DISPATCHED", agentId: taskRun.agentId });
            return successResponse({ dispatched: true });
        }

        if (!newStatus) throw Errors.badRequest("status is required");

        if (taskRun.schedulingMode === "OBSERVED") {
            throw Errors.badRequest("OBSERVED tasks are read-only and cannot be manually state-mutated");
        }

        // State machine enforcement
        const currentStatus = taskRun.status as TaskStatus;
        const validNext = VALID_TRANSITIONS[currentStatus] ?? [];
        if (!validNext.includes(newStatus as TaskStatus)) {
            throw Errors.badRequest(
                `Invalid transition: ${currentStatus} -> ${newStatus}. Valid: ${validNext.join(", ")}`,
            );
        }
        if (newStatus === "WAITING" && taskRun.schedulingMode !== "SUPERVISED") {
            throw Errors.badRequest("WAITING state is only valid for SUPERVISED mode");
        }

        const now = new Date();
        const updateData = buildLifecycleUpdate(taskRun, newStatus as TaskStatus, now);
        if (failureReason) updateData.failureReason = failureReason;

        const updated = await prisma.taskRun.update({ where: { id }, data: updateData });

        eventBus.emitTaskRunUpdated({
            id: updated.id,
            status: updated.status,
            agentId: updated.agentId,
            completedAt: updated.completedAt?.toISOString() ?? null,
            startedAt: updated.startedAt?.toISOString() ?? null,
            dispatchedAt: updated.dispatchedAt?.toISOString() ?? null,
            pauseCount: updated.pauseCount,
            totalActiveDuration: updated.totalActiveDuration,
            totalWaitDuration: updated.totalWaitDuration,
        });

        logger.info("Task run status updated", {
            taskRunId: id,
            from: currentStatus,
            to: newStatus,
            mode: taskRun.schedulingMode,
        });

        return successResponse(updated);
    } catch (error) {
        return errorResponse(error);
    }
}
