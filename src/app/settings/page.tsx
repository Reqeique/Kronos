import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import SettingsPageClient from "@/components/SettingsPageClient";

export default async function SettingsPage() {
    const session = await auth();
    if (!session?.user) redirect("/login");

    const userId = (session.user as { id: string }).id;
    const agents = await prisma.agent.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, alias: true },
    });

    return <SettingsPageClient initialAgents={agents} />;
}
