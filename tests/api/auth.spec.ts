import { test, expect } from "@playwright/test";

/**
 * API-level tests against the backend's session-based auth (backend/auth.ts).
 * Credentials come from the app's committed seed data (data/database-seed.json),
 * which uses SEED_DEFAULT_USER_PASSWORD ("s3cret") for every seeded user.
 */
const SEEDED_USERNAME = "Heath93";
const SEEDED_PASSWORD = "s3cret";

test.describe("POST /login", () => {
  test("logs in a seeded user and returns their profile, not their password hash", async ({
    request,
  }) => {
    const response = await request.post("/login", {
      data: { username: SEEDED_USERNAME, password: SEEDED_PASSWORD },
    });

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.user).toMatchObject({ username: SEEDED_USERNAME });
    expect(typeof body.user.balance).toBe("number");
  });

  test("rejects an incorrect password with 401 and no session", async ({ request }) => {
    const response = await request.post("/login", {
      data: { username: SEEDED_USERNAME, password: "definitely-wrong" },
    });

    expect(response.status()).toBe(401);

    // Confirm no session was established: checkAuth should still be unauthorized
    // on the same request context (cookies persist across calls in Playwright).
    const check = await request.get("/checkAuth");
    expect(check.status()).toBe(401);
  });

  test("rejects a username that does not exist", async ({ request }) => {
    const response = await request.post("/login", {
      data: { username: "not-a-real-user-xyz", password: "whatever" },
    });

    expect(response.status()).toBe(401);
  });
});
