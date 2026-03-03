import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/errors";
import { verifySlackSignature } from "@/lib/slack";
import eventBus from "@/lib/eventBus";
import logger from "@/lib/logger";
import { buildLifecycleUpdate, isTerminalStatus } from "@/lib/taskRunLifecycle";

// POST /api/slack/events — Slack Events API handler
// Handles: url_verification, reaction_added (Path C completion)
export async function POST(req: NextRequest) {
    try {
        const rawBody = await req.text();

        // Verify Slack signature (skip in dev if secret not configured)
        if (process.env.SLACK_SIGNING_SECRET) {
            const valid = await verifySlackSignature(req, rawBody);
            if (!valid) {
                return new Response("Unauthorized", { status: 401 });
            }
        }

        const payload = JSON.parse(rawBody);

        // ── URL Verification Challenge (required when setting up Slack app) ──
        if (payload.type === "url_verification") {
            return Response.json({ challenge: payload.challenge });
        }

        // ── Event Dispatch ────────────────────────────────────────────────────
        if (payload.type === "event_callback") {
            const event = payload.event;

            // Path C: reaction_added → complete task
            if (event.type === "reaction_added" && event.item?.type === "message") {
                const { ts: messageTs, channel } = event.item;

                // Find the task run by Slack message timestamp + channel
                const taskRun = await prisma.taskRun.findFirst({
                    where: {
                        slackMessageTs: messageTs,
                        slackChannelId: channel,
                    },
                });

                if (taskRun) {
                    // First-completion-wins guard
                    if (!isTerminalStatus(taskRun.status)) {
                        const now = new Date();
                        const updateData = buildLifecycleUpdate(taskRun, "COMPLETED", now, {
                            completionPath: "SLACK_REACTION",
                            failureReason: null,
                        });
                        const updated = await prisma.taskRun.update({
                            where: { id: taskRun.id },
                            data: updateData,
                        });

                        eventBus.emitTaskRunUpdated({
                            id: updated.id,
                            status: updated.status,
                            agentId: updated.agentId,
                            completedAt: now.toISOString(),
                            completionPath: "SLACK_REACTION",
                            totalActiveDuration: updated.totalActiveDuration,
                            totalWaitDuration: updated.totalWaitDuration,
                        });

                        logger.info("Task completed via Slack reaction", {
                            taskRunId: taskRun.id,
                            reaction: event.reaction,
                        });
                    }
                }
            }
        }

        // Always return 200 to Slack immediately
        return successResponse({ received: true });
    } catch (error) {
        logger.error("Slack events handler error", {
            error: error instanceof Error ? error.message : String(error),
        });
        // Still return 200 — Slack will retry on non-200
        return successResponse({ received: true });
    }
}
