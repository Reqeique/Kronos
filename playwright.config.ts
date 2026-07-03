import { defineConfig, devices } from "@playwright/test";

const PORT = `${process.env.KRONOS_PORT || "3737"}`.trim();
const BASE_URL = `${process.env.KRONOS_API_BASE_URL || "http://localhost:" + PORT}`;

export default defineConfig({
    testDir: "./e2e",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: "html",
    use: {
        baseURL: BASE_URL,
        trace: "on-first-retry",
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
    webServer: {
        command: "npm run dev",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        env: { KRONOS_PORT: PORT },
    },
});
