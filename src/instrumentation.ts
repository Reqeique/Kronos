import { ensurePrismaReady } from "@/lib/prisma";
import { startScheduler } from "@/lib/scheduler";

export async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;
    if (process.env.NEXT_RUNTIME_KRONOS_SCHEDULER === "0") return;
    await ensurePrismaReady();
    // The periodic scheduler tick is sole dispatch authority for tasks
    // whose mode is non-Slack. Without this, tasks stay SCHEDULED forever
    // and `kronos agent watch-queue` consumers never see them via SSE.
    startScheduler();
}
