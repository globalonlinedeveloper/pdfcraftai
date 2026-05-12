// playwright.prod.config.ts
//
// 2026-05-12 — on-demand E2E suite for the LIVE production site.
//
// Different from playwright.config.ts in three ways:
//
//   1. No `webServer` block — we don't boot a local dev server. The
//      suite hits https://pdfcraftai.com directly (or whatever
//      PROD_E2E_URL is set to — set this if you're running against
//      a Cloudflare preview, a staging URL, or a sibling deploy).
//
//   2. `testDir` points at tests/e2e-prod/ — a separate directory
//      from the dev-targeting specs at tests/e2e/. This avoids the
//      dev specs accidentally running against prod (they assume a
//      local dev server with fresh test data) and prod specs
//      accidentally running against dev (they're read-only safety
//      checks that don't expect dev-server state).
//
//   3. Only one browser project (chromium). Anonymous read-only
//      smoke doesn't need triple-browser coverage; running across
//      3 browsers triples the time without catching bugs the
//      single-browser run would miss in this safety surface. The
//      dev config keeps the Firefox + WebKit + mobile coverage for
//      the interactive flows.
//
// How to run:
//
//   Local dry-run:
//     npm run test:prod-e2e
//
//   Against a different URL (e.g. staging, preview):
//     PROD_E2E_URL=https://staging.pdfcraftai.com npm run test:prod-e2e
//
//   Manual trigger via GitHub Actions:
//     gh workflow run prod-e2e.yml
//
//   Scheduled cron (see .github/workflows/prod-e2e.yml):
//     Runs every day at 06:00 UTC. Failures open a GitHub issue.

import { defineConfig, devices } from "@playwright/test";

const PROD_URL = process.env.PROD_E2E_URL ?? "https://pdfcraftai.com";

export default defineConfig({
  testDir: "./tests/e2e-prod",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 4 : 2,
  // 60s per test — most prod hits are <2s, but cold Cloudflare cache
  // edges in some regions can take longer.
  timeout: 60_000,
  // 5s per individual expect() — same reasoning.
  expect: { timeout: 5_000 },
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report-prod" }]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report-prod" }]],

  use: {
    baseURL: PROD_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    // Custom UA so production logs can identify our health checks
    // separate from real user traffic. The UA suffix is grep-able
    // in Hostinger access logs if a flake needs investigation.
    extraHTTPHeaders: {
      "User-Agent":
        "Mozilla/5.0 (compatible; pdfcraftai-prod-e2e/1.0; +https://pdfcraftai.com)",
    },
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // No webServer block — running against live, not a local dev server.
});
