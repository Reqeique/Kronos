import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as handleAcpEvent } from "../app/api/acp/events/route";
import { POST as handleRegisterAgent } from "../app/api/agents/route";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import eventBus from "@/lib/eventBus";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
    default: {
        agent: {
            findUnique: vi.fn(),
            create: vi.fn(),
        },
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

vi.mock("@/lib/logger", () => {
    return {
        default: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            constructor: {
                newTraceId: vi.fn(() => "mock-trace-id"),
            },
        },
    };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(url: string, body: unknown): NextRequest {
    return new NextRequest(url, {
        method: "POST",
        body: JSON.stringify(body),
    });
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe("M3 Verification: Alias System", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("sanitizes aliases correctly during registration", async () => {
        (auth as any).mockResolvedValue({ user: { id: "user-123" } });
        (prisma.agent.findUnique as any).mockResolvedValue(null);
        (prisma.agent.create as any).mockImplementation(({ data }: any) => ({
            id: "agent-1",
            ...data,
        }));

        const cases = [
            { input: "Claude Code", expected: "claude-code" },
            { input: "My_Agent_123", expected: "my-agent-123" },
            { input: "---too--many--hyphens---", expected: "too-many-hyphens" },
            { input: "Agent!", expected: "agent" },
        ];

        for (const { input, expected } of cases) {
            const req = makeRequest("http://localhost/api/agents", {
                name: "Test Agent",
                alias: input,
            });
            const res = await handleRegisterAgent(req);
            const data = await res.json();

            expect(res.status).toBe(201);
            expect(data.data.alias).toBe(expected);
        }
    });

    it("prevents duplicate aliases for the same user", async () => {
        (auth as any).mockResolvedValue({ user: { id: "user-1" } });
        (prisma.agent.findUnique as any).mockResolvedValue({ id: "existing-agent" });

        const req = makeRequest("http://localhost/api/agents", {
            name: "Duplicate",
            alias: "existing",
        });
        const res = await handleRegisterAgent(req);
        const data = await res.json();

        expect(res.status).toBe(409);
        expect(data.error.code).toBe("CONFLICT");
    });
});

describe("M3 Verification: ACP Events & Time Accounting", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const mockTaskRun = {
        id: "task-1",
        userId: "user-1",
        status: "DISPATCHED",
        schedulingMode: "SUPERVISED",
        startedAt: null,
        dispatchedAt: new Date("2026-02-26T10:00:00Z"),
        totalActiveDuration: 0,
        totalWaitDuration: 0,
        pauseCount: 0,
        updatedAt: new Date("2026-02-26T10:00:00Z"),
        webhookToken: "token-123",
        agent: { alias: "my-agent", name: "My Agent" },
    };

    it("calculates active and wait duration correctly through a lifecycle", async () => {
        try {
            // 1. session/new (0s -> 0s)
            (prisma.taskRun.findUnique as any).mockResolvedValue(mockTaskRun);
            (prisma.taskRun.update as any).mockImplementation(({ data }: any) => ({
                ...mockTaskRun,
                ...data,
                startedAt: new Date("2026-02-26T10:00:00Z"),
                status: "IN_PROGRESS",
                updatedAt: new Date("2026-02-26T10:00:00Z"),
            }));

            await handleAcpEvent(makeRequest("http://localhost/api/acp/events", {
                taskId: "task-1",
                eventType: "session/new",
                token: "token-123",
                timestamp: "2026-02-26T10:00:00Z",
            }));

            // 2. session/pause (after 60s of work)
            const inProgressTask = {
                ...mockTaskRun,
                status: "IN_PROGRESS",
                startedAt: new Date("2026-02-26T10:00:00Z"),
                updatedAt: new Date("2026-02-26T10:00:00Z"),
            };
            (prisma.taskRun.findUnique as any).mockResolvedValue(inProgressTask);

            await handleAcpEvent(makeRequest("http://localhost/api/acp/events", {
                taskId: "task-1",
                eventType: "session/pause",
                token: "token-123",
                timestamp: "2026-02-26T10:01:00Z", // +60s
            }));

            const lastCall = vi.mocked(prisma.taskRun.update).mock.calls.at(-1);
            const data = lastCall?.[0].data as any;
            if (data.totalActiveDuration !== 60000) {
                console.error(`M3_FAIL: Pause step activeDuration mismatch. Expected 60000, got ${data.totalActiveDuration}`);
            }

            expect(data.status).toBe("WAITING");
            expect(data.totalActiveDuration).toBe(60000);
            expect(data.pauseCount).toBe(1);

            // 3. session/resume (after 30s of waiting)
            const waitingTask = {
                ...inProgressTask,
                status: "WAITING",
                totalActiveDuration: 60000,
                pauseCount: 1,
                updatedAt: new Date("2026-02-26T10:01:00Z"),
            };
            (prisma.taskRun.findUnique as any).mockResolvedValue(waitingTask);

            console.log("M3_TEST_LOG [RESUME_INPUTS]: status =", waitingTask.status);
            console.log("M3_TEST_LOG [RESUME_INPUTS]: updatedAt =", waitingTask.updatedAt.toISOString());
            console.log("M3_TEST_LOG [RESUME_INPUTS]: timestamp =", "2026-02-26T10:01:30Z");

            await handleAcpEvent(makeRequest("http://localhost/api/acp/events", {
                taskId: "task-1",
                eventType: "session/resume",
                token: "token-123",
                timestamp: "2026-02-26T10:01:30Z", // +30s wait
            }));

            const resumeCall = vi.mocked(prisma.taskRun.update).mock.calls.at(-1);
            const resumeData = resumeCall?.[0].data as any;
            if (resumeData.totalWaitDuration !== 30000) {
                throw new Error(`M3_FAIL_RESUME: Expected 30000, got ${resumeData.totalWaitDuration}`);
            }

            expect(resumeData.status).toBe("IN_PROGRESS");
            expect(resumeData.totalWaitDuration).toBeGreaterThanOrEqual(29000);
            expect(resumeData.totalWaitDuration).toBeLessThanOrEqual(31000);

            // 4. session/end (after another 40s of work)
            const resumedTask = {
                ...waitingTask,
                status: "IN_PROGRESS",
                totalWaitDuration: 30000,
                updatedAt: new Date("2026-02-26T10:01:30Z"),
                startedAt: new Date("2026-02-26T10:00:00Z"),
            };
            (prisma.taskRun.findUnique as any).mockResolvedValue(resumedTask);

            await handleAcpEvent(makeRequest("http://localhost/api/acp/events", {
                taskId: "task-1",
                eventType: "session/end",
                token: "token-123",
                timestamp: "2026-02-26T10:02:10Z", // +40s work
                status: "success"
            }));

            const endCall = vi.mocked(prisma.taskRun.update).mock.calls.at(-1);
            const endData = endCall?.[0].data as any;
            expect(endData.status).toBe("COMPLETED");
            // totalActiveDuration should be present because we were IN_PROGRESS
            expect(endData.totalActiveDuration).toBe(100000);
            // totalWaitDuration should NOT be present because we were not WAITING
            expect(endData.totalWaitDuration).toBeUndefined();
        } catch (e: any) {
            console.error("M3_TEST_EXCEPTION:", e.message);
            throw e;
        }
    });

    it("correctly identifies task runs via alias + token (CLI path)", async () => {
        (auth as any).mockResolvedValue(null);
        (prisma.taskRun.findFirst as any).mockResolvedValue(mockTaskRun);
        (prisma.taskRun.update as any).mockResolvedValue({ ...mockTaskRun, status: "IN_PROGRESS" });

        const res = await handleAcpEvent(makeRequest("http://localhost/api/acp/events", {
            alias: "my-agent",
            eventType: "session/new",
            token: "token-123",
        }));

        expect(res.status).toBe(200);
        expect(prisma.taskRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                webhookToken: "token-123",
                agent: { alias: "my-agent" }
            })
        }));
    });
});
