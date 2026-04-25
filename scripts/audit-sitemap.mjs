#!/usr/bin/env node
// Sitemap health audit.
//
// Walks live /sitemap.xml, hits every URL with a HEAD request (with a
// GET fallback for hosts that 405 HEAD), and reports any non-200.
// Useful for catching broken-link drift before GSC notices and starts
// flagging coverage issues.
//
// Run:
//   node scripts/audit-sitemap.mjs                  # production
//   SITEMAP_BASE=http://localhost:3000 node scripts/audit-sitemap.mjs
//
// Output:
//   - Summary line: "X/Y OK (Zms)"
//   - Per-URL line for any non-200 OR redirect, prefixed with the status.
//   - Exit 0 if all 2xx, 1 otherwise (so CI can gate on this).

import { setTimeout as sleep } from "node:timers/promises";

const BASE = process.env.SITEMAP_BASE ?? "https://pdfcraftai.com";
const SITEMAP_URL = `${BASE.replace(/\/$/, "")}/sitemap.xml`;

// Concurrency cap — don't hammer the origin. 8 concurrent reqs is well
// under any reasonable rate limit and finishes 240+ URLs in ~30s.
const CONCURRENCY = 8;

// Per-request budget. Hostinger LSAPI occasionally takes 5-10s under
// load; 15s is generous without letting one stuck URL stall the run.
const REQUEST_TIMEOUT_MS = 15_000;

async function main() {
  process.stdout.write(`Fetching ${SITEMAP_URL}...\n`);
  const res = await fetch(SITEMAP_URL, { cache: "no-store" });
  if (!res.ok) {
    console.error(`sitemap fetch failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const xml = await res.text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (urls.length === 0) {
    console.error("no <loc> entries found — sitemap may be empty or malformed");
    process.exit(1);
  }
  process.stdout.write(`Auditing ${urls.length} URLs at concurrency=${CONCURRENCY}...\n\n`);

  const startedAt = Date.now();
  const results = await runWithConcurrency(urls, CONCURRENCY, probeUrl);
  const elapsedMs = Date.now() - startedAt;

  const ok = results.filter((r) => r.status >= 200 && r.status < 300);
  const issues = results.filter((r) => r.status < 200 || r.status >= 300);

  // Issues first — most actionable up top.
  if (issues.length > 0) {
    console.log("Issues:\n");
    for (const r of issues) {
      const tag = r.status === 0 ? "ERR" : String(r.status);
      console.log(`  [${tag}] ${r.url}${r.error ? ` — ${r.error}` : ""}`);
    }
    console.log("");
  }

  // Status distribution histogram — useful even when everything's green.
  const histogram = new Map();
  for (const r of results) {
    const key = r.status === 0 ? "ERR" : String(r.status);
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
  }
  const breakdown = [...histogram.entries()]
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join("  ");

  console.log(`Summary: ${ok.length}/${results.length} OK in ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(`Status:  ${breakdown}`);

  process.exit(issues.length === 0 ? 0 : 1);
}

async function probeUrl(url) {
  // HEAD first — saves bandwidth on 200s. Some Next.js dynamic routes
  // 405 HEAD even though GET works, so we fall through.
  for (const method of ["HEAD", "GET"]) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(url, {
        method,
        redirect: "manual", // surface redirects so audit catches them
        cache: "no-store",
        signal: ac.signal,
      });
      clearTimeout(timer);
      if (method === "HEAD" && (res.status === 405 || res.status === 501)) {
        // Try GET.
        continue;
      }
      return { url, status: res.status };
    } catch (err) {
      if (method === "GET") {
        return {
          url,
          status: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      // HEAD timeout / network error — try GET.
    }
  }
  // Unreachable but keeps TS-style discipline:
  return { url, status: 0, error: "all methods failed" };
}

async function runWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
      // Gentle pacing — keeps us well below any plausible rate limit.
      await sleep(20);
    }
  });
  await Promise.all(workers);
  return results;
}

main().catch((err) => {
  console.error("audit failed:", err);
  process.exit(1);
});
