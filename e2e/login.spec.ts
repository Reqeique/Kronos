import { test, expect } from "@playwright/test";

test("has login page", async ({ page }) => {
    await page.goto("/login");

    // Expect a title "to contain" a substring.
    await expect(page).toHaveTitle(/Kronos/);

    // Expect login form to be visible
    await expect(page.locator("input[type='email']")).toBeVisible();
    await expect(page.locator("input[type='password']")).toBeVisible();
    await expect(page.locator("button[type='submit']")).toBeVisible();
});

