import { test, expect, Page } from "@playwright/test";
const api = process.env.PERSON2_TEST_API!;
async function home(page: Page) {
  await page.goto("/"); await expect(page.getByText("A little less to remember.", { exact: true })).toBeVisible();
  // Refuse a stale/demo build rather than letting fake local data pass these tests.
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith("device.")))).toBe(true);
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
  await expect(page.getByText("A little less to remember.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Open reminder: ${title}`, exact: true })).toHaveCount(0);
  // One tap to delete, one tap to bring it back.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  // It comes back as it was: still completed.
  await expect(page.getByText("Done (1)", { exact: true })).toBeVisible();
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
test("a phrase that fails to send is kept and added once at review", async ({ page }) => {
  await page.getByRole("button", { name: "Type instead", exact: true }).click();
  await page.getByLabel("Your words", { exact: true }).fill("Remind me tomorrow to call Dad");
  await page.route(`${api}/sessions/parse`, route => route.fulfill({ status: 503, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ detail: "Temporary browser test failure" }) }));
  await page.getByRole("button", { name: "Add to session", exact: true }).click();
  await expect(page.getByText(/kept what you said and will try again when you review/)).toBeVisible();
  await page.unroute(`${api}/sessions/parse`);
  await page.getByRole("button", { name: "Stop listening and review caught items", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(1);
  // It reached Heedly at Stop, so the review mustn't also say it didn't.
  await expect(page.getByText("These didn't reach Heedly", { exact: true })).toHaveCount(0);
});
test("a dropped connection is explained in plain words", async ({ page }) => {
  await page.getByRole("button", { name: "Type instead", exact: true }).click();
  await page.route(`${api}/sessions/parse`, route => route.abort("internetdisconnected"));
  await page.getByLabel("Your words", { exact: true }).fill("Remind me tomorrow to call the bank");
  await page.getByLabel("Your words", { exact: true }).press("Enter");
  await expect(page.getByText(/can't be reached\. Check your connection\. Heedly kept what you said/)).toBeVisible();
  await expect(page.getByText(/Failed to fetch/)).toHaveCount(0);
});
test("words Heedly refuses come back to the box to fix", async ({ page }) => {
  await page.getByRole("button", { name: "Type instead", exact: true }).click();
  await page.route(`${api}/sessions/parse`, route => route.fulfill({ status: 422, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ detail: "Text is too long" }) }));
  await page.getByLabel("Your words", { exact: true }).fill("Remind me tomorrow to call Dad");
  await page.getByLabel("Your words", { exact: true }).press("Enter");
  await expect(page.getByText("Heedly couldn't use those words. Edit them and add again.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Your words", { exact: true })).toHaveValue("Remind me tomorrow to call Dad");
});
test("typing several things back to back without waiting keeps every one", async ({ page }) => {
  await page.getByRole("button", { name: "Type instead", exact: true }).click();
  const box = page.getByLabel("Your words", { exact: true });
  for (const phrase of ["Remind me tomorrow to call Dad", "Remind me tomorrow to pay rent", "Remind me tomorrow to buy stamps"]) {
    await box.fill(phrase); await box.press("Enter");
    await expect(box).toHaveValue(""); // cleared at once, ready for the next one
  }
  await page.getByRole("button", { name: "Stop listening and review caught items", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(3);
});
test("words typed but never added still make it to the review", async ({ page }) => {
  await page.getByRole("button", { name: "Type instead", exact: true }).click();
  await page.getByLabel("Your words", { exact: true }).fill("Remind me tomorrow to return the library books");
  await page.getByRole("button", { name: "Stop listening and review caught items", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(1);
});
test("going back with words in the box keeps them too", async ({ page }) => {
  await page.getByRole("button", { name: "Type instead", exact: true }).click();
  await page.getByLabel("Your words", { exact: true }).fill("Remind me tomorrow to renew my passport");
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(page.getByText("Review your session", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(1);
});
test("forgetting this browser asks first and offers to erase the data", async ({ page }) => {
  await create(page, "Remind me tomorrow to buy milk", "Keep me");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Privacy & data", exact: true }).click();
  await page.getByRole("button", { name: "Forget this browser", exact: true }).click();
  await expect(page.getByText("Forget this browser?", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Keep using it", exact: true }).click();
  await home(page);
  await expect(page.getByRole("button", { name: "Open reminder: Keep me", exact: true })).toBeVisible();
  const before = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.startsWith("device."))![1]);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Privacy & data", exact: true }).click();
  await page.getByRole("button", { name: "Forget this browser", exact: true }).click();
  await page.getByRole("button", { name: "Erase my data, then forget", exact: true }).click();
  await expect(page.getByText("One less thing on your mind.", { exact: true })).toBeVisible();
  // The old key's reminders are gone from the backend, not just hidden.
  const left = await page.evaluate(async ({ api, before }) => (await (await fetch(`${api}/reminders`, { headers: { Authorization: `Bearer ${before}` } })).json()).length, { api, before });
  expect(left).toBe(0);
});
test("a reminder with no time or place sits at the top of the list, not under places", async ({ page }) => {
  await saveDirect(page, { id: "needs-detail", title: "Sort the mail", triggerType: "time", completed: false, createdAt: new Date().toISOString() });
  await page.reload();
  await expect(page.getByRole("button", { name: "Open reminder: Sort the mail", exact: true })).toBeVisible();
  await expect(page.getByText("At a place", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Needs a time or place", { exact: true }).first()).toBeVisible();
});
test("a reminder with no time or place is flagged with a way to fix it", async ({ page }) => {
  // The isolated backend's mock parser always adds a time, so hand Review a reminder
  // the real model can return: no time and no place.
  await page.route(`${api}/sessions/*/end`, async route => {
    const detail = await (await route.fetch()).json();
    detail.reminders = [{ id: "no-time-or-place", title: "take the call", createdAt: new Date().toISOString(), triggerType: "time", completed: false }];
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(detail) });
  });
  await typeSession(page, ["take the call"]);
  await expect(page.getByText("One reminder needs more detail", { exact: true })).toBeVisible();
  await expect(page.getByText("Needs a time or place", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Add a time or place for / }).click();
  await expect(page.getByText("Edit reminder", { exact: true })).toBeVisible();
});
// Headless Chromium always reports notifications as blocked; stand in for a browser that asks and gets a yes.
async function allowNotificationsOnAsk(page: Page) {
  await page.evaluate(() => {
    let granted = false;
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => granted ? "granted" : "default" });
    Notification.requestPermission = async () => { granted = true; return "granted"; };
  });
}
test("browser notifications can be turned on from Settings", async ({ page }) => {
  await allowNotificationsOnAsk(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Enable reminder notifications", exact: true }).click();
  await expect(page.getByText("Browser notifications are on.", { exact: false })).toBeVisible();
});
test("dark mode follows the device, can be pinned from Settings and is remembered", async ({ page }) => {
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.emulateMedia({ colorScheme: "dark" }); await page.reload();
  await expect(page.getByText("A little less to remember.", { exact: true })).toBeVisible();
  await expect.poll(background).toBe("rgb(17, 27, 21)");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Appearance: Light", exact: true }).click();
  await expect.poll(background).toBe("rgb(250, 248, 242)");
  // Switching keeps the person on Settings, and the drawn back button takes them home.
  await expect(page.getByText("Appearance", { exact: true })).toBeVisible();
  await page.reload();
  await expect.poll(background).toBe("rgb(250, 248, 242)");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Appearance: Light", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(page.getByText("A little less to remember.", { exact: true })).toBeVisible();
});
test("review opens with a count of what was caught", async ({ page }) => {
  await typeSession(page, ["Remind me tomorrow at 9am to call the dentist"]);
  await expect(page.getByLabel(/^Caught: 1 new/)).toBeVisible();
});
test("typing something Heedly already has explains why nothing new appeared", async ({ page }) => {
  await page.getByRole("button", { name: "Type instead", exact: true }).click();
  for (let i = 0; i < 2; i++) {
    await page.getByLabel("Your words", { exact: true }).fill("Remind me tomorrow at 7am to feed the fish");
    await page.getByRole("button", { name: "Add to session", exact: true }).click();
    await expect(page.getByLabel("Your words", { exact: true })).toHaveValue("");
  }
  await expect(page.getByText(/^Heedly didn't find anything new to remember in "Remind me tomorrow at 7am to feed the fish"/)).toBeVisible();
});

// A reminder saved straight to the API, for states the UI won't create (like one already due).
async function saveDirect(page: Page, reminder: Record<string, unknown>) {
  await page.evaluate(async ({ api, reminder }) => {
    const token = Object.entries(localStorage).find(([key]) => key.startsWith("device."))![1];
    const response = await fetch(`${api}/reminders`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(reminder) });
    if (!response.ok) throw new Error(`save failed ${response.status}`);
  }, { api, reminder });
}
test("reminders are still there after closing the tab", async ({ page, context }) => {
  await create(page, "Remind me tomorrow to renew the parking permit", "Renew parking permit");
  await page.close();
  const next = await context.newPage(); await home(next);
  await expect(next.getByRole("button", { name: "Open reminder: Renew parking permit", exact: true })).toBeVisible();
});
test("a reminder that comes due shows at the top with Done, Snooze and Undo", async ({ page }) => {
  const now = Date.now();
  await saveDirect(page, { id: `e2e-due-${now}`, title: "Take the laundry out", createdAt: new Date(now).toISOString(), deadline: new Date(now - 60000).toISOString(), triggerType: "time", completed: false });
  await saveDirect(page, { id: `e2e-due2-${now}`, title: "Move the car", createdAt: new Date(now).toISOString(), deadline: new Date(now - 120000).toISOString(), triggerType: "time", completed: false });
  await page.reload();
  await expect(page.getByText("2 reminders due now", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Snooze Move the car for 10 minutes", exact: true }).click();
  await expect(page.getByText("Due now", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mark Take the laundry out as done", exact: true }).click();
  await expect(page.getByText('"Take the laundry out" marked done.', { exact: true })).toBeVisible();
  await expect(page.getByText("Due now", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("Due now", { exact: true })).toBeVisible();
});
test("ticking a reminder done on the list can be undone", async ({ page }) => {
  await create(page, "Remind me tomorrow to call the bank", "Call the bank");
  await page.getByRole("checkbox", { name: "Mark Call the bank as done", exact: true }).click();
  await expect(page.getByText('"Call the bank" marked done.', { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Mark Call the bank as done", exact: true })).toBeVisible();
});
test("review offers one-tap location for a place reminder", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]); await context.setGeolocation({ latitude: 42.39, longitude: -72.53 });
  // The isolated mock parser never sets a place, so hand Review a place reminder like the real model returns.
  await page.route(`${api}/sessions/*/end`, async route => {
    const detail = await (await route.fetch()).json();
    detail.reminders = [{ id: "pharmacy-run", title: "Pick up prescription", createdAt: new Date().toISOString(), triggerType: "location", location: { type: "category", category: "pharmacy" }, completed: false }];
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(detail) });
  });
  await typeSession(page, ["Pick up my prescription when I'm near a pharmacy"]);
  await expect(page.getByText("Place reminders need your location. Heedly checks every couple of minutes, not constantly.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Turn on location", exact: true }).click();
  await expect(page.getByText("Place reminders need your location. Heedly checks every couple of minutes, not constantly.", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Location reminders", exact: true }).click();
  await expect(page.getByText("On", { exact: true })).toBeVisible();
});
test("review offers notifications when a reminder has a time", async ({ page }) => {
  await allowNotificationsOnAsk(page);
  await typeSession(page, ["Remind me tomorrow at 9am to call the dentist"]);
  await expect(page.getByText("So Heedly can actually remind you", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Turn on notifications", exact: true }).click();
  await expect(page.getByText("So Heedly can actually remind you", { exact: true })).toHaveCount(0);
});
test("pressing Enter adds typed words", async ({ page }) => {
  await page.getByRole("button", { name: "Type instead", exact: true }).click();
  await page.getByLabel("Your words", { exact: true }).fill("Remind me tomorrow at 6pm to go for a run");
  await page.getByLabel("Your words", { exact: true }).press("Enter");
  await expect(page.getByLabel("Your words", { exact: true })).toHaveValue("");
  await expect(page.getByText(/go for a run/).first()).toBeVisible();
});
test("Heedly learns a fact, shows it on review and in its memory, and it can be forgotten and put back", async ({ page }) => {
  await typeSession(page, ["I always get coffee at Blue Bottle"]);
  await expect(page.getByText("Heedly learned", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Coffee at Blue Bottle", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByLabel(/^Caught: 1 learned/)).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "What Heedly remembers", exact: true }).click();
  await expect(page.getByText("Coffee at Blue Bottle", { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole("button", { name: "Forget coffee", exact: true }).click();
  await expect(page.getByText("Forgot coffee.", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Coffee at Blue Bottle", { exact: true }).filter({ visible: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("Coffee at Blue Bottle", { exact: true }).filter({ visible: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "What Heedly remembers", exact: true }).click();
  await expect(page.getByText("Coffee at Blue Bottle", { exact: true }).filter({ visible: true })).toBeVisible();
});
test("forgetting from the review list waits for Done and can be undone", async ({ page }) => {
  await typeSession(page, ["my sister's email is ana@example.com"]);
  await page.getByRole("button", { name: "Forget sister", exact: true }).click();
  await expect(page.getByText("Will be forgotten", { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole("button", { name: "Keep sister", exact: true }).click();
  await page.getByRole("button", { name: "Forget sister", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "What Heedly remembers", exact: true }).click();
  await expect(page.getByText("Nothing yet.", { exact: true }).filter({ visible: true })).toBeVisible();
});
test("an email to someone Heedly knows gets their address filled in", async ({ page }) => {
  await typeSession(page, ["my sister's email is ana@example.com"]);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "What Heedly remembers", exact: true }).click();
  await expect(page.getByText("Emails to Sister go to ana@example.com.", { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole("button", { name: "Change email", exact: true }).click();
  await page.getByLabel("sister's email", { exact: true }).fill("ana@new.example");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Emails to Sister go to ana@new.example.", { exact: true }).filter({ visible: true })).toBeVisible();
});
test("finishing a repeating reminder sets up the next one, and undo takes it back", async ({ page }) => {
  await typeSession(page, ["Water the plants every week"]);
  await expect(page.getByText(/Repeats weekly/).filter({ visible: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const box = page.getByRole("checkbox", { name: "Mark Water the plants every week as done", exact: true });
  await box.click();
  await expect(page.getByText('"Water the plants every week" done. The next one is set.', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Mark Water the plants every week as done", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("Done (1)", { exact: true }).filter({ visible: true })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Mark Water the plants every week as done", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "What Heedly remembers", exact: true }).click();
  await expect(page.getByText("Repeating", { exact: true }).filter({ visible: true })).toBeVisible();
});
test("typing the moment the screen opens still lands on the review list", async ({ page }) => {
  const starts: string[] = [];
  page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/sessions")) starts.push(r.url()); });
  await page.route(`${api}/sessions`, async route => { await new Promise(r => setTimeout(r, 800)); await route.continue(); });
  await page.getByRole("button", { name: "Type instead", exact: true }).click();
  await page.getByLabel("Your words", { exact: true }).fill("Remind me tomorrow at 7am to stretch");
  await page.getByLabel("Your words", { exact: true }).press("Enter");
  await page.getByRole("button", { name: "Stop listening and review caught items", exact: true }).click();
  await expect(page.getByText("Review your session", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(1);
  expect(starts).toHaveLength(1);
});
test("the device turning dark mid-session doesn't restart the session", async ({ page }) => {
  const starts: string[] = [];
  page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/sessions")) starts.push(r.url()); });
  await page.getByRole("button", { name: "Type instead", exact: true }).click();
  await page.getByLabel("Your words", { exact: true }).fill("Remind me tomorrow at 8am to call the bank");
  await page.getByLabel("Your words", { exact: true }).press("Enter");
  await expect(page.getByLabel("Your words", { exact: true })).toHaveValue("");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Stop listening and review caught items", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(1);
  expect(starts).toHaveLength(1);
  // Leaving the listening screen picks up the new look.
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(17, 27, 21)");
});
