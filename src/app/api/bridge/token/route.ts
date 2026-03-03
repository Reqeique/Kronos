import { auth } from "@/lib/auth";
import { createBridgeToken } from "@/lib/bridgeToken";
import { errorResponse, Errors, successResponse } from "@/lib/errors";

// POST /api/bridge/token
// Mint a user-scoped bridge token for CLI `kronos watch`.
export async function POST() {
    try {
        const session = await auth();
        if (!session?.user) throw Errors.unauthorized();

        const userId = (session.user as { id: string }).id;
        const token = createBridgeToken(userId);

        return successResponse({ token });
    } catch (error) {
        return errorResponse(error);
    }
}

