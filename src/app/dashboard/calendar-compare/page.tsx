import { auth } from "@/lib/auth";
import CalendarCompareClient from "@/components/CalendarCompareClient";
import { redirect } from "next/navigation";

export default async function CalendarComparePage() {
    const session = await auth();
    if (!session?.user) {
        redirect("/login");
    }

    return (
        <CalendarCompareClient
            userName={session.user.name ?? "user"}
        />
    );
}
