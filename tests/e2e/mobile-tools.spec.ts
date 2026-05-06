// tests/e2e/mobile-tools.spec.ts — Mobile UI hardening (PENDING §5f
// foundation, 2026-05-05).
//
// Audit goal: ~40% of typical PDF tool traffic is mobile, but no mobile
// spec existed before this commit. Visual editors (PageEditorTool
// consumers) likely have poor touch behavior; tool runners may
// horizontally scroll on narrow viewports.
//
// What this spec catches
// ----------------------
// For each of 10 representative tool URLs on iPhone 14 viewport
// (390×844 — narrowest modern iPhone):
//   1. Page loads without throwing
//   2. NO horizontal scroll: `document.body.scrollWidth` must be ≤
//      `window.innerWidth + 1` (1px tolerance for sub-pixel rounding).
//      Horizontal scroll is the #1 mobile-UX anti-signal — once a page
//      makes the user pinch-to-zoom, they bounce.
//   3. At least one interactive element (button or link) visible
//      above the fold — i.e. within the initial 844px viewport
//      without scrolling. Catches "key CTA pushed below 5 banner ads"
//      type bugs.
//
// What this spec does NOT catch
// -----------------------------
// - Touch gesture issues (drag-to-reorder, pinch-zoom on PDF preview).
//   Playwright's mobile emulation simulates click/tap but not multi-
//   touch gestures cleanly.
// - Visual editor specifics. The 13 visual editors (PageEditorTool
//   consumers) need per-tool touch-behavior audits — Phase G work.
// - Layout regressions on tablet (iPad). iPhone 14 covers the tightest
//   constraint; if it passes, anything wider works.
//
// Tool URL selection: 10 most-trafficked or most-touchy tools.
// These are the ones a mobile user is most likely to land on first.
// Adding the rest is incremental; this spec catches the common bug
// class (horizontal scroll, off-screen CTA) on the highest-impact
// surfaces.

import { test, expect, devices } from "@playwright/test";

// Tools to verify on mobile. Curated for traffic + visual-editor
// coverage. Update when a high-traffic new tool ships (e.g.
// compress-pdf and pdf-a-convert added in this session, but they're
// flag-gated and would 404 for unauthenticated visits — defer to
// Phase G when the flag flips).
const MOBILE_TOOL_URLS = [
  // Free tools (highest traffic):
  "/", // homepage
  "/tool/merge",
  "/tool/split",
  "/tool/rotate",
  "/tool/extract-pages",
  // AI tools (high-stakes UX, full content + ads):
  "/tool/ai-summarize",
  "/tool/ai-translate",
  "/tool/ai-chat",
  // Visual editors (most likely to break touch UX):
  "/tool/highlight-pdf",
  "/tool/sort-pages",
] as const;

test.use({ ...devices["iPhone 14"] });

for (const url of MOBILE_TOOL_URLS) {
  test(`mobile: ${url} — no horizontal scroll + visible CTA`, async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    expect(response?.status() ?? 0, `Page ${url} should load`).toBeLessThan(
      400,
    );

    // Wait for hydration. We don't use 'networkidle' (Next.js prefetch
    // chatter keeps it busy). 'domcontentloaded' + a short settle is
    // enough for layout calculations.
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(500);

    // 1. No horizontal scroll. Allow 1px tolerance for sub-pixel
    //    rounding (Chrome on retina occasionally reports 390.5).
    const overflow = await page.evaluate(() => {
      return {
        bodyWidth: document.body.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    expect(
      overflow.bodyWidth,
      `${url}: body.scrollWidth (${overflow.bodyWidth}) must not exceed viewport (${overflow.viewportWidth}) — horizontal scroll is the #1 mobile-UX anti-signal`,
    ).toBeLessThanOrEqual(overflow.viewportWidth + 1);

    // 2. At least one interactive element (button or anchor) visible
    //    above the fold (within 844px from the top).
    const hasAboveFoldCta = await page.evaluate(() => {
      const els = document.querySelectorAll(
        'button:not([disabled]), a[href]',
      );
      for (const el of Array.from(els)) {
        const rect = el.getBoundingClientRect();
        if (
          rect.top >= 0 &&
          rect.top < 844 &&
          rect.width > 0 &&
          rect.height > 0
        ) {
          return true;
        }
      }
      return false;
    });
    expect(
      hasAboveFoldCta,
      `${url}: at least one button/link must be visible above the fold (within 844px)`,
    ).toBe(true);

    // 3. No console errors thrown by page code. We allow some
    //    third-party noise (analytics, hot-module reload in dev) by
    //    filtering out known benign patterns.
    const realErrors = consoleErrors.filter(
      (e) =>
        !e.includes("Failed to load resource") && // 404s on optional bg images
        !e.includes("clarity.ms") && // Clarity init noise
        !e.includes("googletagmanager.com"), // GA4 noise
    );
    expect(
      realErrors,
      `${url} should have no console errors. Got:\n  ${realErrors.join("\n  ")}`,
    ).toEqual([]);
  });
}
