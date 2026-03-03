import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { errorResponse, successResponse, Errors } from "@/lib/errors";
import logger from "@/lib/logger";

// POST /api/auth/register — Create a new user account
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

        // Check if user already exists
        const existing = await prisma.user.findUnique({
            where: { email },
        });

        if (existing) {
            throw Errors.conflict("An account with this email already exists");
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const user = await prisma.user.create({
            data: {
                email,
                name: name ?? null,
                passwordHash,
            },
        });

        logger.info("User registered", { userId: user.id, email });

        return successResponse(
            { id: user.id, email: user.email, name: user.name },
            201,
        );
    } catch (error) {
        return errorResponse(error);
    }
}
