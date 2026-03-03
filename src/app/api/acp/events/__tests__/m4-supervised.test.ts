import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import prisma from "@/lib/prisma";
import eventBus from "@/lib/eventBus";
import { auth } from "@/lib/auth";

vi.mock("@/lib/prisma", () => ({
    default: {
        taskRun: {
            findUnique: vi.fn(),
            findFirst: vi.fn(),
            update: vi.fn(),
        },
    },
}));

vi.mock("@/lib/auth", () => ({
    auth: vi.fn(),
}));

vi.mock("@/lib/eventBus", () => ({
    default: {
        emitTaskRunUpdated: vi.fn(),
    },
}));

vi.mock("@/lib/logger", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    },
}));

function makeRequest(body: unknown): NextRequest {
    return new NextRequest("http://localhost/api/acp/events", {
        method: "POST",
        body: JSON.stringify(body),
    });
}

describe("POST /api/acp/events - M4 Supervised Mode", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const mockSupervisedTask = {
        id: "task-123",
        userId: "user-1",
        agentId: "agent-1",
        status: "IN_PROGRESS",
        schedulingMode: "SUPERVISED",
        startedAt: new Date("2026-02-26T12:00:00Z"),
        dispatchedAt: new Date("2026-02-26T11:59:00Z"),
        updatedAt: new Date("2026-02-26T12:00:00Z"),
        pauseCount: 0,
        totalActiveDuration: 0,
        totalWaitDuration: 0,
        webhookToken: "token-123",
        agent: { alias: "claude-code", name: "Claude Code" },
    };

    it("enters WAITING state on session/pause for SUPERVISED tasks", async () => {
        (auth as any).mockResolvedValue({ user: { id: "user-1" } });
        (prisma.taskRun.findFirst as any).mockResolvedValue(mockSupervisedTask);
        (prisma.taskRun.update as any).mockResolvedValue({
            ...mockSupervisedTask,
            status: "WAITING",
            pauseCount: 1,
        });

        const res = await POST(makeRequest({
            eventType: "session/pause",
            alias: "claude-code",
            timestamp: "2026-02-26T12:05:00Z",
        }));

        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.data.status).toBe("WAITING");
        expect(data.data.pauseCount).toBe(1);
        expect(prisma.taskRun.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: "WAITING" })
        }));
    });

    it("resumes to IN_PROGRESS on session/resume from WAITING", async () => {
        const waitingTask = { ...mockSupervisedTask, status: "WAITING", updatedAt: new Date("2026-02-26T12:05:00Z") };
        (auth as any).mockResolvedValue({ user: { id: "user-1" } });
        (prisma.taskRun.findFirst as any).mockResolvedValue(waitingTask);
        (prisma.taskRun.update as any).mockResolvedValue({
            ...waitingTask,
            status: "IN_PROGRESS",
        });

        const res = await POST(makeRequest({
            eventType: "session/resume",
            alias: "claude-code",
            timestamp: "2026-02-26T12:10:00Z",
        }));

        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.data.status).toBe("IN_PROGRESS");
    });

    it("ignores session/pause for AUTONOMOUS tasks", async () => {
        const autonomousTask = { ...mockSupervisedTask, schedulingMode: "AUTONOMOUS" };
        (auth as any).mockResolvedValue({ user: { id: "user-1" } });
        (prisma.taskRun.findFirst as any).mockResolvedValue(autonomousTask);

        const res = await POST(makeRequest({
            eventType: "session/pause",
            alias: "claude-code",
        }));

        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.data.ignored).toBe(true);
        expect(prisma.taskRun.update).not.toHaveBeenCalled();
    });
});
