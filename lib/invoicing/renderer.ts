// lib/invoicing/renderer.ts — Pure invoice PDF renderer.
//
// Phase D / Task #23.
//
// This module takes a fully-assembled `InvoiceInput` and produces a
// single-page A4 PDF. It is intentionally pure:
//
//   - No DB reads.
//   - No env var reads.
//   - No network I/O.
//   - No logger writes.
//
// The caller (usually `app/api/invoices/[paymentId]/route.ts`) is
// responsible for:
//   1. Resolving the authenticated user → payment row.
//   2. Looking up the seller config (env-derived via lib/invoicing/seller.ts,
//      which will land alongside a future migration).
//   3. Classifying GST via `classifyGst()`.
//   4. Computing the tax split amounts from `creditLedger.taxTreatment`.
//   5. Calling `renderInvoice(input)`.
//
// Why the separation: the renderer gets unit-tested without spinning up
// a DB or mocking the session store. Golden-file tests pin the exact
// byte structure, and compliance tests pin that the right strings
// appear in the right positions (e.g. "GSTIN:" appears once, "Invoice
// Number" appears once, the invoice number matches the derived value).
//
// Layout (A4 portrait, 595.28 × 841.89 pt):
//   ┌──────────────────────────────────────────────────┐
//   │ HEADER: seller legal name + trade name           │  y≈790
//   │         seller address / email / GSTIN           │
//   ├──────────────────────────────────────────────────┤
//   │ INVOICE META: number | date | payment ref        │  y≈680
//   ├──────────────────────────────────────────────────┤
//   │ BILL TO: buyer name + address + country          │  y≈600
//   │          buyer GSTIN (if India + B2B)            │
//   ├──────────────────────────────────────────────────┤
//   │ LINE ITEMS TABLE                                 │  y≈500
//   │   [desc] [qty] [unit] [total]                    │
//   ├──────────────────────────────────────────────────┤
//   │ TAX BREAKDOWN (right-aligned)                    │  y≈400
//   │   Subtotal / CGST / SGST / IGST / Total          │
//   ├──────────────────────────────────────────────────┤
//   │ FOOTER: classification text + HSN/SAC + PAN      │  y≈100
//   │         + static compliance boilerplate          │
//   └──────────────────────────────────────────────────┘

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { InvoiceInput, InvoiceRenderResult } from "./types";
import { describeClassification } from "./gstin";

/**
 * Format a minor-unit amount as a display string.
 *
 * INR uses 2 decimals (paise) with "₹" prefix if the `currency === "INR"`
 * (we fall back to "Rs." when rendering on pdf-lib's Helvetica, which
 * does not support the rupee glyph).
 *
 * USD uses 2 decimals (cents) with "$" prefix.
 *
 * Other currencies default to 2 decimals + ISO code suffix.
 */
function formatMinor(amountMinor: number, currency: string): string {
  const abs = Math.abs(amountMinor);
  const major = Math.floor(abs / 100);
  const minor = abs % 100;
  const sign = amountMinor < 0 ? "-" : "";
  const formatted =
    major.toLocaleString("en-IN") + "." + String(minor).padStart(2, "0");
  switch (currency.toUpperCase()) {
    case "INR":
      // Helvetica lacks the ₹ glyph → "Rs." is the CBIC-acceptable fallback
      // for printed invoices.
      return `${sign}Rs. ${formatted}`;
    case "USD":
      return `${sign}$${formatted}`;
    case "EUR":
      // Helvetica does embed the euro glyph (WinAnsi has it at 0x80), but
      // pdf-lib's StandardFonts.Helvetica encoding is WinAnsi-compatible, so
      // "€" renders correctly. If it ever doesn't, change to "EUR ".
      return `${sign}€${formatted}`;
    case "GBP":
      return `${sign}£${formatted}`;
    default:
      return `${sign}${formatted} ${currency.toUpperCase()}`;
  }
}

/** Format UNIX ms as "YYYY-MM-DD" (UTC). */
function formatIsoDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Render a single-page A4 invoice PDF from the fully-assembled input.
 *
 * Returns both the raw bytes AND the recommended filename so the route
 * handler doesn't have to duplicate the filename derivation.
 *
 * The filename format is `invoice-<invoiceNumber>.pdf`, which makes the
 * downloaded file searchable on the user's disk and deduplicable (same
 * invoice number = same filename).
 */
export async function renderInvoice(
  input: InvoiceInput
): Promise<InvoiceRenderResult> {
  const doc = await PDFDocument.create();

  // Minimal metadata — the invoice number is the key identifier. We
  // deliberately do NOT embed the user's name in Title/Author to keep
  // the PDF free of ambient PII when the user emails it onward.
  doc.setTitle(`Invoice ${input.invoiceNumber}`);
  doc.setAuthor(input.seller.tradeName);
  doc.setSubject(`Payment ${input.paymentId}`);
  doc.setProducer("pdfcraftai invoicing v1");
  doc.setCreationDate(new Date(input.issuedAtMs));
  doc.setModificationDate(new Date(input.issuedAtMs));

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  // A4: 595.28 x 841.89 pt. Page.drawText uses bottom-left origin.
  const page = doc.addPage([595.28, 841.89]);
  const pageW = page.getWidth();
  const pageH = page.getHeight();

  const margin = 40;
  const contentW = pageW - margin * 2;

  // Colours — intentionally muted so the invoice looks printed, not
  // screen-native. Black text on white paper is the most photocopy-
  // tolerant option for CA-led audits.
  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.36, 0.38, 0.42);
  const rule = rgb(0.78, 0.79, 0.82);

  let y = pageH - margin;

  // ─── HEADER ────────────────────────────────────────────────────────
  // Trade name first in large type, legal name beneath in small type.
  // This is a deliberate inversion of the usual "legal first" pattern:
  // customers recognise "pdfcraftai" on their credit-card statements,
  // not "Rajasekar Selvam". The small-type legal name still meets the
  // disclosure requirement of Rule 46(c).
  page.drawText(input.seller.tradeName, {
    x: margin,
    y: y - 18,
    size: 22,
    font: bold,
    color: ink,
  });
  y -= 22;
  page.drawText(input.seller.legalName, {
    x: margin,
    y: y - 14,
    size: 10,
    font: italic,
    color: muted,
  });
  y -= 18;

  // Seller address + contact lines
  for (const line of input.seller.addressLines) {
    page.drawText(line, {
      x: margin,
      y: y - 12,
      size: 9,
      font: regular,
      color: muted,
    });
    y -= 12;
  }
  page.drawText(`Email: ${input.seller.email}`, {
    x: margin,
    y: y - 12,
    size: 9,
    font: regular,
    color: muted,
  });
  y -= 12;

  // GSTIN row. The wording when null deliberately avoids "N/A" — a CA
  // reading the invoice needs to see that we have a considered posture,
  // not a missing value.
  const gstinLine = input.seller.gstin
    ? `GSTIN: ${input.seller.gstin}${
        input.seller.stateName ? ` (${input.seller.stateName})` : ""
      }`
    : "GSTIN: pending registration";
  page.drawText(gstinLine, {
    x: margin,
    y: y - 12,
    size: 9,
    font: bold,
    color: ink,
  });
  y -= 12;
  if (input.seller.pan) {
    page.drawText(`PAN: ${input.seller.pan}`, {
      x: margin,
      y: y - 12,
      size: 9,
      font: regular,
      color: muted,
    });
    y -= 12;
  }

  // Horizontal rule.
  y -= 10;
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageW - margin, y },
    thickness: 0.5,
    color: rule,
  });
  y -= 18;

  // ─── INVOICE META ──────────────────────────────────────────────────
  // Three-column meta strip: Invoice # | Date | Payment ref.
  const metaCols = [
    { label: "INVOICE NUMBER", value: input.invoiceNumber },
    { label: "INVOICE DATE", value: formatIsoDate(input.issuedAtMs) },
    { label: "PAYMENT REF", value: input.paymentId },
  ];
  const colW = contentW / metaCols.length;
  for (let i = 0; i < metaCols.length; i++) {
    const col = metaCols[i];
    const cx = margin + colW * i;
    page.drawText(col.label, {
      x: cx,
      y: y - 8,
      size: 7,
      font: bold,
      color: muted,
    });
    page.drawText(col.value, {
      x: cx,
      y: y - 22,
      size: 10,
      font: regular,
      color: ink,
    });
  }
  y -= 38;

  // ─── BILL TO ────────────────────────────────────────────────────────
  page.drawText("BILL TO", {
    x: margin,
    y: y - 8,
    size: 7,
    font: bold,
    color: muted,
  });
  y -= 22;
  page.drawText(input.buyer.name, {
    x: margin,
    y: y - 12,
    size: 11,
    font: bold,
    color: ink,
  });
  y -= 14;
  if (input.buyer.addressLines) {
    for (const line of input.buyer.addressLines) {
      page.drawText(line, {
        x: margin,
        y: y - 12,
        size: 9,
        font: regular,
        color: muted,
      });
      y -= 12;
    }
  }
  page.drawText(
    `Country: ${input.buyer.country}${
      input.buyer.stateCode ? ` (state ${input.buyer.stateCode})` : ""
    }`,
    { x: margin, y: y - 12, size: 9, font: regular, color: muted }
  );
  y -= 12;
  page.drawText(`Email: ${input.buyer.email}`, {
    x: margin,
    y: y - 12,
    size: 9,
    font: regular,
    color: muted,
  });
  y -= 12;
  if (input.buyer.gstin) {
    page.drawText(`Buyer GSTIN: ${input.buyer.gstin}`, {
      x: margin,
      y: y - 12,
      size: 9,
      font: bold,
      color: ink,
    });
    y -= 12;
  }

  // ─── LINE ITEMS TABLE ───────────────────────────────────────────────
  y -= 16;
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageW - margin, y },
    thickness: 0.5,
    color: rule,
  });
  y -= 14;

  // Column layout: description (flex) | qty (right) | unit (right) | total (right)
  const colDescX = margin;
  const colQtyX = margin + contentW - 260;
  const colUnitX = margin + contentW - 170;
  const colTotalX = margin + contentW - 80;

  page.drawText("DESCRIPTION", {
    x: colDescX,
    y: y - 8,
    size: 7,
    font: bold,
    color: muted,
  });
  page.drawText("QTY", {
    x: colQtyX,
    y: y - 8,
    size: 7,
    font: bold,
    color: muted,
  });
  page.drawText("UNIT PRICE", {
    x: colUnitX,
    y: y - 8,
    size: 7,
    font: bold,
    color: muted,
  });
  page.drawText("AMOUNT", {
    x: colTotalX,
    y: y - 8,
    size: 7,
    font: bold,
    color: muted,
  });
  y -= 18;

  for (const item of input.lineItems) {
    // Wrap the description at ~50 chars — Helvetica 10pt ≈ 5pt/char, so
    // (colQtyX - colDescX - padding) / 5 is the max. We keep it simple:
    // single-line for credit-pack descriptions (always short in v1).
    page.drawText(item.description, {
      x: colDescX,
      y: y - 10,
      size: 10,
      font: regular,
      color: ink,
    });
    if (input.seller.sacCode) {
      page.drawText(`HSN/SAC: ${input.seller.sacCode}`, {
        x: colDescX,
        y: y - 22,
        size: 8,
        font: italic,
        color: muted,
      });
    }
    page.drawText(String(item.quantity), {
      x: colQtyX,
      y: y - 10,
      size: 10,
      font: regular,
      color: ink,
    });
    page.drawText(formatMinor(item.unitPriceMinor, input.currency), {
      x: colUnitX,
      y: y - 10,
      size: 10,
      font: regular,
      color: ink,
    });
    page.drawText(formatMinor(item.totalMinor, input.currency), {
      x: colTotalX,
      y: y - 10,
      size: 10,
      font: regular,
      color: ink,
    });
    y -= input.seller.sacCode ? 28 : 18;
  }

  // ─── TAX BREAKDOWN ──────────────────────────────────────────────────
  y -= 6;
  page.drawLine({
    start: { x: margin + contentW - 240, y },
    end: { x: pageW - margin, y },
    thickness: 0.5,
    color: rule,
  });
  y -= 14;

  // Right-aligned two-column strip (label | amount).
  const taxLabelX = margin + contentW - 240;
  const taxValX = colTotalX;

  const drawTaxRow = (label: string, amountMinor: number, emphasise = false) => {
    page.drawText(label, {
      x: taxLabelX,
      y: y - 10,
      size: emphasise ? 10 : 9,
      font: emphasise ? bold : regular,
      color: emphasise ? ink : muted,
    });
    page.drawText(formatMinor(amountMinor, input.currency), {
      x: taxValX,
      y: y - 10,
      size: emphasise ? 10 : 9,
      font: emphasise ? bold : regular,
      color: ink,
    });
    y -= 14;
  };

  drawTaxRow("Subtotal", input.subtotalMinor);

  // Render only the relevant tax lines — zero-valued lines are skipped
  // so an export invoice doesn't show a long list of "CGST 0.00" etc.
  if (input.tax.cgstMinor > 0) drawTaxRow("CGST (9%)", input.tax.cgstMinor);
  if (input.tax.sgstMinor > 0) drawTaxRow("SGST (9%)", input.tax.sgstMinor);
  if (input.tax.igstMinor > 0) drawTaxRow("IGST (18%)", input.tax.igstMinor);

  // Always draw the Total line, even if tax is zero (export case):
  // auditors parse the Total deterministically.
  y -= 4;
  page.drawLine({
    start: { x: taxLabelX, y },
    end: { x: pageW - margin, y },
    thickness: 0.5,
    color: rule,
  });
  y -= 14;
  drawTaxRow(
    `Total (${input.currency.toUpperCase()})`,
    input.totalMinor,
    true
  );

  // ─── FOOTER ─────────────────────────────────────────────────────────
  // Classification text + compliance boilerplate at the bottom of the
  // page. We anchor from the bottom of the page so the footer stays in
  // a predictable position regardless of how many line items were
  // rendered above.
  const footerY = 110;

  // Optional per-invoice notes line (refund stamps, etc.).
  if (input.notes) {
    page.drawText(`Note: ${input.notes}`, {
      x: margin,
      y: footerY + 40,
      size: 9,
      font: italic,
      color: muted,
    });
  }

  page.drawLine({
    start: { x: margin, y: footerY + 24 },
    end: { x: pageW - margin, y: footerY + 24 },
    thickness: 0.5,
    color: rule,
  });

  // Tax treatment description.
  page.drawText(describeClassification(input.tax.classification), {
    x: margin,
    y: footerY + 10,
    size: 9,
    font: bold,
    color: ink,
  });

  // Static compliance line — wording is from docs/india/TAX_MODEL.md.
  // We print identical text on every invoice so a CA can eyeball-match
  // invoices from different FY quarters.
  const complianceLine =
    input.tax.classification === "export"
      ? "Zero-rated supply under LUT; no IGST payable per Section 16(3)(a), IGST Act 2017."
      : input.tax.classification === "reverse_charge"
      ? "Tax payable by recipient under reverse-charge mechanism."
      : input.seller.gstin
      ? "Tax collected as shown above. Supplier liable to remit to Govt. of India."
      : "Supplier is below GST registration threshold; no GST collected.";
  page.drawText(complianceLine, {
    x: margin,
    y: footerY - 6,
    size: 8,
    font: regular,
    color: muted,
  });

  page.drawText(
    "This is a computer-generated invoice; a signature is not required.",
    { x: margin, y: footerY - 20, size: 8, font: italic, color: muted }
  );

  // Emit bytes. We use Uint8Array (not Buffer) so this works in any
  // runtime (Node / Edge / test harness).
  const pdfBytes = await doc.save();
  const filename = `invoice-${input.invoiceNumber}.pdf`;
  return { pdfBytes, filename };
}
