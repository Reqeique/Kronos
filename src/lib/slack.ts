import { WebClient } from "@slack/web-api";
import prisma from "./prisma";
import logger from "./logger";

// ─── Get Slack client for a user ────────────────────────
export async function getSlackClient(userId: string): Promise<WebClient> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.slackAccessToken) {
        throw new Error("Slack not connected for this user");
    }
    return new WebClient(user.slackAccessToken);
}

// ─── Format the v1.1 dispatch message ───────────────────
function formatDispatchMessage(
    taskId: string,
    alias: string,
    taskBody: string,
    scheduledAt: Date,
    timeoutMinutes: number,
) {
    const scheduledStr = scheduledAt.toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
    });

    return [
        `*[Kronos] Task #${taskId.slice(0, 8)} dispatched to @${alias}*`,
        `*Task:* ${taskBody}`,
        `*Scheduled:* ${scheduledStr} | *Timeout:* ${timeoutMinutes}min`,
    ].join("\n");
}

// ─── Dispatch task message to Slack ─────────────────────
export async function dispatchTaskMessage(
    taskRunId: string,
    userId: string,
): Promise<void> {
    const taskRun = await prisma.taskRun.findFirst({
        where: { id: taskRunId, userId },
        include: { agent: true },
    });

    if (!taskRun) throw new Error(`TaskRun ${taskRunId} not found`);
    if (!taskRun.slackChannelId) throw new Error("No Slack channel set for this task run");

    const client = await getSlackClient(userId);

    const text = formatDispatchMessage(
        taskRun.id,
        taskRun.agent.alias,
        taskRun.taskBody,
        taskRun.scheduledAt,
        taskRun.timeoutMinutes,
    );

    const result = await client.chat.postMessage({
        channel: taskRun.slackChannelId,
        text,
        mrkdwn: true,
    });

    if (!result.ok || !result.ts) {
        throw new Error(`Slack API error: ${result.error}`);
    }

    // Store the message timestamp for reaction correlation
    await prisma.taskRun.update({
        where: { id: taskRunId },
        data: {
            slackMessageTs: result.ts,
            status: "DISPATCHED",
            dispatchedAt: new Date(),
        },
    });

    logger.info("Task dispatched to Slack", {
        taskRunId,
        alias: taskRun.agent.alias,
        channel: taskRun.slackChannelId,
        messageTs: result.ts,
    });
}

// ─── Build Slack OAuth install URL ───────────────────────
export function buildSlackInstallUrl(state: string): string {
    const params = new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID ?? "",
        scope: "chat:write,reactions:read,channels:read,im:write,channels:history",
        redirect_uri: process.env.SLACK_REDIRECT_URI ?? "http://localhost:3737/api/slack/callback",
        state,
    });
    return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

// ─── Verify Slack request signature ─────────────────────
export async function verifySlackSignature(
    req: Request,
    rawBody: string,
): Promise<boolean> {
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (!signingSecret) return false;

    const timestamp = req.headers.get("x-slack-request-timestamp");
    const signature = req.headers.get("x-slack-signature");

    if (!timestamp || !signature) return false;

    // Prevent replay attacks (5-minute window)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp)) > 300) return false;

    const baseStr = `v0:${timestamp}:${rawBody}`;

    // Use Web Crypto API (available in Next.js edge/node runtime)
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(signingSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const sigBytes = await crypto.subtle.sign("HMAC", key, encoder.encode(baseStr));
    const computedSig =
        "v0=" +
        Array.from(new Uint8Array(sigBytes))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");

    return computedSig === signature;
}
