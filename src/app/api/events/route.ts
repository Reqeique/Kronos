import { auth } from "@/lib/auth";
import eventBus from "@/lib/eventBus";
import logger from "@/lib/logger";

// GET /api/events — SSE real-time event stream
// Authenticated clients subscribe here to receive live task run state changes.
export async function GET() {
    const session = await auth();
    if (!session?.user) {
        return new Response("Unauthorized", { status: 401 });
    }

    const userId = (session.user as { id: string }).id;

    const encoder = new TextEncoder();
    let cleanup: (() => void) | null = null;

    const stream = new ReadableStream({
        start(controller) {
            // Send initial connected event
            controller.enqueue(
                encoder.encode(`event: connected\ndata: ${JSON.stringify({ userId })}\n\n`),
            );

            // Subscribe to task run updates
            const unsubscribe = eventBus.onTaskRunUpdated((payload) => {
                try {
                    const data = `event: taskRunUpdated\ndata: ${JSON.stringify(payload)}\n\n`;
                    controller.enqueue(encoder.encode(data));
                } catch {
                    // Client disconnected
                }
            });

            // Keep-alive ping every 30s to prevent proxy timeouts
            const pingInterval = setInterval(() => {
                try {
                    controller.enqueue(encoder.encode(`: ping\n\n`));
                } catch {
                    clearInterval(pingInterval);
                }
            }, 30_000);

            cleanup = () => {
                unsubscribe();
                clearInterval(pingInterval);
                logger.info("SSE client disconnected", { userId });
            };

            logger.info("SSE client connected", { userId });
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
            "X-Accel-Buffering": "no", // Disable Nginx buffering
        },
    });
}
