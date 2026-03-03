import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { errorResponse, successResponse, Errors } from "@/lib/errors";
import eventBus from "@/lib/eventBus";
import logger from "@/lib/logger";
import { buildLifecycleUpdate, isTerminalStatus } from "@/lib/taskRunLifecycle";

// POST /api/webhook/complete — token-authenticated completion endpoint (Path B)
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { taskId, token, status, metadata } = body;

        if (!taskId || !token) {
            throw Errors.badRequest("taskId and token are required");
        }

        const taskRun = await prisma.taskRun.findFirst({
            where: { id: taskId },
        });

        if (!taskRun) throw Errors.notFound("Task run");

        // Token verification
        if (taskRun.webhookToken !== token) {
            throw Errors.unauthorized();
        }

        // First-completion-wins: only complete if not already terminal
        if (isTerminalStatus(taskRun.status)) {
            logger.info("Webhook completion already recorded (idempotent)", { taskRunId: taskId });
            return successResponse({ alreadyCompleted: true, status: taskRun.status });
        }

        const completionStatus = status === "failed" ? "FAILED" : "COMPLETED";
        const now = new Date();
        const updateData = buildLifecycleUpdate(taskRun, completionStatus, now, {
            completionPath: "WEBHOOK",
            failureReason: status === "failed" ? (metadata?.reason ?? "Unknown failure") : null,
        });

        const updated = await prisma.taskRun.update({
            where: { id: taskId },
            data: updateData,
        });

        // Broadcast real-time update
        eventBus.emitTaskRunUpdated({
            id: updated.id,
            status: updated.status,
            agentId: updated.agentId,
            completedAt: now.toISOString(),
            completionPath: "WEBHOOK",
            totalActiveDuration: updated.totalActiveDuration,
            totalWaitDuration: updated.totalWaitDuration,
        });

        logger.info("Task run completed via webhook", { taskRunId: taskId, completionStatus });

        return successResponse({
            id: updated.id,
            status: updated.status,
            completedAt: updated.completedAt,
        });
    } catch (error) {
        return errorResponse(error);
    }
}
