import { test, expect, Page } from "@playwright/test";
const api = process.env.PERSON2_TEST_API!;
async function home(page: Page) {
  await page.goto("/"); await expect(page.getByText("Your reminders", { exact: true })).toBeVisible();
  // Refuse a stale/demo build rather than letting fake local data pass these tests.
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith("device.")))).toBe(true);
}
async function create(page: Page, command: string, title: string) {
  await page.getByRole("button", { name: "Add reminder", exact: true }).click();
  await page.getByLabel("What should I remember?").fill(command);
  await page.getByRole("button", { name: "Review reminder", exact: true }).click();
  await expect(page.getByText("Confirm reminder", { exact: true })).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Save reminder", exact: true }).click();
  await expect(page.getByRole("button", { name: `Open reminder: ${title}`, exact: true })).toBeVisible();
}
test.beforeEach(async ({ context, page }) => {
  await context.route("**/*", route => { const url = new URL(route.request().url()); return ["127.0.0.1", "localhost"].includes(url.hostname) ? route.continue() : route.abort(); });
  page.on("pageerror", error => { throw error; });
  await home(page);
});
test("real reminder review/edit/save/reload/snooze/complete/delete", async ({ page }) => {
  const title = "Browser smoke call Mom";
  await create(page, "Remind me in five minutes to call Mom", title);
  await page.reload();
  await page.getByRole("button", { name: `Open reminder: ${title}`, exact: true }).click();
  await page.getByRole("button", { name: "Snooze 10 minutes", exact: true }).click();
  await expect(page.getByText("Snoozed until: Not snoozed", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Mark complete", exact: true }).click();
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  await page.reload(); await page.getByText("Show completed", { exact: true }).click();
  await page.getByRole("button", { name: `Open reminder: ${title}`, exact: true }).click();
  await page.getByRole("button", { name: "Delete reminder", exact: true }).click();
  await page.getByRole("button", { name: "Confirm delete", exact: true }).click();
  await expect(page.getByText("Your reminders", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Open reminder: ${title}`, exact: true })).toHaveCount(0);
});
test("separate browser contexts get private device identities", async ({ page, browser }) => {
  await create(page, "Remind me tomorrow to buy milk", "Only this browser");
  const other = await browser.newContext();
  try { const second = await other.newPage(); await home(second); await expect(second.getByRole("button", { name: "Open reminder: Only this browser", exact: true })).toHaveCount(0); await expect(second.getByText("Nothing here yet", { exact: true })).toBeVisible(); }
  finally { await other.close(); }
});
test("email draft can be generated, edited and cancelled without sending", async ({ page }) => {
  await page.getByRole("button", { name: "Draft an email", exact: true }).click();
  await page.getByLabel("Email command").fill("Write an email to Alex saying I'll be ten minutes late");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await page.getByLabel("Subject", { exact: true }).fill("Browser test edited draft");
  await page.getByLabel("Recipient email address").fill("alex@example.com");
  await expect(page.getByText("Nothing has been sent.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Cancel draft", exact: true }).click();
  await expect(page.getByText("Your reminders", { exact: true })).toBeVisible();
});
test("parse failure preserves text and retry uses the real backend", async ({ page }) => {
  await page.getByRole("button", { name: "Add reminder", exact: true }).click();
  await page.getByLabel("What should I remember?").fill("Remind me tomorrow to call Dad");
  await page.route(`${api}/parse`, route => route.fulfill({ status: 503, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ detail: "Temporary browser test failure" }) }));
  await page.getByRole("button", { name: "Review reminder", exact: true }).click();
  await expect(page.getByText("Temporary browser test failure", { exact: true })).toBeVisible();
  await expect(page.getByLabel("What should I remember?")).toHaveValue("Remind me tomorrow to call Dad");
  await page.unroute(`${api}/parse`); await page.getByRole("button", { name: "Review reminder", exact: true }).click();
  await expect(page.getByText("Confirm reminder", { exact: true })).toBeVisible();
});
test("native-only notifications fail clearly in a browser", async ({ page }) => {
  await page.getByRole("button", { name: "Enable reminder notifications", exact: true }).click();
  await expect(page.getByText("Native notifications require", { exact: false })).toBeVisible();
});
