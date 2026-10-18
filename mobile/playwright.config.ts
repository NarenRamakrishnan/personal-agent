import { defineConfig } from "@playwright/test";
const baseURL = process.env.PERSON2_BROWSER_URL;
if (!baseURL || new URL(baseURL).hostname !== "127.0.0.1") throw new Error("Run npm run test:browser; tests require the isolated localhost harness.");
export default defineConfig({
  testDir: "./e2e", testMatch: "**/*.e2e.ts", workers: 1, timeout: 45000,
  expect: { timeout: 10000 }, outputDir: "test-results/browser",
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: { baseURL, browserName: "chromium", viewport: { width: 430, height: 932 }, trace: "retain-on-failure", screenshot: "only-on-failure" },
});
