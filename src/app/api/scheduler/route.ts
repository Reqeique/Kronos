import { auth } from "@/lib/auth";
import { runSchedulerTick } from "@/lib/scheduler";
import { errorResponse, successResponse, Errors } from "@/lib/errors";
import logger from "@/lib/logger";

// GET /api/scheduler — manually trigger a scheduler tick (dev/debug tool)
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user) throw Errors.unauthorized();

        logger.info("Manual scheduler tick triggered");
        await runSchedulerTick();

        return successResponse({ message: "Scheduler tick completed" });
    } catch (error) {
        return errorResponse(error);
    }
}
