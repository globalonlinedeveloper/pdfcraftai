// lib/invoicing/gstin.ts — GSTIN validator + state resolver.
//
// Phase D / Task #23.
//
// Why this lives in its own file:
// -------------------------------
// GSTIN is India's Goods & Services Tax Identification Number. The 15-char
// identifier encodes the taxpayer's state, PAN, and a check digit. Our
// invoice renderer, tax-classification logic, and (eventually) the
// user-facing GSTIN entry form all need the same validator — hence a
// pure module that takes a string, returns a structured verdict.
//
// The format (per CBIC spec, https://www.gst.gov.in/help/gstin):
//
//   Position 1-2  : two-digit state code  (01..38, see STATE_CODES below)
//   Position 3-12 : 10-char PAN of the holder (5 letters + 4 digits + 1 letter)
//   Position 13   : entity code per PAN holder (1 by default, increments
//                   on the same PAN for additional businesses)
//   Position 14   : always 'Z' for regular taxpayers (other letters exist
//                   for composition / OIDAR / casual taxpayer, but we
//                   don't transact with those shapes — we reject them)
//   Position 15   : Mod-36 check digit over positions 1-14
//
// The Mod-36 algorithm (CBIC public reference):
//
//   alphabet   = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"  // 36 symbols
//   For i in 0..13:
//     value_i = alphabet.indexOf(char_i)
//     factor  = (i % 2 === 0) ? 1 : 2
//     prod_i  = value_i * factor
//     sum    += Math.floor(prod_i / 36) + (prod_i % 36)
//   check    = (36 - (sum % 36)) % 36
//   expected = alphabet[check]
//
// Why we implement this rather than trusting a lib:
//   1. No existing npm dep in our tree (we're keeping the bundle tight).
//   2. The Mod-36 spec is public and short — 30 lines.
//   3. Test harness can pin exact algorithm vs. published CBIC test
//      vectors, which is how we'd want to audit a third-party lib anyway.
//
// Non-goals:
//   - We do NOT hit the GSTN API to verify the GSTIN is currently active
//     or to fetch trade name. That's a Phase E concern (requires GSTN
//     registration + credentials). Structural validity is enough for v1.
//   - We do NOT enforce PAN consistency with the legal name on the
//     invoice. A mismatched PAN is a CA's problem, not ours.

/**
 * Two-letter ISO-ish state codes for all 28 states + 8 union territories.
 * The first two characters of a GSTIN must be one of these codes.
 *
 * Source: GST Council Notification 01/2017-IT (as amended through 2024).
 * Codes 97–99 are reserved for other territories and centres; we don't
 * expect to encounter them in our invoicing flow. Code "38" was added in
 * 2020 for Dadra & Nagar Haveli + Daman & Diu post-merger.
 */
export const INDIAN_STATE_CODES = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman & Diu (pre-2020)",
  "26": "Dadra & Nagar Haveli (pre-2020)",
  "27": "Maharashtra",
  "28": "Andhra Pradesh (pre-2014)",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Dadra & Nagar Haveli and Daman & Diu",
} as const;

export type IndianStateCode = keyof typeof INDIAN_STATE_CODES;

/** Alphabet used for the Mod-36 check digit. Order matters. */
const GSTIN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Structural validation result.
 *
 * `ok: true` means structurally valid (regex + state-code + checksum).
 * `ok: false` carries a `reason` string useful for form-validation copy.
 * The positive variant always carries the extracted state.
 */
export type GstinValidation =
  | {
      ok: true;
      gstin: string;
      stateCode: IndianStateCode;
      stateName: string;
      pan: string;
      entityCode: string;
      checkDigit: string;
    }
  | {
      ok: false;
      reason:
        | "empty"
        | "wrong_length"
        | "bad_format"
        | "bad_state_code"
        | "bad_checksum"
        | "not_regular_taxpayer";
    };

/**
 * The regex on position 1-14:
 *   - \d{2}           two-digit state code (range check happens after)
 *   - [A-Z]{5}        PAN letters 1-5
 *   - \d{4}           PAN digits 6-9
 *   - [A-Z]           PAN letter 10
 *   - [0-9A-Z]        entity code (usually digit, letters reserved for future)
 *   - Z               literal 'Z' for regular taxpayers
 * Position 15 (check digit) is validated separately with Mod-36.
 */
const GSTIN_STRUCT = /^(\d{2})([A-Z]{5}\d{4}[A-Z])([0-9A-Z])(Z)([0-9A-Z])$/;

/**
 * Structural + checksum validation of a GSTIN.
 *
 * Input is case-insensitive and whitespace-tolerant (common copy-paste
 * tripping point: users paste "07 AAACI 1234A 1 Z 5" from a PDF).
 *
 * Returns a discriminated union rather than throwing so form-level
 * code can render per-reason error copy without try/catch.
 */
export function validateGstin(raw: string): GstinValidation {
  if (raw == null) return { ok: false, reason: "empty" };
  const s = String(raw).replace(/\s+/g, "").toUpperCase();
  if (s.length === 0) return { ok: false, reason: "empty" };
  if (s.length !== 15) return { ok: false, reason: "wrong_length" };

  const m = s.match(GSTIN_STRUCT);
  if (!m) return { ok: false, reason: "bad_format" };

  const stateCode = m[1] as string;
  if (!(stateCode in INDIAN_STATE_CODES)) {
    return { ok: false, reason: "bad_state_code" };
  }

  // Position 14 must be 'Z' — we don't accept OIDAR/composition shapes.
  if (m[4] !== "Z") return { ok: false, reason: "not_regular_taxpayer" };

  const expected = computeGstinCheckDigit(s.slice(0, 14));
  if (expected !== m[5]) return { ok: false, reason: "bad_checksum" };

  return {
    ok: true,
    gstin: s,
    stateCode: stateCode as IndianStateCode,
    stateName: INDIAN_STATE_CODES[stateCode as IndianStateCode],
    pan: m[2],
    entityCode: m[3],
    checkDigit: m[5],
  };
}

/**
 * Pure Mod-36 check-digit computation for the first 14 chars of a GSTIN.
 * Exported for direct testing against CBIC test vectors.
 *
 * Throws if given a string that isn't 14 chars of the expected alphabet —
 * callers should have already regex-validated.
 */
export function computeGstinCheckDigit(first14: string): string {
  if (first14.length !== 14) {
    throw new Error(`computeGstinCheckDigit expects 14 chars, got ${first14.length}`);
  }
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const ch = first14[i];
    const value = GSTIN_ALPHABET.indexOf(ch);
    if (value === -1) {
      throw new Error(`computeGstinCheckDigit: char '${ch}' not in alphabet`);
    }
    const factor = i % 2 === 0 ? 1 : 2;
    const product = value * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  const check = (36 - (sum % 36)) % 36;
  return GSTIN_ALPHABET[check];
}

/**
 * Classification of a sale for GST-split purposes.
 *
 *  - "intra_state"  — seller state === buyer state. Tax splits into CGST
 *                     (half) + SGST (half). This is the most common
 *                     domestic pattern once we register in a seller state.
 *  - "inter_state"  — seller state !== buyer state, both in India. Whole
 *                     tax is charged as IGST. Applies regardless of
 *                     whether the buyer has a GSTIN (B2C and B2B behave
 *                     the same for split purposes — the GSTIN only
 *                     changes the input-tax-credit eligibility at the
 *                     buyer's end).
 *  - "export"       — buyer is outside India. Zero-rated under Section
 *                     16 of IGST Act if the seller has filed an LUT;
 *                     otherwise export-with-IGST (and claim refund).
 *                     Our invoice prints "zero-rated export of services"
 *                     and we don't populate CGST/SGST/IGST.
 *  - "reverse_charge" — B2B Indian buyer with valid GSTIN in certain
 *                     SAC codes (998313/998314 are NOT on the RCM list
 *                     for forward-only regime — this branch exists for
 *                     completeness, but in practice our SaaS doesn't hit
 *                     it. Documented here so the admin-side view
 *                     (/admin/tax) has a non-zero bucket when it fires
 *                     — caller must opt-in via `forceReverseCharge: true`,
 *                     we never infer it.
 *
 * Default assumption when no seller state is configured yet: treat every
 * non-India buyer as "export" (zero-rated) and every India buyer as
 * "intra_state" if the buyer's state matches a seller hint env var, else
 * "inter_state". Both outcomes print the right tax fields on the invoice;
 * the mis-split only matters once Phase E wires remittance — and by then
 * we'll have a real seller GSTIN in env.
 */
export type GstClassification =
  | "intra_state"
  | "inter_state"
  | "export"
  | "reverse_charge";

export type ClassifyInput = {
  /** Buyer ISO country code (e.g., "IN", "US", "GB"). Required. */
  buyerCountry: string;
  /** Buyer state code, if India and known. Optional. */
  buyerStateCode?: IndianStateCode | null;
  /** Seller state code — where we are GSTIN-registered. Optional for pre-registration era. */
  sellerStateCode?: IndianStateCode | null;
  /** True only if the caller has checked a validated buyer GSTIN + confirmed RCM applies. */
  forceReverseCharge?: boolean;
};

/**
 * Pure classifier. No DB reads, no side effects. Caller is responsible
 * for normalising country codes upstream (trim, upper-case).
 */
export function classifyGst(input: ClassifyInput): GstClassification {
  const country = String(input.buyerCountry || "").toUpperCase();
  if (country !== "IN") return "export";
  if (input.forceReverseCharge === true) return "reverse_charge";
  if (input.buyerStateCode && input.sellerStateCode) {
    return input.buyerStateCode === input.sellerStateCode
      ? "intra_state"
      : "inter_state";
  }
  // India sale but we don't know enough to split — conservative default
  // is inter_state (treats the whole tax as IGST, no CGST/SGST line).
  // Once sellerStateCode lands in env, this branch disappears.
  return "inter_state";
}

/**
 * Human-readable tax-treatment label for the invoice footer.
 * Mirrors the TAX_MODEL.md §3 classification wording.
 */
export function describeClassification(c: GstClassification): string {
  switch (c) {
    case "intra_state":
      return "Intra-state supply — CGST + SGST at 9% each (18% total)";
    case "inter_state":
      return "Inter-state supply — IGST at 18%";
    case "export":
      return "Export of services — zero-rated under Section 16, IGST Act";
    case "reverse_charge":
      return "Reverse-charge mechanism — recipient to pay GST directly";
  }
}
