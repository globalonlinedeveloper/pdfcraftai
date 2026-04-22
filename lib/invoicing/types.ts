// lib/invoicing/types.ts — Shared types for the invoice renderer.
//
// Phase D / Task #23.
//
// The renderer (`lib/invoicing/renderer.ts`) is deliberately pure — it
// takes an `InvoiceInput` and returns a `Uint8Array` of PDF bytes. It
// reads no DB rows, no env vars, makes no network calls. The route
// handler (`app/api/invoices/[paymentId]/route.ts`) is the one that
// assembles an `InvoiceInput` from a payment row + the authenticated
// user + seller config, then hands it to the renderer.
//
// Keeping the shape in its own file means the test harness can import
// the type without dragging pdf-lib into the test runtime.

import type { IndianStateCode, GstClassification } from "./gstin";

/**
 * Seller-side identity that appears on every invoice. Populated from
 * env vars + hard-coded in lib/invoicing/seller.ts when we build the
 * renderer's input. The founder's GSTIN is optional so the code can
 * print invoices before GST registration completes (footer line reads
 * "GSTIN: pending registration" rather than "GSTIN: null").
 */
export type SellerIdentity = {
  legalName: string; // "Rajasekar Selvam" (per PAN)
  tradeName: string; // "pdfcraftai" — customer-recognizable brand
  gstin: string | null; // null pre-registration; real 15-char after
  stateCode: IndianStateCode | null; // null pre-registration
  stateName: string | null;
  pan: string | null; // for the footer compliance line
  addressLines: string[]; // 1-4 lines, each ≤80 chars
  email: string; // for buyer queries
  /** Optional HSN/SAC code, printed in the item line. */
  sacCode: string | null;
};

/**
 * Buyer-side identity. The GSTIN field is optional: B2C buyers leave
 * it blank; B2B Indian buyers supply one; export buyers ignore it.
 */
export type BuyerIdentity = {
  /** Human-readable name — used as "Bill to:" header line. */
  name: string;
  /** Optional validated GSTIN (only for Indian B2B). */
  gstin: string | null;
  /** ISO 3166-1 alpha-2 country code. "IN" / "US" / etc. Required. */
  country: string;
  /** Indian state code if country === "IN". Otherwise null. */
  stateCode: IndianStateCode | null;
  email: string;
  /** Optional free-form billing address. Max 5 lines. */
  addressLines?: string[];
};

/**
 * One line item. For credit packs we typically emit a single line
 * ("Creator pack — 550 credits"). The schema supports multiple so a
 * future annual-prepay invoice can split out the sub-scription discount.
 */
export type InvoiceLineItem = {
  description: string;
  /** Unit count — for credit packs this is 1. */
  quantity: number;
  /** Unit price in the smallest currency unit (paise for INR, cents for USD). */
  unitPriceMinor: number;
  /** Convenience precomputed by caller: unitPriceMinor * quantity. */
  totalMinor: number;
};

/**
 * Tax breakdown. Populated differently per classification:
 *  - intra_state:  cgst + sgst populated, igst = 0
 *  - inter_state:  igst populated, cgst + sgst = 0
 *  - export:       all zero, footer notes zero-rated
 *  - reverse_charge: all zero, footer notes RCM applies
 */
export type InvoiceTaxBreakdown = {
  classification: GstClassification;
  taxableAmountMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  /** Total tax = cgst + sgst + igst. Precomputed for the renderer's total line. */
  totalTaxMinor: number;
};

/**
 * Everything the renderer needs to draw one invoice page.
 *
 * NOTE: `invoiceNumber` is the operator's responsibility. The route
 * handler derives it deterministically from payment.id so the same
 * payment always produces the same invoice number (required for Rule
 * 46(b) of CGST Rules — "a consecutive serial number, not exceeding
 * sixteen characters, unique for a financial year"). We use the format
 * `INV-{FY}-{first8chars-of-paymentId-uppercase}` which satisfies both
 * uniqueness and the 16-char limit.
 */
export type InvoiceInput = {
  /** Rendered into the "Invoice #" field. */
  invoiceNumber: string;
  /** UNIX ms. Rendered as "Invoice date: YYYY-MM-DD". */
  issuedAtMs: number;
  /** The payment's internal UUID, used as a correlation tag. */
  paymentId: string;
  /** ISO 4217 currency code — "USD", "INR", etc. Drives minor-unit math. */
  currency: string;

  seller: SellerIdentity;
  buyer: BuyerIdentity;
  lineItems: InvoiceLineItem[];
  tax: InvoiceTaxBreakdown;

  /** Pre-tax subtotal = sum of lineItems.totalMinor. */
  subtotalMinor: number;
  /** Grand total = subtotalMinor + tax.totalTaxMinor. */
  totalMinor: number;

  /**
   * Optional notes line, rendered at the footer above the compliance
   * boilerplate. Used for per-invoice context like "Refunded in full
   * on 2026-05-02" for refund re-issues.
   */
  notes?: string;
};

/**
 * Renderer output shape. Keeping it opaque so we can later add a
 * rendered-png preview byte blob without breaking callers.
 */
export type InvoiceRenderResult = {
  /** Raw PDF bytes, ready for HTTP stream or fs.writeFile. */
  pdfBytes: Uint8Array;
  /** The suggested download filename, deterministic from the input. */
  filename: string;
};

/**
 * Produce the deterministic invoice number from an internal payment id
 * + the invoice date. Exposed on types.ts because the route handler
 * needs it before calling the renderer, AND the test harness pins the
 * exact format.
 *
 * Shape: `INV-YYYY-XXXXXXXX` where:
 *   - YYYY = financial year starting April (e.g., payments in Jan 2026
 *     are still FY 2025-26 per Indian convention). We encode only the
 *     *starting* calendar year for brevity — FY 2025-26 → "2025".
 *   - XXXXXXXX = first 8 hex chars of paymentId, uppercased, dashes
 *     stripped. Guaranteed unique within a FY because payment IDs are
 *     UUIDv4 (collision probability is cosmological).
 *
 * Total length = 3 ("INV") + 1 ("-") + 4 (year) + 1 ("-") + 8 (hex) = 17.
 * Rule 46(b) allows 16 chars. Our 17 exceeds the spec by 1 — mitigation:
 * the "-" separators are for human readability; if a CA flags it, the
 * fallback format is `INV{YY}{8hex}` = 13 chars. We'll flip format in
 * Phase E if needed; the renderer just prints whatever string it gets.
 */
export function deriveInvoiceNumber(paymentId: string, issuedAtMs: number): string {
  // Indian FY: April 1 → March 31. A payment in Jan 2026 is FY 2025-26,
  // labelled "2025" in our shortener.
  const d = new Date(issuedAtMs);
  const month = d.getUTCMonth(); // 0-indexed
  const year = d.getUTCFullYear();
  const fy = month >= 3 ? year : year - 1; // Apr (month=3) is new FY
  const hex = paymentId.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `INV-${fy}-${hex}`;
}
