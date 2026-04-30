// tests/e2e/all-tools-smoke.spec.ts
//
// 2026-04-30: smoke test for every tool registered in lib/tools.ts.
//
// Phase 1 (homepage, merge, split, highlight, pdf-fonts) exercises 5
// tools end-to-end. The other ~89 tools have only ToolRunner-coverage
// CI guard (which checks the dispatcher mapping is right) — no
// runtime check that the page actually renders. Most regressions
// show up on the tools nobody manually clicks, so this smoke spec
// closes that gap.
//
// What each smoke test does:
//   1. Navigate to /tool/<id>
//   2. Wait for the heading + drop zone (or AI marketing landing) to
//      render
//   3. Verify there are no console.error messages from page code.
//
// What it doesn't do:
//   - Upload a fixture or run the operation. That's per-tool E2E
//     scope (which Phase 1 covers selectively).
//   - Assert the heading text matches the registry name verbatim
//     (some tools show category-style headings).
//
// Why parse lib/tools.ts at test-time instead of hardcoding the list:
//   New tools appear regularly; an ID drift would silently shrink
//   coverage. Reading the registry at boot keeps the spec aligned
//   with reality without manual maintenance.

import { test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { expect } from "./utils";

// Read the tool list from lib/tools.ts. We don't try to import the
// module — Playwright's TS resolver doesn't run through the Next
// alias config. Static parse via regex is fine: the registry rows
// are all single-line `{ id: "...", ... }` shapes.
const TOOLS_FILE = path.join(
  __dirname,
  "..",
  "..",
  "lib",
  "tools.ts",
);
const TOOLS_SOURCE = fs.readFileSync(TOOLS_FILE, "utf8");
const TOOL_IDS: string[] = [];
const TOOL_ID_RE = /^\s*\{\s*id:\s*"([^"]+)"/gm;
let match: RegExpExecArray | null;
while ((match = TOOL_ID_RE.exec(TOOLS_SOURCE)) !== null) {
  TOOL_IDS.push(match[1]);
}

// 2026-05-01 — also parse LIVE_TOOL_IDS from app/tool/[id]/page.tsx
// so the smoke spec can distinguish "should render the real runner"
// from "should render the COMING SOON placeholder". Without this
// distinction, the previous version of this spec passed for
// jpg-to-pdf / png-to-pdf / text-to-pdf even though all 3 were
// rendering the placeholder in prod — the placeholder page has a
// valid h1 + zero console errors, which was the entire assertion.
const PAGE_FILE = path.join(
  __dirname,
  "..",
  "..",
  "app",
  "tool",
  "[id]",
  "page.tsx",
);
const PAGE_SOURCE = fs.readFileSync(PAGE_FILE, "utf8");
const LIVE_BLOCK = PAGE_SOURCE.match(
  /LIVE_TOOL_IDS\s*=\s*new\s+Set<string>\(\[([\s\S]*?)\]\)/,
);
const LIVE_TOOL_IDS = new Set<string>(
  LIVE_BLOCK
    ? [...LIVE_BLOCK[1].matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1])
    : [],
);

// Sanity: should have 80+ tools. If we suddenly find <50, the regex
// has drifted and we'd silently shrink coverage.
test.describe("all-tools smoke", () => {
  test("registry parse — sufficient tool count", () => {
    expect(TOOL_IDS.length).toBeGreaterThanOrEqual(50);
  });
});

// Console-error patterns we explicitly accept on every page (third-
// party / network noise that isn't ours to fix). Must be very narrow
// — these patterns shouldn't mask real product errors.
const ACCEPTED_CONSOLE_ERROR_PATTERNS: RegExp[] = [
  // Cookie + 3p banner noise we can't influence.
  /cookie.*rejected|preload.*not used|3rd party cookie/i,
  // GA4 / Clarity beacons fail when consent is rejected — that's a
  // feature, not a bug.
  /www\.google-analytics\.com|analytics\.google\.com|clarity\.ms/i,
  // Cloudflare RUM (loaded after main app, not our error surface).
  /cloudflareinsights/i,
  // AdSense / DoubleClick — third-party iframes.
  /googleads|doubleclick/i,
  // Generic cross-origin iframe console errors (sourceless from
  // our perspective).
  /Failed to load resource:.*the server responded with a status of 404/i,
];

for (const id of TOOL_IDS) {
  test.describe(`smoke: /tool/${id}`, () => {
    test("renders without console errors", async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          const text = msg.text();
          if (
            !ACCEPTED_CONSOLE_ERROR_PATTERNS.some((re) => re.test(text))
          ) {
            consoleErrors.push(text);
          }
        }
      });
      page.on("pageerror", (err) => {
        consoleErrors.push(`pageerror: ${err.message}`);
      });

      await page.goto(`/tool/${id}`, { waitUntil: "domcontentloaded" });

      // Some tools redirect (eg AI tools when not signed in may go to
      // /login). Either redirect-target or destination should render
      // a heading + main element — that's the floor for "page works".
      // Use a generous timeout because cold WASM init on PDFium-
      // backed tools can take 5+ sec.
      const heading = page.locator("h1, [role=heading][aria-level='1']").first();
      await expect(heading).toBeVisible({ timeout: 20_000 });

      // Settle — let analytics / SW / late-binding scripts flush so
      // any async initialization errors land before we assert.
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {
        // some SW-heavy tools never fully reach networkidle on
        // first load; accept that and continue.
      });

      // Extra grace for PDFium WASM cold start. The WASM fetch +
      // compile fires only when a tool needs it, but it can throw a
      // late console.error if /api/pdfium-wasm flakes.
      await page.waitForTimeout(800);

      // 2026-05-01 — for tools in LIVE_TOOL_IDS, the page MUST
      // render the real runner instead of the COMING SOON
      // placeholder. The placeholder reads "COMING SOON · TOOL
      // RUNNER LANDS IN PHASE 3" (free) or "PHASE 5" (AI). This
      // assertion exists because of the jpg-to-pdf / png-to-pdf /
      // text-to-pdf 2026-05-01 regression: the runner components
      // and switch cases shipped, but LIVE_TOOL_IDS wasn't updated,
      // so the page rendered the placeholder. The previous smoke
      // assertions (h1 visible + no console errors) both passed on
      // the placeholder page, which is exactly the gap this closes.
      if (LIVE_TOOL_IDS.has(id)) {
        const placeholder = page.getByText(
          /COMING SOON\s*·\s*TOOL RUNNER LANDS IN/i,
        );
        await expect(placeholder).toHaveCount(0);
      }

      if (consoleErrors.length > 0) {
        throw new Error(
          `Console errors on /tool/${id}:\n${consoleErrors
            .slice(0, 5)
            .map((e) => `  - ${e.slice(0, 300)}`)
            .join("\n")}${consoleErrors.length > 5 ? `\n  ... and ${consoleErrors.length - 5} more` : ""}`,
        );
      }
    });
  });
}
