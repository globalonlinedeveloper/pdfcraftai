// scripts/a11y-prod.mjs
//
// Accessibility audit of production via axe-core (WCAG 2.1 A + AA). Runs in CI
// (Chromium can't launch in the Cowork sandbox). @axe-core/playwright injects
// axe through CDP, so it works even under the site's strict CSP.
//
// Scans a representative SAMPLE of page TYPES — the site's a11y lives in shared
// components (nav, footer, hero, forms, tool runner, longform), so a sample
// covers the real surface without auditing all 295 pages. Report-only (exit 0):
// violations are findings to triage, not build-breakers. Writes a11y-report.json.
import { chromium } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { writeFileSync } from "node:fs";

const BASE = (process.env.A11Y_BASE_URL || "https://pdfcraftai.com").replace(/\/$/, "");
const PAGES = [
  "/", "/tools", "/pricing", "/blog", "/help", "/about",
  "/compare", "/alternatives", "/use-cases", "/login", "/register",
  "/chat-with-pdf", "/extract-emails-from-pdf",
  "/tool/merge-pdf", "/tool/split-pdf", "/tool/ai-summarize",
];
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const results = [];
  for (const path of PAGES) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const r = { path, error: null, violations: [], counts: { critical: 0, serious: 0, moderate: 0, minor: 0 } };
    try {
      await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(600);
      const res = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      for (const v of res.violations) {
        const imp = v.impact || "minor";
        r.counts[imp] = (r.counts[imp] || 0) + v.nodes.length;
        r.violations.push({ id: v.id, impact: imp, nodes: v.nodes.length, help: v.help });
      }
    } catch (e) { r.error = (e.message || String(e)).split("\n")[0].slice(0, 160); }
    await ctx.close();
    results.push(r);
    const c = r.counts;
    console.log(`${path.padEnd(28)} crit=${c.critical} serious=${c.serious} mod=${c.moderate} minor=${c.minor}${r.error ? " ERR:" + r.error : ""}`);
  }
  await browser.close();
  writeFileSync("a11y-report.json", JSON.stringify(results, null, 2));
  const agg = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const rule = {};
  for (const r of results) {
    for (const k in agg) agg[k] += r.counts[k];
    for (const v of r.violations) rule[v.id] = (rule[v.id] || 0) + v.nodes;
  }
  console.log(`\n===== A11Y SUMMARY (axe-core, WCAG 2.1 A+AA) =====`);
  console.log(`pages=${results.length}  critical=${agg.critical}  serious=${agg.serious}  moderate=${agg.moderate}  minor=${agg.minor}`);
  const top = Object.entries(rule).sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (top.length) { console.log("\nViolation rules (id: total nodes across sampled pages):"); top.forEach(([id, n]) => console.log(`  ${id}: ${n}`)); }
  else console.log("\nNo WCAG 2.1 A/AA violations found on the sampled pages. ✓");
  console.log("\nReport written: a11y-report.json");
  process.exit(0);
})().catch((e) => { console.error("A11Y FATAL:", e); process.exit(1); });
