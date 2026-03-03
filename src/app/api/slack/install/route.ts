import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { buildSlackInstallUrl } from "@/lib/slack";
import { v4 as uuidv4 } from "uuid";

// GET /api/slack/install — redirect to Slack OAuth
export async function GET() {
    const session = await auth();
    if (!session?.user) {
        redirect("/login");
    }

    // Use userId as state for CSRF protection
    const userId = (session.user as { id: string }).id;
    const state = Buffer.from(JSON.stringify({ userId, nonce: uuidv4() })).toString("base64url");
    const installUrl = buildSlackInstallUrl(state);

    redirect(installUrl);
}
