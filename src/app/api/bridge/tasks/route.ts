import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import eventBus from "@/lib/eventBus";
import { verifyBridgeToken } from "@/lib/bridgeToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StreamTask {
    id: string;
    taskBody: string;
    status: string;
    scheduledAt: Date;
    dispatchedAt: Date | null;
}

async function findRunnableTaskForAlias(
    userId: string,
    alias: string,
    taskId?: string,
): Promise<StreamTask | null> {
    const now = new Date();
    return prisma.taskRun.findFirst({
        where: {
            ...(taskId ? { id: taskId } : {}),
            userId,
            OR: [
                { status: "DISPATCHED" },
                { status: "SCHEDULED", scheduledAt: { lte: now } },
            ],
            agent: { alias },
        },
        select: {
            id: true,
            taskBody: true,
            status: true,
            scheduledAt: true,
            dispatchedAt: true,
        },
        orderBy: taskId ? undefined : [{ scheduledAt: "asc" }, { dispatchedAt: "asc" }],
    });
}

// GET /api/bridge/tasks?alias=<alias>&token=<bridge-token>
// Stream DISPATCHED tasks for the alias as SSE events for CLI queue consumers.
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const alias = `${searchParams.get("alias") || ""}`.trim();
    const token = searchParams.get("token");

    if (!alias || !token) {
        return new Response("Missing alias or token", { status: 400 });
    }

    const bridge = verifyBridgeToken(token);
    if (!bridge?.userId) {
        return new Response("Unauthorized", { status: 401 });
    }

    const encoder = new TextEncoder();
    const deliveredTaskIds = new Set<string>();
    let cleanup: (() => void) | null = null;

    const stream = new ReadableStream({
        async start(controller) {
            let closed = false;

            const send = (event: string, payload: Record<string, unknown>) => {
                if (closed) return;
                try {
                    controller.enqueue(
                        encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
                    );
                } catch {
                    closed = true;
                }
            };

            const sendTask = (task: StreamTask | null) => {
                if (!task || deliveredTaskIds.has(task.id)) return;
                deliveredTaskIds.add(task.id);
                send("task", {
                    taskId: task.id,
                    taskBody: task.taskBody,
                    status: task.status,
                    scheduledAt: task.scheduledAt.toISOString(),
                    dispatchedAt: task.dispatchedAt?.toISOString() ?? null,
                });
            };

            send("connected", {
                alias,
                userId: bridge.userId,
            });

            const initialTask = await findRunnableTaskForAlias(bridge.userId, alias);
            sendTask(initialTask);

            const unsubscribe = eventBus.onTaskRunUpdated(async (payload) => {
                if (closed) { unsubscribe(); return; }
                // Both SCHEDULED (newly created) and DISPATCHED (scheduler
                // flipped it) events are interesting here. The findRunnableTask
                // helper already enforces the "is it actually runnable for this
                // alias right now?" filter, so it's safe to forward any of
                // these.
                try {
                    const task = await findRunnableTaskForAlias(bridge.userId, alias, payload.id);
                    if (!task) return;
                    sendTask(task);
                } catch {
                    // Ignore transient errors in event handler
                }
            });

            const keepAlive = setInterval(() => {
                if (closed) { clearInterval(keepAlive); return; }
                try {
                    controller.enqueue(encoder.encode(": ping\n\n"));
                } catch {
                    closed = true;
                    clearInterval(keepAlive);
                    unsubscribe();
                }
            }, 30_000);

            // Push delivery is handled by eventBus (anchored to globalThis
            // via Symbol.for so all Next.js bundles share one EventEmitter).
            // See src/lib/eventBus.ts.
            cleanup = () => {
                closed = true;
                unsubscribe();
                clearInterval(keepAlive);
            };
        },
        cancel() {
            cleanup?.();
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        },
    });
}
