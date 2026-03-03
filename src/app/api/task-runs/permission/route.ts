import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { errorResponse, Errors, successResponse } from "@/lib/errors";
import eventBus from "@/lib/eventBus";
import { buildLifecycleUpdate } from "@/lib/taskRunLifecycle";

type PermissionAction = "approve" | "deny";

// POST /api/task-runs/permission
// Actionable endpoint for SUPERVISED WAITING tasks.
// - approve: WAITING -> IN_PROGRESS
// - deny: WAITING -> FAILED
export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) throw Errors.unauthorized();

        const userId = (session.user as { id: string }).id;
        const body = await req.json();
        const id = `${body?.id ?? ""}`;
        const action = `${body?.action ?? ""}`.toLowerCase() as PermissionAction;

        if (!id) throw Errors.badRequest("id is required");
        if (action !== "approve" && action !== "deny") {
            throw Errors.badRequest("action must be 'approve' or 'deny'");
        }

        const taskRun = await prisma.taskRun.findFirst({ where: { id, userId } });
        if (!taskRun) throw Errors.notFound("Task run");

        if (taskRun.schedulingMode !== "SUPERVISED") {
            throw Errors.badRequest("Permission actions apply only to SUPERVISED tasks");
        }
        if (taskRun.status !== "WAITING") {
            throw Errors.badRequest("Task must be in WAITING state");
        }

        const now = new Date();
        const nextStatus = action === "approve" ? "IN_PROGRESS" : "FAILED";
        const updateData = buildLifecycleUpdate(taskRun, nextStatus, now, {
            failureReason: action === "deny" ? "Denied by supervisor" : null,
        });

        const updated = await prisma.taskRun.update({
            where: { id },
            data: updateData,
        });

        eventBus.emitTaskRunUpdated({
            id: updated.id,
            status: updated.status,
            agentId: updated.agentId,
            startedAt: updated.startedAt?.toISOString() ?? null,
            completedAt: updated.completedAt?.toISOString() ?? null,
            pauseCount: updated.pauseCount,
            totalActiveDuration: updated.totalActiveDuration,
            totalWaitDuration: updated.totalWaitDuration,
        });

        return successResponse(updated);
    } catch (error) {
        return errorResponse(error);
    }
}
