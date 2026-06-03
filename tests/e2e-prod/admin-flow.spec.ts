// tests/e2e-prod/admin-flow.spec.ts
//
// Phase 5 (admin) — verifies the admin gate from the POSITIVE side: a signed-in
// ADMIN account CAN load /admin/* pages. Complements auth-flow.spec.ts's SEV-0
// "non-admin authed user gets 404 on /admin" assertion.
//
// Admin account: PROD_E2E_ADMIN_EMAIL — must be in ADMIN_EMAILS (or a Gmail
// +alias that normalizes into it, e.g. rajasekarjavaee+5@gmail.com -> the admin
// email). It needs a PASSWORD (credentials) since Google OAuth can't be
// automated.
//
// READ-ONLY: this suite only navigates to admin pages and asserts they render.
// It never grants credits, changes settings, or deletes anything.
//
// Gates (test.skip if any unset): PROD_E2E_ADMIN_EMAIL + PROD_E2E_ADMIN_PASSWORD
// + PROD_E2E_ADMIN_OK=yes.
import { test, expect } from "@playwright/test";

const EMAIL = process.env.PROD_E2E_ADMIN_EMAIL;
const PASSWORD = process.env.PROD_E2E_ADMIN_PASSWORD;
const ADMIN_OK = process.env.PROD_E2E_ADMIN_OK === "yes";

// A few stable top-level admin pages (read-only).
const ADMIN_PATHS = ["/admin", "/admin/margin", "/admin/credits"];

test.describe("admin flows", () => {
  test.skip(!EMAIL || !PASSWORD, "Admin secrets missing.");
  test.skip(!ADMIN_OK, "Admin phase disabled. Set PROD_E2E_ADMIN_OK=yes.");

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(EMAIL!);
    await page.locator('input[type="password"]').fill(PASSWORD!);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(page).toHaveURL(/\/app\//, { timeout: 15_000 });
  });

  for (const path of ADMIN_PATHS) {
    test(`admin can load ${path} (200, not 404)`, async ({ page }) => {
      const resp = await page.goto(path);
      const status = resp?.status() ?? 0;
      // Must render for an admin — not 404/notFound, not bounced to /login.
      expect(status, `${path} status`).toBeLessThan(400);
      expect(page.url(), `${path} should not redirect to /login`).not.toContain("/login");
      const body = (await page.evaluate(() => document.body.innerText)).toLowerCase();
      expect(body, `${path} should not be the notFound body`).not.toContain(
        "page could not be found",
      );
    });
  }
});
