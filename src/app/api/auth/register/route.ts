import { NextRequest } from "next/server";
import { errorResponse, successResponse, Errors } from "@/lib/errors";
import logger from "@/lib/logger";

// POST /api/auth/register — Create a new user account
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { email, password, name } = body;

        if (!email || !password) {
            throw Errors.badRequest("Email and password are required");
        }

        if (password.length < 8) {
            throw Errors.badRequest("Password must be at least 8 characters");
        }

        // Hardcode success for demo branch
        const userId = "demo-user-123";

        logger.info("User registered", { userId, email });

        return successResponse(
            { id: userId, email, name: name ?? "Demo User" },
            201,
        );
    } catch (error) {
        return errorResponse(error);
    }
}
