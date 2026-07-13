import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import eventBus from "@/lib/eventBus";
import { verifyBridgeToken } from "@/lib/bridgeToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StreamTask {
    id: string;
    taskBody: string;
    scheduledAt: Date;
    dispatchedAt: Date | null;
}

async function findDispatchedTaskForAlias(
    userId: string,
    alias: string,
    taskId?: string,
): Promise<StreamTask | null> {
    return prisma.taskRun.findFirst({
        where: {
            ...(taskId ? { id: taskId } : {}),
            userId,
            status: "DISPATCHED",
            agent: { alias },
        },
        select: {
            id: true,
            taskBody: true,
            scheduledAt: true,
            dispatchedAt: true,
        },
        orderBy: taskId ? undefined : [{ dispatchedAt: "desc" }, { scheduledAt: "desc" }],
    });
}

// GET /api/bridge/tasks/stream?alias=<alias>&token=<bridge-token>
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
            const send = (event: string, payload: Record<string, unknown>) => {
                controller.enqueue(
                    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
                );
            };

            const sendTask = (task: StreamTask | null) => {
                if (!task || deliveredTaskIds.has(task.id)) return;
                deliveredTaskIds.add(task.id);
                send("task", {
                    taskId: task.id,
                    taskBody: task.taskBody,
                    scheduledAt: task.scheduledAt.toISOString(),
                    dispatchedAt: task.dispatchedAt?.toISOString() ?? null,
                });
            };

            send("connected", {
                alias,
                userId: bridge.userId,
            });

            const initialTask = await findDispatchedTaskForAlias(bridge.userId, alias);
            sendTask(initialTask);

            const unsubscribe = eventBus.onTaskRunUpdated(async (payload) => {
                if (payload.status !== "DISPATCHED") return;
                const task = await findDispatchedTaskForAlias(bridge.userId, alias, payload.id);
                sendTask(task);
            });

            const keepAlive = setInterval(() => {
                try {
                    controller.enqueue(encoder.encode(": ping\n\n"));
                } catch {
                    clearInterval(keepAlive);
                }
            }, 30_000);

            // Push delivery is handled by eventBus (anchored to globalThis
            // via Symbol.for so all Next.js bundles share one EventEmitter).
            // See src/lib/eventBus.ts.
            cleanup = () => {
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
