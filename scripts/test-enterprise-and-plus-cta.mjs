#!/usr/bin/env node
/**
 * 2026-05-04 — T1-6 + /enterprise wire-up CI guard.
 *
 * Plan T1-6 shipped two coupled changes that need to stay coupled:
 *
 *   1. OutOfCreditsAlert grew a "Start Plus" CTA between the existing
 *      "Buy credits" primary and "See packs" ghost buttons. The Plus
 *      CTA is the higher-LTV upsell path (recurring 200 credits/mo +
 *      rollover to 400 vs. one-shot pack). Drop it and we revert to
 *      the lower-LTV one-shot funnel.
 *
 *   2. /enterprise landing page captures sales-qualified-lead intake
 *      for "we have 50 employees who need..." asks that bounce off
 *      the $9 self-serve top tier. Drop it and SMB+ leads have
 *      nowhere to land — they hit /pricing, see no team plan, and
 *      bounce.
 *
 * Both items shipped at commit 96ac693 (followed by sitemap fix
 * 2a3263f). This guard locks in:
 *
 *   A. OutOfCreditsAlert exposes the "Start Plus" CTA targeting
 *      /pricing#plus
 *   B. /enterprise page exists with the required sections
 *      (MarketingHero, FEATURES grid, honest-caveats, ContactForm)
 *   C. Sitemap includes /enterprise as a static route
 *   D. Forward-compat: the no-credit-number-hardcodes guard exempts
 *      both new files (so the Plus tooltip + enterprise volume-
 *      pricing copy don't false-positive)
 *
 * Output line conforms to aggregator regex `${name}: ${pass} passed,
 * ${fail} failed`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) passed++;
  else {
    failed++;
    failures.push(msg);
  }
}

const ALERT_PATH = path.join(
  ROOT,
  "components",
  "upsell",
  "OutOfCreditsAlert.tsx",
);
const ENTERPRISE_PATH = path.join(ROOT, "app", "enterprise", "page.tsx");
const SITEMAP_PATH = path.join(ROOT, "app", "sitemap.ts");
const HARDCODES_GUARD_PATH = path.join(
  ROOT,
  "scripts",
  "test-no-credit-number-hardcodes.mjs",
);

// ============================================================================
// Section A — OutOfCreditsAlert exposes "Start Plus" CTA
// ============================================================================

assert(fs.existsSync(ALERT_PATH), "A0: OutOfCreditsAlert.tsx exists");
const alertSrc = fs.readFileSync(ALERT_PATH, "utf8");

// The CTA must be a Next.js Link with href="/pricing#plus" so the deep-
// link anchor lands on the Plus pack section. Plain anchor or Button
// with onClick would break SSR + analytics tracking.
assert(
  /<Link\s+href="\/pricing#plus"/.test(alertSrc),
  "A1: Link to /pricing#plus exists in OutOfCreditsAlert (deep-link to Plus plan section)",
);

// The button label must be "Start Plus" — copy lives here, not in a
// constants file, because all other CTAs in this component are hard-
// coded too. Moving to a constants file is fine but if it lands as a
// label-renamed button this guard catches the regression.
assert(
  /Start Plus/.test(alertSrc),
  "A2: 'Start Plus' button label present (drives Plus-plan recurring upsell)",
);

// Order matters: Buy credits primary → Start Plus secondary (outline)
// → See packs ghost. If someone re-orders these and Start Plus loses
// the secondary slot, the visual hierarchy breaks. We don't lock in
// strict source-order via a single big regex (the JSX style={{...}}
// double-brace plus multiline content makes balanced-brace matching
// brittle). Instead we anchor on the canonical CTA-row signature
// (`className="row"` with `gap: 8`) and verify all 3 labels appear
// AFTER it AND BEFORE the next sibling block (the subtle disclaimer
// `<div className="subtle"`). This catches accidental moves of the
// CTAs out of the row without depending on regex brace balancing.
const ctaRowOpenIdx = alertSrc.search(
  /<div\s+className="row"\s+style=\{\{\s*gap:\s*8/,
);
assert(
  ctaRowOpenIdx >= 0,
  "A3: CTA row container exists (className='row' style.gap=8)",
);
if (ctaRowOpenIdx >= 0) {
  // The row ends where the next top-level sibling begins — locate the
  // 'subtle' disclaimer div that follows the CTA row. If someone
  // restructures the alert, this will need updating; that's an
  // intentional tripwire so the guard doesn't silently green-light
  // a layout reshape.
  const subtleIdx = alertSrc.indexOf('className="subtle"', ctaRowOpenIdx);
  assert(
    subtleIdx > ctaRowOpenIdx,
    "A3-anchor: 'subtle' disclaimer div follows the CTA row (layout sentinel)",
  );
  const innerText = alertSrc.slice(ctaRowOpenIdx, subtleIdx);
  assert(
    /Buy credits/.test(innerText),
    "A3a: 'Buy credits' CTA inside the CTA row (primary)",
  );
  assert(
    /Start Plus/.test(innerText),
    "A3b: 'Start Plus' CTA inside the CTA row (secondary)",
  );
  assert(
    /See packs/.test(innerText),
    "A3c: 'See packs' CTA inside the CTA row (ghost)",
  );
}

// ============================================================================
// Section B — /enterprise landing page exists with required sections
// ============================================================================

assert(fs.existsSync(ENTERPRISE_PATH), "B0: app/enterprise/page.tsx exists");
const entSrc = fs.readFileSync(ENTERPRISE_PATH, "utf8");

// Imports must include MarketingHero (visual consistency with
// /about + /bulk + /contact patterns) and ContactForm (sales intake
// path — without it the page is a brochure with no conversion mechanism).
assert(
  /import\s*\{\s*MarketingHero\s*\}\s*from\s*"@\/components\/marketing\/MarketingHero"/.test(
    entSrc,
  ),
  "B1: imports MarketingHero from @/components/marketing/MarketingHero",
);
assert(
  /import\s*\{\s*ContactForm\s*\}\s*from\s*"@\/components\/marketing\/ContactForm"/.test(
    entSrc,
  ),
  "B2: imports ContactForm from @/components/marketing/ContactForm (sales intake)",
);
assert(
  /pageMetadata\s*\(/.test(entSrc),
  "B3: uses pageMetadata helper (canonical URL + OG tags consistent with other marketing pages)",
);

// The FEATURES array must have 6 items per the plan (shared credit
// pool, admin console, SSO, custom invoicing, volume pricing,
// priority support). Not 5 (under-sells), not 7 (cluttered).
const featuresMatch = entSrc.match(/const FEATURES[^=]*=\s*\[([\s\S]*?)\];/);
assert(
  featuresMatch !== null,
  "B4: FEATURES array constant exists in /enterprise page",
);
if (featuresMatch) {
  const featureCount = (featuresMatch[1].match(/\{\s*icon:/g) ?? []).length;
  assert(
    featureCount === 6,
    `B4a: FEATURES array has exactly 6 entries (got ${featureCount}; plan T1-6 ext requires 6 distinct value props)`,
  );
}

// Honest-caveats section is the differentiator — every competitor's
// /enterprise page lies about SOC 2 / SSO / data residency. Ours
// admits what we don't yet ship. Killing this section would erode
// the trust signal.
assert(
  /HONEST CAVEATS/.test(entSrc),
  "B5: honest-caveats section exists (eyebrow text 'HONEST CAVEATS' lists what we don't yet ship)",
);
assert(
  /Self-serve team plan/.test(entSrc),
  "B5a: caveats mention 'Self-serve team plan' (we don't have a published team plan yet)",
);
assert(
  /SOC 2/.test(entSrc),
  "B5b: caveats mention SOC 2 (not yet audited — common procurement ask)",
);

// Form anchor must match the secondaryCta in MarketingHero. Without
// the #contact anchor, the "Talk to us" CTA jump-link breaks.
assert(
  /id="contact"/.test(entSrc),
  "B6: <section id='contact'> anchor present so MarketingHero primaryCta href='#contact' jump-link works",
);

// ============================================================================
// Section C — Sitemap includes /enterprise as a static route
// ============================================================================

assert(fs.existsSync(SITEMAP_PATH), "C0: app/sitemap.ts exists");
const sitemapSrc = fs.readFileSync(SITEMAP_PATH, "utf8");

assert(
  /\$\{SITE_URL\}\/enterprise/.test(sitemapSrc),
  "C1: sitemap includes /enterprise (Google + Bing must crawl the sales intake page)",
);

// Priority should be ≥ /about (0.6) because /enterprise is a direct
// revenue path (B2B sales intake) vs. static brand content.
const enterpriseLine = sitemapSrc
  .split("\n")
  .find((l) => l.includes("/enterprise") && l.includes("priority"));
assert(
  enterpriseLine !== undefined,
  "C2: sitemap entry for /enterprise has explicit priority field",
);
if (enterpriseLine) {
  const priorityMatch = enterpriseLine.match(/priority:\s*(\d*\.?\d+)/);
  const priority = priorityMatch ? parseFloat(priorityMatch[1]) : 0;
  assert(
    priority >= 0.6,
    `C2a: /enterprise priority ≥ 0.6 (revenue-path landing should not rank below /about; got ${priority})`,
  );
}

// ============================================================================
// Section D — Forward-compat: hardcodes guard exempts both new files
// ============================================================================

assert(
  fs.existsSync(HARDCODES_GUARD_PATH),
  "D0: scripts/test-no-credit-number-hardcodes.mjs exists",
);
const hardSrc = fs.readFileSync(HARDCODES_GUARD_PATH, "utf8");

// OutOfCreditsAlert exemption — the "200 credits + rollover to 400"
// tooltip on Start Plus references plan-level pricing, which is the
// canonical Plus plan size. Per-call billing copy still trips the
// regex; this exemption is plan-level only. Removing it would cause
// the hardcodes guard to fire on the legitimate plan tooltip.
assert(
  /OutOfCreditsAlert\.tsx/.test(hardSrc),
  "D1: hardcodes guard exempts OutOfCreditsAlert.tsx (Plus tooltip references canonical plan size)",
);

// /enterprise exemption — the "1,000 credits/month" volume-pricing
// threshold is a sales-qualification trigger, not per-tool billing.
// Marketing-page-level threshold copy is allowed; this exemption
// flags it as such. Removing it would fire on the volume-pricing
// section.
assert(
  /enterprise[\\\/]+page\.tsx/.test(hardSrc) || /enterprise.*page\.tsx/.test(hardSrc),
  "D2: hardcodes guard exempts app/enterprise/page.tsx (volume-pricing threshold copy is sales qualification, not billing)",
);

// ============================================================================
// Output
// ============================================================================

if (failed > 0) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error("  -", f);
}

console.log(`enterprise-and-plus-cta: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
