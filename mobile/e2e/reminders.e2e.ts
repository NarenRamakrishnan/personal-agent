import { test, expect, Page } from "@playwright/test";
const api = process.env.PERSON2_TEST_API!;
async function home(page: Page) {
  await page.goto("/"); await expect(page.getByText("A little less to remember.", { exact: true })).toBeVisible();
  // Refuse a stale/demo build rather than letting fake local data pass these tests.
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith("device.")))).toBe(true);
}
// Typed session: the same path as speech, through /sessions/parse and the review list.
async function typeSession(page: Page, phrases: string[]) {
  await page.getByRole("button", { name: "Type instead", exact: true }).click();
  for (const phrase of phrases) {
    await page.getByLabel("Your words", { exact: true }).fill(phrase);
    await page.getByRole("button", { name: "Add to session", exact: true }).click();
    await expect(page.getByLabel("Your words", { exact: true })).toHaveValue("");
  }
  await page.getByRole("button", { name: "Stop listening and review caught items", exact: true }).click();
  await expect(page.getByText("Review your session", { exact: true })).toBeVisible();
}
async function create(page: Page, command: string, title: string) {
  await typeSession(page, [command]);
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await expect(page.getByText("Edit reminder", { exact: true })).toBeVisible();
  await page.getByLabel("What should I remember?", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText(title, { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText("Session saved.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Open reminder: ${title}`, exact: true })).toBeVisible();
}
test.beforeEach(async ({ context, page }) => {
  await context.route("**/*", route => { const url = new URL(route.request().url()); return ["127.0.0.1", "localhost"].includes(url.hostname) ? route.continue() : route.abort(); });
  page.on("pageerror", error => { throw error; });
  await home(page);
});
test("typed session saves, reviews, edits, reloads, snoozes, completes and deletes", async ({ page }) => {
  const title = "Browser smoke call Mom";
  await create(page, "Remind me in five minutes to call Mom", title);
  await page.reload();
  await page.getByRole("button", { name: `Open reminder: ${title}`, exact: true }).click();
  await page.getByRole("button", { name: "Snooze 10 minutes", exact: true }).click();
  await expect(page.getByText("Snoozed until", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mark done", exact: true }).click();
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Show completed reminders", exact: true }).click();
  await page.getByRole("button", { name: `Open reminder: ${title}`, exact: true }).click();
  await page.getByRole("button", { name: "Delete reminder", exact: true }).click();
  await page.getByRole("button", { name: "Confirm delete", exact: true }).click();
  await expect(page.getByText("A little less to remember.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Open reminder: ${title}`, exact: true })).toHaveCount(0);
});
test("deleting from the review list waits for Done and can be undone", async ({ page }) => {
  await typeSession(page, ["Remind me tomorrow to water the plants", "Remind me tomorrow to pay rent"]);
  const cards = page.getByRole("button", { name: /^Delete / });
  await expect(cards).toHaveCount(2);
  await cards.first().click();
  await page.getByRole("button", { name: "Undo", exact: true }).first().click();
  await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(2);
  await page.getByRole("button", { name: /^Delete / }).first().click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText("Session saved.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Open reminder: / })).toHaveCount(1);
});
test("separate browser contexts get private device identities", async ({ page, browser }) => {
  await create(page, "Remind me tomorrow to buy milk", "Only this browser");
  const other = await browser.newContext();
  try { const second = await other.newPage(); await home(second); await expect(second.getByRole("button", { name: "Open reminder: Only this browser", exact: true })).toHaveCount(0); await expect(second.getByText("One less thing on your mind.", { exact: true })).toBeVisible(); }
  finally { await other.close(); }
});
test("email draft can be generated, edited and cancelled without sending", async ({ page }) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Email drafts", exact: true }).click();
  await page.getByLabel("Email command").fill("Write an email to Alex saying I'll be ten minutes late");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await page.getByLabel("Subject", { exact: true }).fill("Browser test edited draft");
  await page.getByLabel("Recipient email address").fill("alex@example.com");
  await expect(page.getByText("Nothing has been sent.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Cancel draft", exact: true }).click();
  await expect(page.getByText("Settings", { exact: true })).toBeVisible();
});
test("an email said during a session lands on the review list unsent", async ({ page }) => {
  await typeSession(page, ["Write an email to Alex saying I'll be ten minutes late"]);
  await expect(page.getByText("Email drafts needing approval", { exact: true })).toBeVisible();
  await expect(page.getByText("Heedly never sends email for you.", { exact: true })).toBeVisible();
});
test("a failed phrase keeps the text and a retry adds it once", async ({ page }) => {
  await page.getByRole("button", { name: "Type instead", exact: true }).click();
  await page.getByLabel("Your words", { exact: true }).fill("Remind me tomorrow to call Dad");
  await page.route(`${api}/sessions/parse`, route => route.fulfill({ status: 503, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ detail: "Temporary browser test failure" }) }));
  await page.getByRole("button", { name: "Add to session", exact: true }).click();
  await expect(page.getByText("We couldn't process those words. Try again or edit the text.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Your words", { exact: true })).toHaveValue("Remind me tomorrow to call Dad");
  await page.unroute(`${api}/sessions/parse`);
  await page.getByRole("button", { name: "Add to session", exact: true }).click();
  await expect(page.getByLabel("Your words", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Stop listening and review caught items", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(1);
});
test("native-only notifications fail clearly in a browser", async ({ page }) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Enable reminder notifications", exact: true }).click();
  await expect(page.getByText("Native notifications require", { exact: false })).toBeVisible();
});
