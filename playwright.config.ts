import { defineConfig, devices } from "@playwright/test";

/**
 * This repo tests an external app (cypress-realworld-app) that is started
 * separately -- see README "Running locally". Playwright's webServer hook
 * isn't used here because the app under test lives in a different repo/process
 * than the tests themselves, mirroring how a real central tester repo works.
 */
export default defineConfig({
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  // cypress-realworld-app tags interactive elements with data-test, not data-testid
  use: { testIdAttribute: "data-test" },
  projects: [
    {
      name: "api",
      testDir: "./tests/api",
      use: {
        baseURL: process.env.BACKEND_URL || "http://localhost:3001",
      },
    },
    {
      name: "e2e",
      testDir: "./tests/e2e",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env.FRONTEND_URL || "http://localhost:3000",
      },
    },
    {
      name: "generated",
      testDir: "./tests/generated",
    },
  ],
});
