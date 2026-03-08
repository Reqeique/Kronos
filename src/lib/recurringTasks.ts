import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { v4 as uuidv4 } from "uuid";
import { CronExpressionParser } from "cron-parser";

export async function handleRecurringTask(completedTaskRunId: string) {
    try {
        const taskRun = await prisma.taskRun.findUnique({
            where: { id: completedTaskRunId }
        });

        if (!taskRun || !taskRun.cronSchedule || taskRun.status !== "COMPLETED") {
            return null; // Only schedule next if there's a cron and it completed successfully
        }

        // Parse cron to get the next execution time
        const interval = CronExpressionParser.parse(taskRun.cronSchedule, {
            currentDate: new Date()
        });
        const nextDate = interval.next().toDate();

        const webhookToken = uuidv4();

        const newTaskRun = await prisma.taskRun.create({
            data: {
                userId: taskRun.userId,
                agentId: taskRun.agentId,
                taskBody: taskRun.taskBody,
                status: "SCHEDULED",
                schedulingMode: taskRun.schedulingMode,
                scheduledAt: nextDate,
                timeoutMinutes: taskRun.timeoutMinutes,
                slackChannelId: taskRun.slackChannelId,
                cronSchedule: taskRun.cronSchedule,
                webhookToken,
            },
        });

        logger.info("Created next recurring task run", {
            previousTaskRunId: taskRun.id,
            newTaskRunId: newTaskRun.id,
            scheduledAt: nextDate,
        });

        return newTaskRun;
    } catch (error) {
        logger.error("Failed to handle recurring task", {
            taskRunId: completedTaskRunId,
            error: String(error)
        });
        return null;
    }
}
