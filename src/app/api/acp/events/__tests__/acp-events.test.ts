import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import prisma from "@/lib/prisma";
import eventBus from "@/lib/eventBus";
import { auth } from "@/lib/auth";

vi.mock("@/lib/prisma", () => ({
    default: {
        agent: {
            findUnique: vi.fn(),
            update: vi.fn(),
        },
        taskRun: {
            findUnique: vi.fn(),
            findFirst: vi.fn(),
            create: vi.fn(),
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

vi.mock("@/lib/logger", () => {
    class Logger {
        static newTraceId = vi.fn(() => "mock-trace-id");
        warn = vi.fn();
        info = vi.fn();
        error = vi.fn();
    }
    return { default: new Logger() };
});

function makeRequest(body: unknown): NextRequest {
    return new NextRequest("http://localhost/api/acp/events", {
        method: "POST",
        body: JSON.stringify(body),
    });
}

describe("POST /api/acp/events", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it("requires token or authenticated session for alias-based events", async () => {
        (auth as any).mockResolvedValue(null);

        const res = await POST(makeRequest({
            eventType: "session/new",
            alias: "claude-code",
        }));
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error.code).toBe("UNAUTHORIZED");
    });

    it("accepts alias + token bridge events without session cookies", async () => {
        const baseTaskRun = {
            id: "task-1",
            userId: "user-1",
            agentId: "agent-1",
            status: "DISPATCHED",
            schedulingMode: "OBSERVED",
            scheduledAt: new Date("2026-02-26T12:00:00.000Z"),
            dispatchedAt: new Date("2026-02-26T12:00:30.000Z"),
            startedAt: null,
            webhookToken: "bridge-token",
            acpSessionId: null,
            pauseCount: 0,
            totalWaitDuration: 0,
            totalActiveDuration: 0,
            updatedAt: new Date("2026-02-26T12:00:30.000Z"),
            agent: { alias: "claude-code", name: "Claude Code" },
        };

        (auth as any).mockResolvedValue(null);
        (prisma.taskRun.findFirst as any).mockResolvedValue(baseTaskRun);
        (prisma.taskRun.update as any).mockResolvedValue({
            ...baseTaskRun,
            status: "IN_PROGRESS",
            startedAt: new Date("2026-02-26T12:01:00.000Z"),
            acpSessionId: "sess-1",
        });

        const res = await POST(makeRequest({
            eventType: "session/new",
            alias: "claude-code",
            token: "bridge-token",
            sessionId: "sess-1",
        }));
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.data.status).toBe("IN_PROGRESS");
        expect(prisma.taskRun.findFirst).toHaveBeenCalled();
        expect(prisma.taskRun.update).toHaveBeenCalled();
        expect(eventBus.emitTaskRunUpdated).toHaveBeenCalled();
    });

    it("filters alias bridge lookup by webhook token", async () => {
        (auth as any).mockResolvedValue(null);
        (prisma.taskRun.findFirst as any)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null);

        const res = await POST(makeRequest({
            eventType: "session/new",
            alias: "claude-code",
            token: "bridge-token",
            sessionId: "sess-2",
        }));
        const data = await res.json();

        expect(res.status).toBe(404);
        expect(data.error.message).toContain("Active task run for @claude-code");

        const calls = (prisma.taskRun.findFirst as any).mock.calls;
        expect(calls[0][0].where.webhookToken).toBe("bridge-token");
        expect(calls[1][0].where.webhookToken).toBe("bridge-token");
    });

    it("uses user-scoped bridge token and auto-creates OBSERVED run on first attach", async () => {
        process.env.KRONOS_BRIDGE_TOKEN_SECRET = "test-bridge-secret";
        const { createBridgeToken } = await import("@/lib/bridgeToken");

        (auth as any).mockResolvedValue(null);
        (prisma.taskRun.findFirst as any)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null);
        (prisma.agent.findUnique as any).mockResolvedValue({
            id: "agent-1",
            alias: "claude-code",
            name: "Claude Code",
        });

        const created = {
            id: "task-obs-1",
            userId: "user-1",
            agentId: "agent-1",
            status: "DISPATCHED",
            schedulingMode: "OBSERVED",
            scheduledAt: new Date("2026-02-26T12:00:00.000Z"),
            dispatchedAt: new Date("2026-02-26T12:00:00.000Z"),
            startedAt: null,
            webhookToken: "new-token",
            acpSessionId: "sess-bridge",
            pauseCount: 0,
            totalWaitDuration: 0,
            totalActiveDuration: 0,
            updatedAt: new Date("2026-02-26T12:00:00.000Z"),
            agent: { alias: "claude-code", name: "Claude Code" },
        };

        (prisma.taskRun.create as any).mockResolvedValue(created);
        (prisma.taskRun.update as any).mockResolvedValue({
            ...created,
            status: "IN_PROGRESS",
            startedAt: new Date("2026-02-26T12:00:01.000Z"),
        });

        const bridgeToken = createBridgeToken("user-1", 300);

        const res = await POST(makeRequest({
            eventType: "session/new",
            alias: "claude-code",
            token: bridgeToken,
            sessionId: "sess-bridge",
        }));
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.data.status).toBe("IN_PROGRESS");
        expect(prisma.agent.findUnique).toHaveBeenCalled();
        expect(prisma.taskRun.create).toHaveBeenCalled();
        expect(prisma.taskRun.update).toHaveBeenCalled();
        delete process.env.KRONOS_BRIDGE_TOKEN_SECRET;
    });
});
