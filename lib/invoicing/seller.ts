// lib/invoicing/seller.ts — Seller-side identity resolver.
//
// Phase D / Task #23.
//
// The invoice renderer takes a `SellerIdentity` as part of its input.
// That shape is env-driven — the seller's legal name, PAN, GSTIN, etc.
// change rarely, and any Phase E swap (adding a second seller entity,
// registering in a new state) is a config change, not a code change.
//
// This module centralises the env-var reads so the route handler (and
// any future invoice-generating job) doesn't each parse env vars on
// their own with slightly different defaults.
//
// ENV VARS consumed (all optional with hard-coded fallbacks for v1):
//
//   INVOICE_SELLER_LEGAL_NAME   — default: "Rajasekar Selvam"
//   INVOICE_SELLER_TRADE_NAME   — default: "pdfcraftai"
//   INVOICE_SELLER_GSTIN        — default: null (pre-registration)
//   INVOICE_SELLER_STATE_CODE   — default: null (pre-registration);
//                                 must be a 2-char IndianStateCode
//   INVOICE_SELLER_PAN          — default: null
//   INVOICE_SELLER_ADDRESS_1..4 — default: null (rendered if set)
//   INVOICE_SELLER_EMAIL        — default: "support@pdfcraftai.com"
//   INVOICE_SELLER_SAC_CODE     — default: "998313" (Software services)
//
// The defaults are intentionally tuned for the sole-prop / pre-GST era
// so a brand new deploy of the code produces a compliant "GSTIN: pending
// registration" invoice without any env var set. Once GST registration
// lands in Phase E, operator sets the real values in Hostinger hPanel
// and redeploys. No other code touches this.

import type { SellerIdentity } from "./types";
import { INDIAN_STATE_CODES, type IndianStateCode } from "./gstin";

/**
 * Resolve the seller identity from the current process env. Pure: reads
 * only `process.env`, no fs / network / db.
 *
 * Exported as a function (not a top-level constant) so tests can mutate
 * env vars between cases without cache invalidation.
 */
export function getSellerIdentity(): SellerIdentity {
  const env = process.env;

  const legalName = (env.INVOICE_SELLER_LEGAL_NAME || "Rajasekar Selvam").trim();
  const tradeName = (env.INVOICE_SELLER_TRADE_NAME || "pdfcraftai").trim();
  const gstinRaw = (env.INVOICE_SELLER_GSTIN || "").trim();
  const gstin = gstinRaw.length > 0 ? gstinRaw.toUpperCase() : null;

  const stateCodeRaw = (env.INVOICE_SELLER_STATE_CODE || "").trim();
  let stateCode: IndianStateCode | null = null;
  let stateName: string | null = null;
  if (stateCodeRaw && stateCodeRaw in INDIAN_STATE_CODES) {
    stateCode = stateCodeRaw as IndianStateCode;
    stateName = INDIAN_STATE_CODES[stateCode];
  }

  const pan = (env.INVOICE_SELLER_PAN || "").trim().toUpperCase() || null;

  const addressLines: string[] = [];
  for (let i = 1; i <= 4; i++) {
    const line = (env[`INVOICE_SELLER_ADDRESS_${i}`] || "").trim();
    if (line) addressLines.push(line);
  }

  const email = (env.INVOICE_SELLER_EMAIL || "support@pdfcraftai.com").trim();

  // 998313 = "Information technology (IT) consulting and support services"
  // per the CBIC SAC master list. 998314 = "Information technology (IT)
  // design and development services". Either is acceptable for our SaaS.
  const sacCode = (env.INVOICE_SELLER_SAC_CODE || "998313").trim() || null;

  return {
    legalName,
    tradeName,
    gstin,
    stateCode,
    stateName,
    pan,
    addressLines,
    email,
    sacCode,
  };
}
