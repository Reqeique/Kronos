import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import prisma from "@/lib/prisma";
import eventBus from "@/lib/eventBus";
import { auth } from "@/lib/auth";

vi.mock("@/lib/prisma", () => ({
    default: {
        taskRun: {
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

function makeRequest(body: unknown): NextRequest {
    return new NextRequest("http://localhost/api/task-runs/permission", {
        method: "POST",
        body: JSON.stringify(body),
    });
}

describe("POST /api/task-runs/permission", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const mockWaitingTask = {
        id: "task-wait",
        userId: "user-1",
        agentId: "agent-1",
        status: "WAITING",
        schedulingMode: "SUPERVISED",
        startedAt: new Date("2026-02-26T12:00:00Z"),
        updatedAt: new Date("2026-02-26T12:05:00Z"),
        pauseCount: 1,
        totalActiveDuration: 5000,
        totalWaitDuration: 0,
    };

    it("approves a WAITING task and transitions it to IN_PROGRESS", async () => {
        (auth as any).mockResolvedValue({ user: { id: "user-1" } });
        (prisma.taskRun.findFirst as any).mockResolvedValue(mockWaitingTask);
        (prisma.taskRun.update as any).mockResolvedValue({
            ...mockWaitingTask,
            status: "IN_PROGRESS",
            totalWaitDuration: 60000, // 1 minute later
        });

        const res = await POST(makeRequest({
            id: "task-wait",
            action: "approve"
        }));

        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.data.status).toBe("IN_PROGRESS");
        expect(prisma.taskRun.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: "IN_PROGRESS" })
        }));
    });

    it("denies a WAITING task and transitions it to FAILED", async () => {
        (auth as any).mockResolvedValue({ user: { id: "user-1" } });
        (prisma.taskRun.findFirst as any).mockResolvedValue(mockWaitingTask);
        (prisma.taskRun.update as any).mockResolvedValue({
            ...mockWaitingTask,
            status: "FAILED",
            failureReason: "Denied by supervisor",
        });

        const res = await POST(makeRequest({
            id: "task-wait",
            action: "deny"
        }));

        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.data.status).toBe("FAILED");
        expect(data.data.failureReason).toBe("Denied by supervisor");
    });

    it("rejects non-SUPERVISED tasks", async () => {
        const autonomousTask = { ...mockWaitingTask, schedulingMode: "AUTONOMOUS", status: "WAITING" };
        (auth as any).mockResolvedValue({ user: { id: "user-1" } });
        (prisma.taskRun.findFirst as any).mockResolvedValue(autonomousTask);

        const res = await POST(makeRequest({
            id: "task-wait",
            action: "approve"
        }));

        const data = await res.json();
        expect(res.status).toBe(400);
        expect(data.error.message).toContain("Permission actions apply only to SUPERVISED tasks");
    });

    it("rejects non-WAITING tasks", async () => {
        const inProgressTask = { ...mockWaitingTask, status: "IN_PROGRESS" };
        (auth as any).mockResolvedValue({ user: { id: "user-1" } });
        (prisma.taskRun.findFirst as any).mockResolvedValue(inProgressTask);

        const res = await POST(makeRequest({
            id: "task-wait",
            action: "approve"
        }));

        const data = await res.json();
        expect(res.status).toBe(400);
        expect(data.error.message).toContain("Task must be in WAITING state");
    });
});
