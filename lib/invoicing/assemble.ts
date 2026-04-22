// lib/invoicing/assemble.ts — Payment row → InvoiceInput assembler.
//
// Phase D / Task #23.
//
// The renderer is pure; the route handler is auth + DB. This file is
// the middle layer that turns "a payment row + a ledger row + the
// authenticated user's profile" into a fully-populated `InvoiceInput`
// that the renderer can draw. It contains the invoice-specific business
// logic:
//
//   - Resolving the pack/plan human-readable name from the pricing
//     registry (so the line item reads "Creator pack — 525 credits",
//     not "creator").
//   - Splitting a total amount into subtotal + GST per classification.
//   - Hooking `classifyGst()` + `deriveInvoiceNumber()` up to the
//     payment row.
//
// Kept separate from the renderer so the unit tests for "tax math is
// correct" don't need pdf-lib in the runtime, and so the renderer can
// be reused for non-payment invoices (future: credit-note PDFs on
// refund issue).

import type { InvoiceInput, InvoiceLineItem, InvoiceTaxBreakdown, BuyerIdentity, SellerIdentity } from "./types";
import { deriveInvoiceNumber } from "./types";
import { classifyGst, type IndianStateCode } from "./gstin";
import { CREDIT_PACKS, type CreditPackId } from "../pricing";

/**
 * Minimal payment row shape needed for invoicing. Mirrors the `payments`
 * table in db/schema/app.ts; kept as its own shape so this module
 * doesn't import the schema types (which would drag drizzle into any
 * consumer of the renderer).
 */
export type PaymentForInvoice = {
  id: string;
  amountMinor: number;
  currency: string;
  packId: string | null;
  planCode: string | null;
  status: string;
  createdAtMs: number;
};

/**
 * Minimal ledger row shape — we only need the tax columns. Nullable
 * because some historical payments pre-date the Task #15 schema
 * expansion; the assembler degrades gracefully to "no tax collected"
 * in that case.
 */
export type LedgerTaxRow = {
  taxCollectedMicros: number | null;
  taxTreatment: "mor" | "forward" | "rcm" | "none" | null;
  taxRemittableMicros: number | null;
} | null;

/**
 * Buyer context from the session + user profile. Required because the
 * classification decision depends on the buyer's country + state.
 */
export type BuyerContext = {
  name: string;
  email: string;
  country: string; // ISO-3166 alpha-2
  stateCode: IndianStateCode | null;
  gstin: string | null;
  addressLines?: string[];
};

/**
 * Resolve the display-friendly line-item description for a one-time
 * credit-pack purchase. Falls back to a generic string for unknown
 * packIds (shouldn't happen in practice, but defensive).
 */
function describePack(packId: string | null): string {
  if (!packId) return "Credit pack purchase";
  const pack = CREDIT_PACKS.find((p) => p.id === (packId as CreditPackId));
  if (!pack) return `Credit pack (${packId})`;
  const bonus = pack.bonus ? ` + ${pack.bonus} bonus` : "";
  return `${pack.name} pack — ${pack.credits} credits${bonus}`;
}

/**
 * Resolve the display-friendly line-item description for a subscription
 * payment. Currently a placeholder — the subscription plan catalogue
 * ships in Phase E task #27 (annual prepay + monthly tiers). Until
 * then, any payment with a `planCode` renders a descriptive fallback
 * so the invoice still prints for test subs.
 */
function describePlan(planCode: string | null): string {
  if (!planCode) return "Subscription payment";
  return `Subscription payment — ${planCode}`;
}

/**
 * Build the tax breakdown block from an amount + classification.
 *
 * Inputs:
 *   - `totalMinor`: the charged amount in minor units (paise for INR,
 *     cents for USD, etc.) — this is `payments.amountMinor`.
 *   - `taxCollectedMicros`: the tax portion in micros, from
 *     `creditLedger.taxCollectedMicros`. When null/zero we infer that
 *     no tax was collected (legacy row or export sale).
 *   - `classification`: output of `classifyGst()` for this buyer.
 *
 * Conversion math:
 *   1 major unit = 100 minor = 1,000,000 micros
 *   → taxMinor = Math.round(taxCollectedMicros / 10_000)
 *
 * For intra_state: split tax 50/50 between CGST and SGST.
 * For inter_state: entire tax is IGST.
 * For export / reverse_charge: all tax fields are zero (tax is borne by
 * either the buyer under RCM or is zero-rated under Section 16 IGST).
 */
export function buildTaxBreakdown(
  totalMinor: number,
  taxCollectedMicros: number | null,
  classification: ReturnType<typeof classifyGst>
): InvoiceTaxBreakdown {
  const taxMinor =
    taxCollectedMicros && taxCollectedMicros > 0
      ? Math.round(taxCollectedMicros / 10_000)
      : 0;
  const taxableAmountMinor = totalMinor - taxMinor;

  let cgstMinor = 0;
  let sgstMinor = 0;
  let igstMinor = 0;

  if (taxMinor > 0) {
    if (classification === "intra_state") {
      // Split exactly in half. Integer rounding means if taxMinor is
      // odd, CGST gets the extra paisa (common CA convention; the two
      // halves differ by at most 1 minor unit).
      cgstMinor = Math.ceil(taxMinor / 2);
      sgstMinor = taxMinor - cgstMinor;
    } else if (classification === "inter_state") {
      igstMinor = taxMinor;
    }
    // "export" / "reverse_charge" leave all three at zero. Having
    // tax_collected > 0 in those buckets is a data bug, not the
    // renderer's problem — emit as IGST with a note.
    if (classification === "export" || classification === "reverse_charge") {
      igstMinor = taxMinor; // visible fallback so nothing silently disappears
    }
  }

  return {
    classification,
    taxableAmountMinor,
    cgstMinor,
    sgstMinor,
    igstMinor,
    totalTaxMinor: taxMinor,
  };
}

/**
 * Build the full `InvoiceInput` from a payment + buyer + seller + tax
 * info. Pure: no DB / network. Deterministic: calling twice with the
 * same inputs produces byte-identical output.
 */
export function assembleInvoiceInput(args: {
  payment: PaymentForInvoice;
  ledger: LedgerTaxRow;
  buyer: BuyerContext;
  seller: SellerIdentity;
  /** Optional — populated on refund re-issues to stamp "Refunded on …". */
  notes?: string;
}): InvoiceInput {
  const { payment, ledger, buyer, seller, notes } = args;

  const invoiceNumber = deriveInvoiceNumber(payment.id, payment.createdAtMs);

  const classification = classifyGst({
    buyerCountry: buyer.country,
    buyerStateCode: buyer.stateCode,
    sellerStateCode: seller.stateCode,
    // We don't infer RCM automatically — Phase E operator-side flag.
    forceReverseCharge: false,
  });

  const tax = buildTaxBreakdown(
    payment.amountMinor,
    ledger?.taxCollectedMicros ?? null,
    classification
  );

  // One line item for credit packs, one for subscription payments. A
  // future promo-discount line item (future Phase E) would append here.
  const description = payment.packId
    ? describePack(payment.packId)
    : describePlan(payment.planCode);

  const lineItems: InvoiceLineItem[] = [
    {
      description,
      quantity: 1,
      unitPriceMinor: tax.taxableAmountMinor,
      totalMinor: tax.taxableAmountMinor,
    },
  ];

  const subtotalMinor = tax.taxableAmountMinor;
  const totalMinor = subtotalMinor + tax.totalTaxMinor;

  const buyerIdentity: BuyerIdentity = {
    name: buyer.name,
    gstin: buyer.gstin,
    country: buyer.country.toUpperCase(),
    stateCode: buyer.stateCode,
    email: buyer.email,
    addressLines: buyer.addressLines,
  };

  return {
    invoiceNumber,
    issuedAtMs: payment.createdAtMs,
    paymentId: payment.id,
    currency: payment.currency.toUpperCase(),
    seller,
    buyer: buyerIdentity,
    lineItems,
    tax,
    subtotalMinor,
    totalMinor,
    notes,
  };
}
