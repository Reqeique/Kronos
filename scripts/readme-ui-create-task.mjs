import { chromium } from "playwright";

const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.KRONOS_PORT || "3737"}`;
const email = process.env.USER_EMAIL;
const password = process.env.USER_PASSWORD;
const agentAlias = process.env.AGENT_ALIAS;
const taskBody = process.env.TASK_BODY || "Run ACP README verification task and summarize the result.";

if (!email || !password || !agentAlias) {
  throw new Error("Missing USER_EMAIL, USER_PASSWORD, or AGENT_ALIAS env vars.");
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle", timeout: 120000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 120000 });

  await page.getByRole("button", { name: "New Task" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New Task" });
  await dialog.waitFor({ timeout: 30000 });

  await dialog.getByRole("combobox").first().click();
  await dialog.getByRole("option", { name: new RegExp(`@${agentAlias}`) }).click();

  await dialog.getByLabel("Task Description").fill(taskBody);
  await dialog.getByRole("button", { name: "Schedule Task" }).click();

  await page.waitForTimeout(3000);
  console.log(JSON.stringify({ created: true, agentAlias, taskBody }, null, 2));
} finally {
  await browser.close();
}
