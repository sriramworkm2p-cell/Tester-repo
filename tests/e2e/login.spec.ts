import { test, expect } from "@playwright/test";

/**
 * End-to-end test driving the real SignInForm UI (src/components/SignInForm.tsx)
 * against the running app. Selectors use the app's own data-test attributes,
 * not brittle CSS/text selectors.
 */
const SEEDED_USERNAME = "Heath93";
const SEEDED_PASSWORD = "s3cret";

test("a seeded user can sign in through the UI and reach their dashboard", async ({ page }) => {
  await page.goto("/signin");

  await page.getByTestId("signin-username").locator("input").fill(SEEDED_USERNAME);
  await page.getByTestId("signin-password").locator("input").fill(SEEDED_PASSWORD);
  await page.getByTestId("signin-submit").click();

  // Post-login chrome only renders once the auth machine transitions to "authorized"
  // (src/machines/authMachine.ts) -- this is a real assertion on app state, not a sleep.
  await expect(page.getByTestId("nav-top-new-transaction")).toBeVisible();
  await expect(page.getByTestId("sidenav-signout")).toBeAttached();
});

test("an incorrect password shows the sign-in error and does not navigate away", async ({
  page,
}) => {
  await page.goto("/signin");

  await page.getByTestId("signin-username").locator("input").fill(SEEDED_USERNAME);
  await page.getByTestId("signin-password").locator("input").fill("wrong-password");
  await page.getByTestId("signin-submit").click();

  await expect(page.getByTestId("signin-error")).toBeVisible();
  await expect(page).toHaveURL(/signin/);
});
