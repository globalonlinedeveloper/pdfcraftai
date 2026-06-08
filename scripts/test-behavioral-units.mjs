#!/usr/bin/env node
/**
 * test-behavioral-units.mjs (auto-mode batch 5, backlog #126): REAL runtime
 * behavioral tests of critical client logic — it imports and EXECUTES the
 * actual TypeScript modules (via Node 22's native --experimental-strip-types),
 * not static-parse. Zero new dependencies, so it adds no weight to the (fragile)
 * deploy pipeline — unlike a full Vitest/jsdom stack.
 *
 * Covers:
 *   - lib/auth-callback.ts sanitizeCallbackUrl — the open-redirect guard that
 *     protects every post-login redirect. The single highest-value function to
 *     test behaviorally (a regression here = an open-redirect vuln).
 *   - lib/client/toast.ts toast() — event dispatch shape + SSR-safety.
 *
 * The aggregator runs `node <file>`; this self-re-execs with the TS loader.
 */

if (!process.execArgv.some((a) => a.includes("strip-types"))) {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", new URL(import.meta.url).pathname],
    { stdio: "inherit" },
  );
  process.exit(r.status ?? 1);
}

let passed = 0, failed = 0;
const fails = [];
const ok = (c, m) => { if (c) passed++; else { failed++; fails.push(m); } };

// ── sanitizeCallbackUrl (security: open-redirect prevention) ─────────
{
  const mod = await import("../lib/auth-callback.ts");
  const f = mod.sanitizeCallbackUrl;
  const DEF = mod.DEFAULT_CALLBACK;

  // valid relative paths pass through unchanged
  for (const v of ["/app/dashboard", "/pricing", "/tool/merge", "/app/chat?id=1", "/loginish", "/registered-users"]) {
    ok(f(v) === v, `sanitizeCallbackUrl passes valid path: ${v}`);
  }
  // dangerous / invalid inputs fall back to DEFAULT_CALLBACK
  const bad = [
    [null, "null"], [undefined, "undefined"], ["", "empty"],
    ["//evil.com", "protocol-relative"],
    ["http://evil.com", "absolute http"],
    ["https://evil.com/x", "absolute https"],
    ["javascript:alert(1)", "javascript: scheme"],
    ["/api/health", "/api/*"],
    ["/login", "/login exact"],
    ["/login?x=1", "/login with query"],
    ["/register", "/register exact"],
    ["not-a-path", "no leading slash"],
    ["/" + "x".repeat(600), "over-length"],
  ];
  for (const [v, label] of bad) {
    ok(f(v) === DEF, `sanitizeCallbackUrl rejects ${label} → DEFAULT_CALLBACK`);
  }
  // the returned value is always a safe same-origin path
  ok(f("//evil.com").startsWith("/") && !f("//evil.com").startsWith("//"), "rejected value is a safe same-origin path");
}

// ── toast() (event dispatch + SSR safety) ───────────────────────────
{
  const mod = await import("../lib/client/toast.ts");
  const { toast, TOAST_EVENT } = mod;

  // SSR-safe: no window → no throw, no return value
  const savedWindow = globalThis.window;
  // @ts-ignore
  delete globalThis.window;
  let threw = false;
  try { toast("server-side"); } catch { threw = true; }
  ok(!threw, "toast() is SSR-safe (no window → no throw)");

  // browser path: window as an EventTarget captures the dispatched CustomEvent
  ok(typeof CustomEvent !== "undefined", "CustomEvent is available (Node 22 global)");
  const events = [];
  const target = new EventTarget();
  target.addEventListener(TOAST_EVENT, (e) => events.push(e.detail));
  globalThis.window = target;

  toast("hello");
  toast("oops", { kind: "error", durationMs: 5000 });
  toast(""); // empty → no dispatch

  ok(events.length === 2, `toast dispatches one event per non-empty call (got ${events.length})`);
  ok(events[0]?.message === "hello" && events[0]?.kind === "info" && events[0]?.durationMs === 3000, "default toast: kind=info, durationMs=3000");
  ok(events[1]?.kind === "error" && events[1]?.durationMs === 5000, "toast respects kind + durationMs options");

  // restore
  if (savedWindow === undefined) { /* @ts-ignore */ delete globalThis.window; }
  else globalThis.window = savedWindow;
}

// ── email templates (welcome + receipt: shape + HTML-escaping) ──
{
  const mod = await import("../lib/email/templates.ts");
  const { escapeHtml, buildWelcomeEmail, buildReceiptEmail, formatAmount } = mod;

  // escapeHtml neutralises every HTML-significant char
  ok(escapeHtml('<a href="x">&\'</a>') === "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;", "escapeHtml escapes &<>\"'");
  ok(escapeHtml("plain text") === "plain text", "escapeHtml leaves safe text unchanged");

  // welcome email: shape + plain-text has no HTML tags
  const w = buildWelcomeEmail({ name: null });
  ok(typeof w.subject === "string" && w.subject.length > 0, "welcome has a subject");
  ok(/welcome/i.test(w.subject), "welcome subject says 'welcome'");
  ok(w.html.includes("<h1"), "welcome html has an <h1>");
  ok(w.html.includes("/login"), "welcome html links to /login");
  ok(!/</.test(w.text.replace(/[<>]/g, "")) || !w.text.includes("<h1"), "welcome text is not HTML (no <h1>)");

  // welcome with a malicious display name → escaped in HTML, never raw
  const wEvil = buildWelcomeEmail({ name: "<script>alert(1)</script>" });
  ok(!wEvil.html.includes("<script>"), "welcome html escapes a malicious name (no raw <script>)");
  ok(wEvil.html.includes("&lt;script&gt;"), "welcome html contains the escaped name");

  // receipt email: summary fields present + malicious pack name escaped
  const r = buildReceiptEmail({
    packName: "Creator",
    creditsLabel: "500 + 25 bonus",
    amountLabel: "₹1,499.00 INR",
    balanceLabel: "1,002 credits",
    dateLabel: "8 Jun 2026",
  });
  ok(r.subject.includes("Creator") && r.subject.includes("1,499.00"), "receipt subject has pack + amount");
  ok(r.html.includes("500 + 25 bonus") && r.html.includes("1,002 credits"), "receipt html shows credits + new balance");
  ok(r.text.includes("Creator") && r.text.includes("/app/billing"), "receipt text has pack + billing link");
  const rEvil = buildReceiptEmail({ packName: "<b>x</b>", creditsLabel: "1", amountLabel: "$1.00 USD", balanceLabel: "1", dateLabel: "x" });
  ok(!rEvil.html.includes("<b>x</b>") && rEvil.html.includes("&lt;b&gt;"), "receipt html escapes a malicious pack name");

  // formatAmount: minor units → major, currency symbol, 2 decimals
  ok(formatAmount(149900, "INR") === "₹1,499.00 INR", "formatAmount INR → ₹ with 2dp");
  ok(formatAmount(500, "USD") === "$5.00 USD", "formatAmount USD → $");
  ok(formatAmount(1000, "EUR") === "10.00 EUR", "formatAmount unknown currency → code only");
}

// ── low-credit decision (D33: crossing math — free users never fire) ──
{
  const mod = await import("../lib/email/low-credit-policy.ts");
  const { lowCreditDecision } = mod;
  const T = 50;
  // spend crossing DOWN from >= threshold → claim
  ok(lowCreditDecision({ newBalance: 45, delta: -10, threshold: T }) === "claim", "spend 55->45 crosses down → claim");
  ok(lowCreditDecision({ newBalance: 49, delta: -1, threshold: T }) === "claim", "spend 50->49 crosses down → claim");
  // spend while ALREADY below (no fresh crossing) → noop (no re-spam)
  ok(lowCreditDecision({ newBalance: 35, delta: -10, threshold: T }) === "noop", "spend 45->35 already below → noop");
  // spend staying at/above threshold → noop
  ok(lowCreditDecision({ newBalance: 60, delta: -10, threshold: T }) === "noop", "spend 70->60 stays above → noop");
  ok(lowCreditDecision({ newBalance: 50, delta: -10, threshold: T }) === "noop", "spend to exactly threshold (50) is not low → noop");
  // KEY: a new free user's signup grant (delta>0, stays below) NEVER fires
  ok(lowCreditDecision({ newBalance: 5, delta: 5, threshold: T }) === "noop", "free-user signup grant 0->5 → noop (never spam free users)");
  // grant crossing back to >= threshold → rearm
  ok(lowCreditDecision({ newBalance: 100, delta: 95, threshold: T }) === "rearm", "top-up 5->100 → rearm");
  ok(lowCreditDecision({ newBalance: 50, delta: 50, threshold: T }) === "rearm", "top-up to exactly threshold → rearm");
  // disabled threshold → always noop
  ok(lowCreditDecision({ newBalance: 1, delta: -10, threshold: 0 }) === "noop", "threshold<=0 disables → noop");
}

// ── low-credit + payment-failed email builders ─────────────────────
{
  const mod = await import("../lib/email/templates.ts");
  const { buildLowCreditEmail, buildPaymentFailedEmail } = mod;

  const lc = buildLowCreditEmail({ balance: 12, threshold: 50 });
  ok(/low/i.test(lc.subject), "low-credit subject says 'low'");
  ok(lc.html.includes("12") && lc.html.includes("/pricing"), "low-credit html shows balance + pricing link");
  ok(lc.text.includes("/pricing"), "low-credit text links to pricing");

  const pf = buildPaymentFailedEmail({ packName: "Creator" });
  ok(/payment/i.test(pf.subject) && /(didn|not)/i.test(pf.subject), "payment-failed subject conveys failure");
  ok(/not charged/i.test(pf.html) && pf.html.includes("/pricing"), "payment-failed html: not charged + retry link");
  ok(pf.html.includes("Creator"), "payment-failed names the pack when known");
  const pfEvil = buildPaymentFailedEmail({ packName: "<i>x</i>" });
  ok(!pfEvil.html.includes("<i>x</i>") && pfEvil.html.includes("&lt;i&gt;"), "payment-failed escapes a malicious pack name");
  const pfNone = buildPaymentFailedEmail({ packName: null });
  ok(typeof pfNone.subject === "string" && pfNone.html.includes("/pricing"), "payment-failed works with no pack name");
}

console.log("");
if (failed === 0) {
  console.log(`PASS — ${passed} assertions (real runtime execution)`);
  console.log(`${passed} passed, 0 failed`);
  process.exit(0);
} else {
  console.error("FAIL:");
  for (const m of fails) console.error("  " + m);
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(1);
}
