#!/usr/bin/env node
// scripts/test-sev1-fixes.mjs
//
// 2026-05-12 — CI pins for the SEV-1 audit fixes. Each assertion
// locks in a fix that would otherwise be easy to undo in a future
// refactor. Pure static-parse.
//
// Sections:
//   A — .env.example completeness (key env vars documented)
//   B — Author page title strips role suffix
//   C — Help center: cancel-subscription article present
//   D — Help search wrapped in <form action> for SSR fallback
//   E — SMTP includes List-Unsubscribe headers (Gmail/Yahoo rules)
//   F — Sitemap excludes redirect-source tool IDs
//   G — Auth + contact error responses use canonical
//       { error: "snake_case_code", detail: "..." } shape

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const report = [];
function check(label, predicate) {
  const ok = !!predicate;
  if (ok) pass++; else fail++;
  report.push({ label, ok });
}

// ─── A: .env.example completeness ───
const ENV = readFileSync(".env.example", "utf8");
const ENV_REQUIRED = [
  "ADMIN_EMAILS",
  "CRON_SECRET",
  "TURNSTILE_SECRET_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "SMTP_HOST",
  "SMTP_PASS",
  "PDFCRAFT_API_KEY",
  "PDFCRAFT_WEBHOOK_SECRET",
  "SLACK_OPS_WEBHOOK_URL",
  "EMAIL_VERIFICATION_GATE",
  "QUALITY_SIGNAL_AUTO_ROUTE_ENABLED",
  "SIGNUP_GRANT_ENABLED",
  "REFERRALS_ENABLED",
];
for (const key of ENV_REQUIRED) {
  check(
    `A1: .env.example documents ${key}`,
    new RegExp(`^${key}=`, "m").test(ENV)
  );
}
check(
  "A2: .env.example does NOT contain stale Paddle block (Paddle retired)",
  !/PADDLE_API_KEY/.test(ENV)
);

// ─── B: Author page title strips role suffix ───
const AUTHOR_PAGE = readFileSync("app/about/authors/[slug]/page.tsx", "utf8");
check(
  "B1: author title strips '· pdfcraft ai' suffix from role",
  /author\.role\.replace\(\/\\s\*\[·•\]\\s\*pdfcraft ai/.test(AUTHOR_PAGE)
);

// ─── C: Help "How do I cancel" article ───
const HELP = readFileSync("lib/help-topics.ts", "utf8");
check(
  "C1: help article slug 'cancel-subscription' present",
  /slug:\s*"cancel-subscription"/.test(HELP)
);
check(
  "C2: cancel article references DPDP / GDPR deletion commitment",
  /DPDP|GDPR/.test(HELP) && /delete.*account/i.test(HELP)
);

// ─── D: Help search SSR fallback ───
const HELP_SEARCH = readFileSync(
  "components/marketing/HelpSearch.tsx",
  "utf8"
);
check(
  "D1: HelpSearch wraps input in <form method=get action=/help>",
  /<form[\s\S]{0,200}?method="get"[\s\S]{0,200}?action="\/help"/.test(
    HELP_SEARCH
  )
);
check(
  "D2: HelpSearch form has role='search'",
  /role="search"/.test(HELP_SEARCH)
);
check(
  "D3: HelpSearch input has name='q' for server-side query string",
  /name="q"/.test(HELP_SEARCH)
);

// ─── E: SMTP List-Unsubscribe headers ───
const SMTP = readFileSync("lib/auth/smtp.ts", "utf8");
check(
  "E1: sendMail includes List-Unsubscribe header",
  /"List-Unsubscribe":/.test(SMTP)
);
check(
  "E2: sendMail includes List-Unsubscribe-Post One-Click",
  /"List-Unsubscribe-Post":\s*"List-Unsubscribe=One-Click"/.test(SMTP)
);
check(
  "E3: List-Unsubscribe header has mailto + https two-method form",
  /mailto:[\s\S]{0,200}?\$\{baseUrl\}\/api\/email\/unsubscribe/.test(SMTP)
);

// ─── F: Sitemap excludes redirect-source tool IDs ───
const SITEMAP = readFileSync("app/sitemap.ts", "utf8");
check(
  "F1: REDIRECTED_TOOL_IDS set declared",
  /const REDIRECTED_TOOL_IDS\s*=\s*new Set\(/.test(SITEMAP)
);
check(
  "F2: REDIRECTED_TOOL_IDS contains ai-chat (308 → /chat-with-pdf)",
  /REDIRECTED_TOOL_IDS[\s\S]{0,500}?"ai-chat"/.test(SITEMAP)
);
check(
  "F3: REDIRECTED_TOOL_IDS contains ai-plagiarism (308 → ai-detector)",
  /REDIRECTED_TOOL_IDS[\s\S]{0,500}?"ai-plagiarism"/.test(SITEMAP)
);
check(
  "F4: toolRoutes filters out REDIRECTED_TOOL_IDS",
  // Anchor on the .filter() that excludes the redirected set.
  // The actual implementation spans multiple lines:
  //   TOOLS
  //     .filter((t) => !REDIRECTED_TOOL_IDS.has(t.id))
  //     .map(...)
  /TOOLS[\s\S]{0,80}?\.filter\([\s\S]{0,200}?!REDIRECTED_TOOL_IDS\.has\(t\.id\)/.test(
    SITEMAP
  )
);

// ─── G: Canonical error shape on the 3 standardised routes ───
const FORGOT = readFileSync("app/api/auth/forgot-password/route.ts", "utf8");
const RESET = readFileSync("app/api/auth/reset-password/route.ts", "utf8");
const CONTACT = readFileSync("app/api/contact/route.ts", "utf8");
for (const [name, src] of [
  ["forgot-password", FORGOT],
  ["reset-password", RESET],
  ["contact", CONTACT],
]) {
  // Strip line comments + block comments before the legacy-pattern
  // scan — historical commentary in this codebase often quotes the
  // old shape verbatim as documentation, which would false-positive.
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/gm, "");
  // Every error response must use the snake_case code + detail shape.
  // Catch the legacy sentence-cased form: `error: "Something here."`.
  // The new shape uses `error: "snake_case"` (lowercase + underscore).
  const legacyErrors = [
    ...stripped.matchAll(/error:\s*"[A-Z][^"]+\.["]/g),
  ];
  check(
    `G1.${name}: no legacy sentence-cased error strings (must use { error: "code", detail: "..." })`,
    legacyErrors.length === 0,
  );
  check(
    `G2.${name}: at least one canonical { error: "<snake_case>", detail: "..." } response`,
    /error:\s*"[a-z_]+",\s*\n?\s*detail:/m.test(src)
  );
}

// ─── Report ───
console.log("sev1-fixes:");
for (const r of report) console.log(`  ${r.ok ? "✓" : "✗"} ${r.label}`);
console.log(`sev1-fixes: ${pass} passed, ${fail} failed (of ${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
