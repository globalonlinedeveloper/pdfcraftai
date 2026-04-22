// lib/user/format.ts — User-safe formatting helpers.
//
// Intentionally NOT re-exported from lib/admin/format. The admin side has
// helpers that format cost_micros / net_revenue_micros / processor fee /
// FX slippage — all of which are forbidden in user-facing code. Keeping
// a separate module makes that wall visible at import-time: if an app/app
// page ever imports from the admin library tree the reviewer should
// block the PR (and the user-dashboard-v2 harness will fail the build).
//
// Every helper here is pure + deterministic (no Date.now() side-channels
// inside render paths other than formatRelative's explicit `now` arg).
//
// Deliberately missing helpers (vs lib/admin/format):
//   - formatMicros / formatUsdMicros — users don't see USD micros ever
//   - formatMarginPct / formatCostPerCall — users don't see unit cost
//   - maskEmail — users only ever see their own email; no PII-masking needed
//
// Phase B/5 — Task #19.

import "server-only";

/**
 * Humanize a credit balance or per-op credit total. Renders compact once
 * we cross 10k to avoid long digit strings in the UI ("12,340" → "12.3k").
 * Always integer — credits are a unit count, never fractional.
 */
export function formatCredits(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (!Number.isFinite(n)) return "—";
  const v = Math.trunc(n);
  if (Math.abs(v) >= 10_000) {
    return (v / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  }
  return v.toLocaleString();
}

/**
 * Format a count of API calls / ledger entries / receipts. Same shape as
 * formatCredits but named separately so a grep for "credits" doesn't also
 * turn up "calls" and vice-versa — helps the test harness keep the PII
 * walls clean.
 */
export function formatCount(n: number | null | undefined): string {
  return formatCredits(n);
}

/**
 * Relative-time label for a timestamp ("3m ago", "2d ago", "just now").
 * Accepts Date | string | number; returns em-dash for invalid input so
 * the UI never renders "Invalid Date". Uses floor so "30s ago" becomes
 * "just now" only while < 10s.
 */
export function formatRelative(
  t: Date | string | number | null | undefined,
  now: number = Date.now()
): string {
  if (t === null || t === undefined) return "—";
  const ms = typeof t === "number" ? t : new Date(t).getTime();
  if (!Number.isFinite(ms)) return "—";
  const diff = now - ms;
  if (diff < 10_000) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

/**
 * Format a currency amount given as minor-unit integer + ISO currency code.
 * This is the SAFE formatter for user-facing payment amounts: it uses what
 * the user actually paid (amount_minor on payments row), which is the same
 * number the provider charged their card — it is NOT derived from
 * net_revenue_micros or gross_charge_micros (those expose the MoR split
 * and are forbidden in user bundles).
 *
 * Two-decimal rendering. Currency-code fallback for locales that
 * Intl.NumberFormat doesn't recognize.
 */
export function formatCurrencyMinor(
  minor: number | null | undefined,
  currency: string | null | undefined
): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) {
    return "—";
  }
  const cc = (currency ?? "USD").toUpperCase();
  const major = minor / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: cc,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${cc}`;
  }
}

/**
 * Percent (0..1 fraction → "87%"). Rounds to nearest whole. Useful for
 * success-rate / truncation-rate on the usage page.
 */
export function formatPercent(frac: number | null | undefined): string {
  if (frac === null || frac === undefined || !Number.isFinite(frac)) {
    return "—";
  }
  return `${Math.round(frac * 100)}%`;
}

/**
 * Clamp the ?days=N searchParam. Users can't request an unbounded range
 * (that would be a trivial DoS on ai_usage). Default 30, min 1, max 90.
 *
 * Admin gets 1..365; users get 1..90. The tighter cap is intentional —
 * the user-facing usage page is for operational awareness, not historical
 * analysis, and most rate-plan disputes are resolved in <30 days anyway.
 */
export function clampUserDays(raw: string | undefined | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 30;
  return Math.min(Math.max(Math.floor(n), 1), 90);
}

/**
 * Humanize a ledger reason code for the user-facing credits page.
 * The raw values come straight from credit_ledger.reason ("purchase",
 * "usage", "refund", "promo", "manual_grant", "subscription_grant",
 * "breakage_writeoff"). We show a friendlier label; unknown codes fall
 * through to the raw value so we never hide information.
 */
export function humanizeLedgerReason(reason: string | null | undefined): string {
  if (!reason) return "—";
  const map: Record<string, string> = {
    purchase: "Credit pack",
    subscription_grant: "Plan credit",
    usage: "AI usage",
    refund: "Refund",
    promo: "Promo credit",
    manual_grant: "Manual grant",
    breakage_writeoff: "Expired credits",
  };
  return map[reason] ?? reason;
}

/**
 * Map a payment/subscription status to a user-friendly label. Same shape
 * as billing/page.tsx STATUS_LABEL but exposed here so the receipts page
 * and plan page both use the same vocabulary.
 */
export function humanizeStatus(status: string | null | undefined): string {
  if (!status) return "—";
  const map: Record<string, string> = {
    pending: "Pending",
    captured: "Paid",
    failed: "Failed",
    refunded: "Refunded",
    partial_refund: "Partial refund",
    cancelled: "Cancelled",
    active: "Active",
    paused: "Paused",
  };
  return map[status] ?? status;
}

/**
 * Pack ID → display name. Sourced from lib/pricing CREDIT_PACKS but we
 * don't import that module here to keep lib/user edge-runtime-safe (the
 * CREDIT_PACKS module pulls in claimed-margin notes that are admin-only
 * in spirit). A stale label is a tolerable UX glitch; a leaked margin %
 * is not.
 */
export function humanizePackId(packId: string | null | undefined): string {
  if (!packId) return "—";
  const map: Record<string, string> = {
    starter: "Starter",
    creator: "Creator",
    pro: "Pro",
    studio: "Studio",
  };
  return map[packId] ?? packId;
}
