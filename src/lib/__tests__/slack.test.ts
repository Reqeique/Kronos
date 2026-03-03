import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatchTaskMessage } from "../slack";
import prisma from "../prisma";
import { WebClient } from "@slack/web-api";

vi.mock("../prisma", () => ({
    default: {
        taskRun: {
            findFirst: vi.fn(),
            update: vi.fn(),
        },
        user: {
            findUnique: vi.fn(),
        },
    },
}));

vi.mock("@slack/web-api", () => ({
    WebClient: vi.fn(function MockWebClient() {
        return {
        chat: {
            postMessage: vi.fn(),
        },
    };
    }),
}));

const MockWebClient = vi.mocked(WebClient);

vi.mock("../logger", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
    },
}));

describe("Slack Library", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("dispatchTaskMessage", () => {
        it("should throw error if task run not found", async () => {
            (prisma.taskRun.findFirst as any).mockResolvedValue(null);

            await expect(dispatchTaskMessage("123", "user-1")).rejects.toThrow("TaskRun 123 not found");
        });

        it("should throw error if slack not connected for user", async () => {
            (prisma.taskRun.findFirst as any).mockResolvedValue({
                id: "123",
                userId: "user-1",
                slackChannelId: "C123",
                agent: { alias: "agent-1" },
            });
            (prisma.user.findUnique as any).mockResolvedValue({
                id: "user-1",
                slackAccessToken: null,
            });

            await expect(dispatchTaskMessage("123", "user-1")).rejects.toThrow("Slack not connected for this user");
        });

        it("should post message to Slack and update task status", async () => {
            const taskRun = {
                id: "123",
                userId: "user-1",
                agentId: "agent-1",
                taskBody: "Hello world",
                scheduledAt: new Date(),
                timeoutMinutes: 60,
                slackChannelId: "C123",
                agent: { alias: "agent-1" },
            };
            (prisma.taskRun.findFirst as any).mockResolvedValue(taskRun);
            (prisma.user.findUnique as any).mockResolvedValue({
                id: "user-1",
                slackAccessToken: "xoxb-token",
            });

            const mockPostMessage = vi.fn().mockResolvedValue({ ok: true, ts: "123456789.000000" });
            MockWebClient.mockImplementation(function MockWebClient() {
                return {
                chat: {
                    postMessage: mockPostMessage,
                },
            } as any;
            });

            await dispatchTaskMessage("123", "user-1");

            expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({
                channel: "C123",
                text: expect.stringContaining("Task #123"),
            }));
            expect(prisma.taskRun.update).toHaveBeenCalledWith({
                where: { id: "123" },
                data: expect.objectContaining({
                    status: "DISPATCHED",
                    slackMessageTs: "123456789.000000",
                }),
            });
        });
    });
});
