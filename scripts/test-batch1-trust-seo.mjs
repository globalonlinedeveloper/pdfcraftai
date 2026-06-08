#!/usr/bin/env node
/**
 * test-batch1-trust-seo.mjs (auto-mode batch 1, 2026-06-08): guards the
 * trust/SEO quick wins — security.txt (RFC 9116), the public /roadmap page,
 * and their sitemap/footer wiring.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0; const fails = [];
const ok = (c, m) => { if (c) passed++; else { failed++; fails.push(m); } };
const read = (r) => fs.readFileSync(path.join(ROOT, r), "utf8");
const exists = (r) => fs.existsSync(path.join(ROOT, r));

// security.txt (RFC 9116)
{
  const rel = "app/.well-known/security.txt/route.ts";
  ok(exists(rel), `${rel} exists`);
  const s = read(rel);
  ok(/export function GET/.test(s), "security.txt: GET handler");
  ok(/text\/plain/.test(s), "security.txt: served as text/plain");
  ok(/Contact:\s*mailto:/.test(s), "security.txt: Contact field");
  ok(/Expires:/.test(s) && /setUTCFullYear/.test(s), "security.txt: dynamic future Expires");
  ok(/Policy:\s*https:\/\/pdfcraftai\.com\/security/.test(s), "security.txt: Policy → /security");
  ok(/Canonical:/.test(s), "security.txt: Canonical field");
}

// /roadmap page
{
  const rel = "app/roadmap/page.tsx";
  ok(exists(rel), `${rel} exists`);
  const s = read(rel);
  ok(/pageMetadata\(/.test(s) && /canonical:\s*"\/roadmap"/.test(s), "roadmap: metadata + canonical");
  ok(/MarketingHero/.test(s), "roadmap: uses MarketingHero");
  ok(/"Now"/.test(s) && /"Next"/.test(s) && /"Later"/.test(s), "roadmap: Now/Next/Later columns");
  ok(/\/changelog/.test(s), "roadmap: links to changelog (what's shipped)");
  // honest framing, no dated over-promises
  ok(/directions, not dated promises|not dated promises/i.test(s), "roadmap: honest 'not dated promises' framing");
}

// sitemap + footer wiring
ok(/\/roadmap/.test(read("app/sitemap.ts")), "sitemap: includes /roadmap");
ok(/\["Roadmap",\s*"\/roadmap"\]/.test(read("components/nav/Footer.tsx")), "footer: Roadmap link");

console.log("");
if (failed === 0) { console.log(`PASS — ${passed} assertions`); console.log(`${passed} passed, 0 failed`); process.exit(0); }
else { console.error("FAIL:"); fails.forEach(m => console.error("  " + m)); console.log(`${passed} passed, ${failed} failed`); process.exit(1); }
