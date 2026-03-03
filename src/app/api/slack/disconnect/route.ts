import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { errorResponse, successResponse, Errors } from "@/lib/errors";
import logger from "@/lib/logger";

// POST /api/slack/disconnect — remove Slack integration for current user
export async function POST() {
    try {
        const session = await auth();
        if (!session?.user) throw Errors.unauthorized();

        const userId = (session.user as { id: string }).id;

        await prisma.user.update({
            where: { id: userId },
            data: {
                slackAccessToken: null,
                slackWorkspaceId: null,
                slackTeamName: null,
            },
        });

        logger.info("Slack workspace disconnected", { userId });

        return successResponse({ disconnected: true });
    } catch (error) {
        return errorResponse(error);
    }
}
