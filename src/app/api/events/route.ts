import { auth } from "@/lib/auth";
import eventBus from "@/lib/eventBus";
import logger from "@/lib/logger";

// GET /api/events — SSE real-time event stream
// Authenticated clients subscribe here to receive live task run state changes.
//
// Last-Event-ID replay: on reconnect the native EventSource automatically
// sends the last `id:` it received as the `Last-Event-ID` header. If present
// (i.e. this is a reconnect, not a first connection), we replay every event
// the server has buffered with id > lastSeen before attaching the live
// stream. Brand-new connections get only live events going forward so we
// don't duplicate the initial state the dashboard already fetches via REST.
export async function GET(req: Request) {
    const session = await auth();
    if (!session?.user) {
        return new Response("Unauthorized", { status: 401 });
    }

    const userId = (session.user as { id: string }).id;
    // Accept Last-Event-ID either from the standard header (sent
    // automatically by the browser on EventSource auto-reconnect) or from
    // a `?lastId=` query param (sent by our manual reconnect path, since
    // EventSource cannot set custom headers).
    const url = new URL(req.url);
    const lastEventIdRaw =
        req.headers.get("last-event-id") ?? url.searchParams.get("lastId");
    const lastId = lastEventIdRaw != null ? Number(lastEventIdRaw) : NaN;

    const encoder = new TextEncoder();
    let cleanup: (() => void) | null = null;

    const stream = new ReadableStream({
        start(controller) {
            let closed = false;

            const frame = (id: number, payload: unknown) => {
                const data = `id: ${id}\nevent: taskRunUpdated\ndata: ${JSON.stringify(payload)}\n\n`;
                controller.enqueue(encoder.encode(data));
            };

            // Send initial connected event
            controller.enqueue(
                encoder.encode(`event: connected\ndata: ${JSON.stringify({ userId })}\n\n`),
            );

            // Replay buffered events only on a genuine reconnect.
            if (Number.isFinite(lastId)) {
                for (const e of eventBus.since(lastId)) {
                    if (closed) break;
                    try {
                        frame(e.id, e.payload);
                    } catch {
                        closed = true;
                    }
                }
            }

            // Subscribe to live task run updates
            const unsubscribe = eventBus.onSequencedTaskRunUpdated((id, payload) => {
                if (closed) {
                    unsubscribe();
                    return;
                }
                try {
                    frame(id, payload);
                } catch {
                    closed = true;
                    unsubscribe();
                    clearInterval(pingInterval);
                }
            });

            // Keep-alive ping every 30s to prevent proxy timeouts
            const pingInterval = setInterval(() => {
                if (closed) {
                    clearInterval(pingInterval);
                    return;
                }
                try {
                    controller.enqueue(encoder.encode(`: ping\n\n`));
                } catch {
                    closed = true;
                    clearInterval(pingInterval);
                    unsubscribe();
                }
            }, 30_000);

            cleanup = () => {
                closed = true;
                unsubscribe();
                clearInterval(pingInterval);
                logger.info("SSE client disconnected", { userId });
            };

            logger.info("SSE client connected", { userId, lastEventId: lastEventIdRaw ?? null });
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
