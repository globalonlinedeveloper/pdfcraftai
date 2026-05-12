#!/usr/bin/env node
// scripts/test-enterprise-jsonld.mjs
//
// 2026-05-12 — CI guard for the Service + Organization +
// BreadcrumbList JSON-LD added to /enterprise (sales-qualified-lead
// landing). Uses Schema.org Service rather than SoftwareApplication
// because the page sells a B2B engagement, not a downloadable app.
// Service.hasOfferCatalog enumerates the FEATURES list as discrete
// Offer items so Google can render them in a richer result panel.
//
// Sections:
//   A — constants declared
//   B — Service shape (Service @type, provider, hasOfferCatalog)
//   C — OfferCatalog derived from FEATURES (anti-drift)
//   D — Breadcrumb covers Home → Enterprise
//   E — rendering hygiene
//
// Pure static-parse.

import { readFileSync } from "node:fs";

const PAGE_PATH = "app/enterprise/page.tsx";
const PAGE = readFileSync(PAGE_PATH, "utf8");

let pass = 0;
let fail = 0;
const report = [];

function check(label, predicate) {
  const ok = !!predicate;
  if (ok) pass++;
  else fail++;
  report.push({ label, ok });
}

// ─── Section A ───
check("A1: SERVICE_JSONLD declared", /const SERVICE_JSONLD\s*=/.test(PAGE));
check("A2: BREADCRUMB_JSONLD declared", /const BREADCRUMB_JSONLD\s*=/.test(PAGE));

// ─── Section B: Service shape ───
check("B1: top-level @type Service", /"@type":\s*"Service"/.test(PAGE));
check(
  "B2: provider is Organization with name + url + logo",
  /provider:\s*\{[\s\S]*?"@type":\s*"Organization"[\s\S]*?name:\s*"pdfcraftai"[\s\S]*?url:\s*SITE/.test(
    PAGE
  )
);
check(
  "B3: areaServed Place declared",
  /areaServed:\s*\{\s*"@type":\s*"Place"/.test(PAGE)
);
check(
  "B4: audience is Business audience",
  /audience:\s*\{\s*"@type":\s*"Audience",\s*audienceType:\s*"Business"/.test(
    PAGE
  )
);
check(
  "B5: hasOfferCatalog OfferCatalog declared",
  /hasOfferCatalog:\s*\{[\s\S]*?"@type":\s*"OfferCatalog"/.test(PAGE)
);

// ─── Section C: derivation from FEATURES (anti-drift) ───
check(
  "C1: OfferCatalog itemListElement maps over FEATURES",
  /itemListElement:\s*FEATURES\.map/.test(PAGE)
);
check(
  "C2: each item is an Offer with itemOffered Service",
  /"@type":\s*"Offer"[\s\S]*?itemOffered:\s*\{[\s\S]*?"@type":\s*"Service"/.test(
    PAGE
  )
);
check(
  "C3: SERVICE_JSONLD itemListElement does NOT use a literal (must use .map)",
  (() => {
    const start = PAGE.indexOf("const SERVICE_JSONLD");
    if (start < 0) return false;
    const end = PAGE.indexOf("};", start);
    if (end < 0) return false;
    const block = PAGE.slice(start, end);
    return (
      /itemListElement:\s*FEATURES\.map/.test(block) &&
      !/itemListElement:\s*\[/.test(block)
    );
  })()
);

// ─── Section D: breadcrumb ───
check("D1: BreadcrumbList @type", /"@type":\s*"BreadcrumbList"/.test(PAGE));
check(
  "D2: breadcrumb has Home + Enterprise items",
  /name:\s*"Home"[\s\S]*name:\s*"Enterprise"/.test(PAGE)
);

// ─── Section E: rendering hygiene ───
check(
  "E1: at least 2 application/ld+json script tags",
  (PAGE.match(/type="application\/ld\+json"/g) || []).length >= 2
);
check(
  "E2: JSON.stringify wraps both schemas",
  /JSON\.stringify\(SERVICE_JSONLD\)/.test(PAGE) &&
    /JSON\.stringify\(BREADCRUMB_JSONLD\)/.test(PAGE)
);

// ─── Report ───
console.log("enterprise-jsonld:");
for (const r of report) {
  console.log(`  ${r.ok ? "✓" : "✗"} ${r.label}`);
}
const total = pass + fail;
console.log(`enterprise-jsonld: ${pass} passed, ${fail} failed (of ${total})`);
process.exit(fail === 0 ? 0 : 1);
