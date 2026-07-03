import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { errorResponse, Errors, successResponse } from "@/lib/errors";
import { verifyBridgeToken } from "@/lib/bridgeToken";
import logger from "@/lib/logger";

// Mirror validation from /api/agents so the bridge CLI and dashboard agree on shape.
const ALIAS_REGEX = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;

function sanitizeAlias(input: string): string {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 32);
}

function readToken(req: NextRequest): string | null {
    const header = req.headers.get("authorization") || "";
    if (header.toLowerCase().startsWith("bearer ")) {
        return header.slice(7).trim();
    }
    const queryToken = `${new URL(req.url).searchParams.get("token") || ""}`.trim();
    return queryToken || null;
}

async function authorize(req: NextRequest) {
    const token = readToken(req);
    const bridge = verifyBridgeToken(token);
    if (!bridge?.userId) throw Errors.unauthorized();
    return bridge;
}

// GET /api/bridge/agents?token=<bridge-token>
// List the caller's agent aliases. Used by `kronos setup` to verify / create aliases.
export async function GET(req: NextRequest) {
    try {
        const bridge = await authorize(req);
        const agents = await prisma.agent.findMany({
            where: { userId: bridge.userId },
            orderBy: { createdAt: "desc" },
            select: { id: true, alias: true, name: true, agentType: true, connectionTier: true, lastActiveAt: true },
        });
        return successResponse(agents);
    } catch (error) {
        return errorResponse(error);
    }
}

// POST /api/bridge/agents
// body: { token: <bridge-token>, alias: "...", name: "...", agentType?: "CUSTOM", connectionTier?: "WEBHOOK" }
// Create a new agent alias for the caller. Used by `kronos setup` so users don't
// have to leave the terminal to register aliases they intend to run.
export async function POST(req: NextRequest) {
    try {
        const bridge = await authorize(req);
        const body = (await req.json()) as {
            alias?: string;
            name?: string;
            agentType?: string;
            connectionTier?: string;
        };

        const { alias: rawAlias, name, agentType, connectionTier } = body;
        if (!rawAlias || !name) {
            throw Errors.badRequest("alias and name are required");
        }

        const alias = sanitizeAlias(rawAlias);
        if (!ALIAS_REGEX.test(alias)) {
            throw Errors.badRequest(
                "Alias must be 2-32 chars, lowercase letters, numbers, and hyphens only.",
            );
        }

        const existing = await prisma.agent.findUnique({
            where: { userId_alias: { userId: bridge.userId, alias } },
        });
        if (existing) {
            // Idempotent registration: return the existing alias with 200 so the
            // wizard can treat "already exists" as success.
            return successResponse({
                id: existing.id,
                alias: existing.alias,
                name: existing.name,
                agentType: existing.agentType,
                connectionTier: existing.connectionTier,
                alreadyExisted: true,
            });
        }

        const agent = await prisma.agent.create({
            data: {
                userId: bridge.userId,
                name,
                alias,
                agentType: agentType === "WEBHOOK" ? "WEBHOOK" : "CUSTOM",
                connectionTier: connectionTier === "POLLING" ? "POLLING" : "WEBHOOK",
            },
        });

        logger.info("Agent registered from bridge CLI", {
            agentId: agent.id,
            alias: agent.alias,
            userId: bridge.userId,
        });

        return successResponse(
            {
                id: agent.id,
                alias: agent.alias,
                name: agent.name,
                agentType: agent.agentType,
                connectionTier: agent.connectionTier,
                alreadyExisted: false,
            },
            201,
        );
    } catch (error) {
        return errorResponse(error);
    }
}
