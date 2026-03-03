import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../route";
import prisma from "@/lib/prisma";
import eventBus from "@/lib/eventBus";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
    default: {
        taskRun: {
            findFirst: vi.fn(),
            update: vi.fn(),
        },
    },
}));

vi.mock("@/lib/eventBus", () => ({
    default: {
        emitTaskRunUpdated: vi.fn(),
    },
}));

vi.mock("@/lib/logger", () => {
    class Logger {
        static newTraceId = vi.fn(() => "mock-trace-id");
        warn = vi.fn();
        info = vi.fn();
        error = vi.fn();
    }
    const instance = new Logger();
    return {
        default: instance,
        logger: instance,
    };
});


describe("POST /api/webhook/complete", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should return 400 if taskId or token is missing", async () => {
        const req = new NextRequest("http://localhost/api/webhook/complete", {
            method: "POST",
            body: JSON.stringify({}),
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error.message).toContain("taskId and token are required");
    });

    it("should return 404 if task run is not found", async () => {
        (prisma.taskRun.findFirst as any).mockResolvedValue(null);

        const req = new NextRequest("http://localhost/api/webhook/complete", {
            method: "POST",
            body: JSON.stringify({ taskId: "123", token: "abc" }),
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(404);
        expect(data.error.message).toContain("Task run not found");
    });

    it("should return 401 if token is invalid", async () => {
        (prisma.taskRun.findFirst as any).mockResolvedValue({
            id: "123",
            webhookToken: "correct-token",
        });

        const req = new NextRequest("http://localhost/api/webhook/complete", {
            method: "POST",
            body: JSON.stringify({ taskId: "123", token: "wrong-token" }),
        });

        const res = await POST(req);
        expect(res.status).toBe(401);
    });

    it("should complete the task run and emit event", async () => {
        const taskRun = {
            id: "123",
            userId: "user-1",
            agentId: "agent-1",
            webhookToken: "token-123",
            status: "DISPATCHED",
            schedulingMode: "AUTONOMOUS",
            startedAt: null,
            dispatchedAt: new Date(),
            updatedAt: new Date(),
            pauseCount: 0,
            totalWaitDuration: 0,
            totalActiveDuration: 0,
        };
        (prisma.taskRun.findFirst as any).mockResolvedValue(taskRun);
        (prisma.taskRun.update as any).mockResolvedValue({
            ...taskRun,
            status: "COMPLETED",
        });

        const req = new NextRequest("http://localhost/api/webhook/complete", {
            method: "POST",
            body: JSON.stringify({ taskId: "123", token: "token-123", status: "success" }),
        });

        const res = await POST(req);
        const data = await res.json();


        expect(res.status).toBe(200);
        expect(data.data.status).toBe("COMPLETED");
        expect(prisma.taskRun.update).toHaveBeenCalled();
        expect(eventBus.emitTaskRunUpdated).toHaveBeenCalled();
    });
});
