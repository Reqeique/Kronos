import { chromium } from "playwright";

const baseUrl = process.env.BASE_URL || "http://localhost:3000";
const email = process.env.USER_EMAIL || `user.${Date.now()}@example.com`;
const password = process.env.USER_PASSWORD || "Passw0rd!123";
const name = process.env.USER_NAME || "Readme User";
const agentName = process.env.AGENT_NAME || "ACP Example Agent";
const agentAlias = process.env.AGENT_ALIAS || `acp-${Date.now().toString().slice(-6)}`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });

async function openSettings() {
  const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.getByRole("button", { name: new RegExp(escapedEmail) }).first().click({ force: true });
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("dialog", { name: "Settings" }).waitFor({ timeout: 20000 });
}

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 120000 });

  await page.getByRole("tab", { name: "Register" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create Account" }).click();

  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 120000 });
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: "domcontentloaded", timeout: 120000 });

  await openSettings();

  await page.getByLabel("Display Name").fill(agentName);
  await page.getByLabel("Alias (@handle)").fill(agentAlias);
  await page.getByRole("button", { name: "Create Agent" }).click();
  await page.waitForTimeout(1000);

  const tokenInput = page.getByPlaceholder("Click generate to get a token...");
  const tokenButton = tokenInput.locator("xpath=ancestor::div[contains(@class,'flex')][1]//button").first();
  await tokenButton.click();

  await page.waitForFunction(() => {
    const el = document.querySelector('input[placeholder="Click generate to get a token..."]');
    return Boolean(el && el.value && el.value.length > 10);
  }, { timeout: 30000 });

  const token = await tokenInput.inputValue();

  console.log(JSON.stringify({ email, password, agentAlias, token }, null, 2));
} finally {
  await browser.close();
}
