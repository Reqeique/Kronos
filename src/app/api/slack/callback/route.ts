import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

// GET /api/slack/callback — exchange code for token, store on user
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    if (error) {
        logger.warn("Slack OAuth denied", { error });
        return NextResponse.redirect(new URL("/?slack=error", req.url));
    }

    if (!code || !state) {
        return NextResponse.redirect(new URL("/?slack=error", req.url));
    }

    // Decode state to get userId
    let userId: string;
    try {
        const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
        userId = decoded.userId;
    } catch {
        return NextResponse.redirect(new URL("/?slack=error", req.url));
    }

    // Exchange code for access token
    const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: process.env.SLACK_CLIENT_ID ?? "",
            client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
            code,
            redirect_uri: process.env.SLACK_REDIRECT_URI ?? "http://localhost:3000/api/slack/callback",
        }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenData.ok) {
        logger.error("Slack token exchange failed", { error: tokenData.error });
        return NextResponse.redirect(new URL("/?slack=error", req.url));
    }

    // Store Slack credentials on the user
    await prisma.user.update({
        where: { id: userId },
        data: {
            slackAccessToken: tokenData.access_token,
            slackWorkspaceId: tokenData.team?.id,
            slackTeamName: tokenData.team?.name,
        },
    });

    logger.info("Slack workspace connected", {
        userId,
        teamName: tokenData.team?.name,
        workspaceId: tokenData.team?.id,
    });

    return NextResponse.redirect(new URL("/?slack=connected", req.url));
}
