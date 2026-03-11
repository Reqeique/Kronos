import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { errorResponse, successResponse, Errors } from "@/lib/errors";
import logger from "@/lib/logger";
import { DEMO_AGENTS } from "@/lib/demo-data";

const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

// Alias validation: lowercase letters, numbers, and hyphens only
const ALIAS_REGEX = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;

function sanitizeAlias(input: string): string {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 32);
}

// GET /api/agents — list agents for current user
export async function GET() {
    try {
        if (IS_DEMO) return successResponse(DEMO_AGENTS);

        const session = await auth();
        if (!session?.user) throw Errors.unauthorized();

        const userId = (session.user as { id: string }).id;
        const agents = await prisma.agent.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
        });

        return successResponse(agents);
    } catch (error) {
        return errorResponse(error);
    }
}

// POST /api/agents — register new agent
export async function POST(req: NextRequest) {
    try {
        if (IS_DEMO) throw Errors.badRequest("Demo mode is read-only — agent creation is disabled.");

        const session = await auth();
        if (!session?.user) throw Errors.unauthorized();

        const userId = (session.user as { id: string }).id;
        const body = await req.json();

        const { name, alias: rawAlias, agentType, connectionTier, acpServerUrl } = body;

        if (!name || !rawAlias) {
            throw Errors.badRequest("Name and alias are required");
        }

        const alias = sanitizeAlias(rawAlias);

        if (!ALIAS_REGEX.test(alias)) {
            throw Errors.badRequest(
                "Alias must be 2-32 chars, lowercase letters, numbers, and hyphens only"
            );
        }

        // Check uniqueness
        const existing = await prisma.agent.findUnique({
            where: { userId_alias: { userId, alias } },
        });

        if (existing) {
            throw Errors.conflict(`Alias @${alias} is already in use`);
        }

        const agent = await prisma.agent.create({
            data: {
                userId,
                name,
                alias,
                agentType: agentType ?? "CUSTOM",
                connectionTier: connectionTier ?? "WEBHOOK",
                acpServerUrl: acpServerUrl ?? null,
            },
        });

        logger.info("Agent registered", { agentId: agent.id, alias });

        return successResponse(agent, 201);
    } catch (error) {
        return errorResponse(error);
    }
}
