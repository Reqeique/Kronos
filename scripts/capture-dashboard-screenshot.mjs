import { chromium } from "playwright";

const baseUrl = process.env.BASE_URL || "http://localhost:3000";
const email = process.env.DEMO_EMAIL || "demo@example.com";
const password = process.env.DEMO_PASSWORD || "password";
const outPath = process.env.OUT_PATH || "docs/assets/dashboard-demo.png";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle", timeout: 120000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();

  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 120000 });
  await page.waitForURL((url) => url.pathname.includes("/dashboard"), { timeout: 120000 });
  await page.waitForTimeout(5000);

  await page.screenshot({ path: outPath, fullPage: true });
  console.log(`Screenshot saved to ${outPath}`);
} finally {
  await browser.close();
}
