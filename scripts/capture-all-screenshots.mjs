import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.KRONOS_PORT || "3737"}`;
const email = process.env.DEMO_EMAIL || "demo@example.com";
const password = process.env.DEMO_PASSWORD || "password";
const outDir = process.env.OUT_DIR || "docs/assets/screenshots";

fs.mkdirSync(outDir, { recursive: true });

const shots = [];
function out(name) {
  const p = path.join(outDir, `${name}.png`);
  shots.push(p);
  return p;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });

async function safeWait(ms) {
  await page.waitForTimeout(ms);
}

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await safeWait(1000);
  await page.screenshot({ path: out("01-login"), fullPage: true });
  const registerTab = page.getByRole("tab", { name: "Register" });
  if (await registerTab.count()) {
    await registerTab.first().click();
    await safeWait(400);
    await page.screenshot({ path: out("01b-login-register"), fullPage: true });
    const signInTab = page.getByRole("tab", { name: "Sign In" });
    if (await signInTab.count()) {
      await signInTab.first().click();
      await safeWait(200);
    }
  }

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL((url) => url.pathname.includes("/dashboard"), { timeout: 120000 });
  await safeWait(2000);

  await page.screenshot({ path: out("02-dashboard-overview"), fullPage: true });

  const taskRunsNav =
    (await page.getByRole("link", { name: "Task Runs" }).count()) > 0
      ? page.getByRole("link", { name: "Task Runs" }).first()
      : page.getByText("Task Runs").first();
  if (await taskRunsNav.count()) {
    await taskRunsNav.click();
    await safeWait(1200);
    await page.screenshot({ path: out("03-dashboard-task-runs"), fullPage: true });
  }

  const calendarNav =
    (await page.getByRole("link", { name: "Calendar" }).count()) > 0
      ? page.getByRole("link", { name: "Calendar" }).first()
      : page.getByText("Calendar").first();
  if (await calendarNav.count()) {
    await calendarNav.click();
    await safeWait(1200);
    await page.screenshot({ path: out("04-dashboard-calendar"), fullPage: true });
  }

  await page.evaluate(() => {
    const el = document.querySelector("#calendar");
    if (el) el.scrollIntoView({ behavior: "instant", block: "start" });
  });
  await safeWait(700);
  await page.screenshot({ path: out("04b-calendar-section-focus"), fullPage: true });

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await safeWait(500);

  await page.goto(`${baseUrl}/dashboard`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await safeWait(1000);
  await page.screenshot({ path: out("04c-dashboard-top-reset"), fullPage: true });

  const newTaskButtons = page.getByRole("button", { name: "New Task" });
  if (await newTaskButtons.count()) {
    await newTaskButtons.first().click();
    await safeWait(1000);
    await page.screenshot({ path: out("05-new-task-modal"), fullPage: true });

    const taskDesc = page.getByLabel("Task Description");
    if (await taskDesc.count()) {
      await taskDesc.fill("Marketing screenshot task for gallery coverage.");
      await safeWait(300);
      await page.screenshot({ path: out("06-new-task-modal-filled"), fullPage: true });
    }

    const closeBtn = page.getByRole("button", { name: "Close" });
    if (await closeBtn.count()) {
      await closeBtn.first().click();
      await safeWait(600);
    } else {
      await page.keyboard.press("Escape");
      await safeWait(600);
    }
  }

  const userMenu = page.getByRole("button", { name: new RegExp(email, "i") });
  if (await userMenu.count()) {
    await userMenu.first().click();
    await safeWait(400);
    await page.screenshot({ path: out("07-user-menu"), fullPage: true });

    const settingsItem = page.getByRole("menuitem", { name: "Settings" });
    if (await settingsItem.count()) {
      await settingsItem.first().click();
      await safeWait(1000);
      await page.screenshot({ path: out("08-settings-modal"), fullPage: true });

      const closeSettings = page.getByRole("button", { name: "Close" });
      if (await closeSettings.count()) {
        await closeSettings.first().click();
        await safeWait(600);
      } else {
        await page.keyboard.press("Escape");
        await safeWait(600);
      }
    }
  }

  const detailsButtons = page.getByRole("button", { name: "Details" });
  if (await detailsButtons.count()) {
    await detailsButtons.first().click();
    await safeWait(1200);
    await page.screenshot({ path: out("09-task-detail-panel"), fullPage: true });
  }

  const connectSlackNav =
    (await page.getByRole("link", { name: "Connect Slack" }).count()) > 0
      ? page.getByRole("link", { name: "Connect Slack" }).first()
      : page.getByText("Connect Slack").first();
  if (await connectSlackNav.count()) {
    await connectSlackNav.click();
    await safeWait(1200);
    await page.screenshot({ path: out("10-connect-slack"), fullPage: true });
  }

  console.log(JSON.stringify({ count: shots.length, screenshots: shots }, null, 2));
} finally {
  await browser.close();
}
