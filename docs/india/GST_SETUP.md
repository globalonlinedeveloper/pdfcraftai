# pdfcraftai.com — GST Setup & Compliance Playbook

_Companion to `TAX_MODEL.md`. Operational runbook for GST registration, LUT, invoicing, and monthly filings for an Indian sole-prop SaaS exporting globally via Razorpay + Paddle._

**Last updated:** 2026-04-20
**Status:** Draft v1 — awaiting CA sign-off on HSN/SAC code and export-of-services classification before any step 2+ action.
**Not legal or tax advice.** Every action below should be vetted by a CA at least once.

---

## 1. Why GST applies from day one (yes, even as an individual, even below ₹20L)

The founder profile is: Indian resident individual, no registered company, selling a SaaS globally. Instinct says "I'll register when revenue hits ₹20L." **That instinct is wrong for our business.**

**The inter-state supply rule, Section 24(i) CGST Act**, makes GST registration **compulsory** — regardless of turnover threshold — for any person making *inter-state* taxable supplies.

"Inter-state" here includes the **export of services** (treated under IGST). A Delhi-based founder selling to a customer in Mumbai is inter-state. A Delhi-based founder selling to a customer in California is also inter-state (specifically, zero-rated under export). Either way — the ₹20L threshold doesn't apply.

Additional confirming reasons:

1. **Razorpay requires GSTIN** to process payments under its standard contract above ~₹2L/month volume. Without GSTIN, Razorpay flags the merchant for KYC escalation.
2. **OIDAR services classification** — "Online Information Database Access and Retrieval" — per the 2017 notifications + 2021 amendments, SaaS qualifies as OIDAR, and OIDAR supply to Indian consumers requires GSTIN from the supplier.
3. **Paddle's MoR flow still needs a clean Indian invoicing trail.** Paddle collects globally; Paddle pays us in USD via SWIFT. For Paddle to issue a valid payment, it needs our business identity — which in India means PAN at minimum, GSTIN strongly preferred, and required for the zero-rated export claim.

**Net effect: register for GST before the first ₹1 hits the bank account.**

---

## 2. Who you register as

As a sole proprietor individual, GST registration is under your **PAN** (no separate company PAN).

- **Legal name:** as per PAN
- **Trade name:** `pdfcraftai` or `pdfcraftai.com` (whatever you want to appear on invoices)
- **Constitution:** Proprietorship
- **PAN:** personal PAN
- **Email / phone:** founder personal (will receive OTP at filing time — do NOT use a shared team inbox)
- **Aadhaar:** link for e-KYC (skips physical verification)

You get **one GSTIN per state** (15-character PAN-linked identifier). If you move states, re-register.

---

## 3. Registration walk-through (what actually happens on gst.gov.in)

### Step 1 — Part A (creates TRN)

1. Go to https://www.gst.gov.in → Services → Registration → New Registration
2. Select "Taxpayer", pick state/district (your residence state), enter legal name as per PAN, PAN, email, mobile. OTP to both.
3. Receive **Temporary Reference Number (TRN)**. Valid 15 days.

### Step 2 — Part B (the actual application, GST REG-01)

Under TRN login, fill the following tabs. Rough times given are for a first-time filer.

| Tab | What to enter | Time |
|---|---|---|
| Business details | Trade name `pdfcraftai`; constitution "Proprietorship"; registration reason "Compulsory registration (inter-state supply)" | 10 min |
| Promoters/Partners | You (photo, Aadhaar, PAN, mobile). Sole prop = only one entry. | 15 min |
| Authorized signatory | Same as promoter. Tick "same as above." | 5 min |
| Principal place of business | Home address OR co-working address. Need proof: electricity bill or rent agreement + NOC from owner if rented. | 15 min |
| Goods and services | Add **service** rows: HSN/SAC 998313 (IT Design & Development) and/or 998314 (Hosting & IT Infrastructure Provisioning). **Confirm with CA** which is correct for your invoice narrative — pdfcraftai is closer to 998313 ("custom software services"). See §5. | 5 min |
| Bank details | Current account (will upgrade to this in parallel), IFSC, cancelled cheque / bank statement | 10 min |
| Aadhaar authentication | e-KYC via OTP. **Pick this path** — skips physical verification. | 2 min |
| Verification + submit | Sign with DSC (if enrolled) or EVC (OTP). EVC is fine for individual. | 5 min |

**Total: ~1-1.5 hours of focused work, once all documents are gathered.**

### Step 3 — ARN + approval

- You get an **Application Reference Number (ARN)** immediately on submission.
- With Aadhaar e-KYC: approval typically in **2-7 working days**, sometimes same-day.
- Without Aadhaar e-KYC: physical verification by officer, 15-30 days.
- Approval arrives as **GSTIN** (15 chars: `NNAAAAAANNNAAAN`, where `NN` is state code + `AAAAA NNNN` is PAN + `A` is entity code + `N` is check digit + `A` is the 14th char, `Z` hardcoded + last is checksum).

### Step 4 — Download and preserve

- GST registration certificate (Form GST REG-06) — displayable / printable.
- **Save this as** `/docs/india/artifacts/gst-reg-06-<date>.pdf` in the repo? **No — CONTAINS PAN.** Keep locally + in password-protected cloud storage only. Repo has `.gitignore` rules already covering `.claude/`; consider adding `docs/india/artifacts/`.

---

## 4. LUT (Letter of Undertaking) — the second day-zero step

Without LUT, every export-of-service invoice (i.e., every Paddle payout back to you) triggers **18% IGST** at the time of supply, which is refundable later but is a cash-flow penalty of ~₹12-15L on $100k ARR.

With LUT, exports are **zero-rated**: no GST collected, no GST remitted, full forex proceeds are taxable income only.

### How to file

1. Login to GST portal → Services → User Services → Furnish Letter of Undertaking (LUT) → select FY (e.g., 2026-27)
2. Form GST RFD-11 auto-populated with business info; select "I undertake" checkboxes
3. Add two witnesses (name, occupation, address — typically friends or family; they do not sign anything physical)
4. Verify with DSC or EVC
5. Receive **LUT number**. Valid for **one financial year**.

### LUT must be renewed every FY

- New FY starts April 1.
- File fresh LUT **before the first export invoice of the new FY**, or at latest in the first GSTR-1 of the year.
- **Calendar reminder: file LUT on April 1-5 every year.** Missing it means you're bound to pay IGST on every export and reclaim it — a month-level cash-flow hit and CA-fee hassle.

### What if you miss LUT

- Each export-of-service invoice must carry IGST at 18% computed on INR-equivalent of forex realised
- Paddle does NOT collect this — you pay it out of pocket and claim refund
- Refund via Form GST RFD-01, typical turnaround 30-90 days
- Net: cash-flow penalty, not permanent

---

## 5. HSN / SAC codes — the one decision that matters on every invoice

Two candidate codes for SaaS. **Confirm with CA — do NOT guess.**

| Code | Description | When to use |
|---|---|---|
| **998313** | Information technology (IT) design and development services | Custom software / bespoke development + any SaaS with configuration complexity. This is most CAs' default for SaaS. |
| **998314** | Hosting and information technology (IT) infrastructure provisioning services | Pure hosting / infrastructure-as-a-service (AWS-like). Probably too narrow for pdfcraftai. |
| **998319** | Other information technology services n.e.c. | Catchall. CA may use this if 998313/998314 don't fit cleanly. |

**Default pick pending CA confirmation: 998313.** Our product provides application-level services (PDF manipulation, AI pipelines), not raw hosting. Every Razorpay + Paddle invoice generated should carry 998313 unless CA advises otherwise.

**Why this matters:**

- HSN/SAC determines reporting category on GSTR-1 and GSTR-3B.
- Mismatched codes across months trigger auto-reconciliation mismatches on the GST portal.
- For OIDAR (cross-border B2C under POS rules), certain codes map differently — ask CA if Paddle's MoR role changes the POS analysis.

---

## 6. Invoicing flow — what each invoice looks like

### INR customers (via Razorpay) — B2C OIDAR / B2B

Two cases depending on customer type. Since we don't collect GSTINs at checkout today, default to B2C.

**Standard B2C tax invoice structure:**

```
pdfcraftai                              Invoice #: PCAI-2026-000042
[Full address]                          Date:       2026-05-04
GSTIN: <your-GSTIN>                     Place of supply: Karnataka (customer state)
PAN:   <your-PAN>
                                       ─────────────────────────────
Bill to: Customer name
         Customer email
         Customer GSTIN (if provided at checkout — future feature)

 SAC  Description                Qty   Unit ₹   Amount ₹
 998313  Creator credit pack       1   1,271    1,271
                                               ─────────
                          Sub-total:           1,271
                          CGST 9%:               114
                          SGST 9%:               114  (if customer same state as you)
                          IGST 18%:              -    (if customer other state)
                                               ─────────
                          Grand total:         1,500

 Words: Rupees one thousand five hundred only.
 Digital signature: <optional DSC; EVC sufficient for sole prop>
```

**Key rules:**
- If customer state = your state → CGST + SGST 9% each (intra-state)
- If customer state ≠ your state → IGST 18% (inter-state)
- **Place of Supply (POS)** rule for OIDAR: recipient's location. So if you're in Karnataka and customer is in Mumbai → POS = Maharashtra → IGST.
- Invoice must be generated within **30 days** of service supply (we'll issue at checkout, so same day).

### USD customers (via Paddle) — export of services

```
pdfcraftai                              Invoice #: PCAI-EXP-2026-000113
[Full address]                          Date:      2026-05-04
GSTIN: <your-GSTIN>                     Place of supply: Outside India
LUT #: <active LUT reference>           Currency:  USD (converted ₹ at RBI ref rate)

Bill to: Paddle.com Market Ltd
         [Paddle UK address]

 SAC     Description                       USD      INR (at spot)
 998313  Platform services / usage fees    78,512   65,16,579
                                           ─────    ─────────
                 Sub-total:                78,512   65,16,579
                 IGST 18%:                    0.00      —     (zero-rated under LUT)
                 Grand total:              78,512   65,16,579

 Supply qualifies as export of services under Section 2(6) IGST Act.
 Payment received via SWIFT; FIRC reference: <to be updated on receipt>
 Digital signature: ...
```

**Frequency:** Typically **one Paddle invoice per payout cycle** (Paddle pays net-of-fees on its schedule — weekly or bi-weekly). Not one invoice per end-customer transaction. Paddle's portal provides the aggregated statement; your invoice is TO Paddle for the aggregated period.

**FIRC attachment:** Obtain FIRC (Foreign Inward Remittance Certificate) from your AD (Authorized Dealer) bank for every Paddle SWIFT credit. Match each FIRC to its corresponding invoice. Keep in a dedicated folder.

---

## 7. Monthly filing calendar

Once registered, three returns per month (as QRMP taxpayer, by default if eligible, filings reduce to quarterly for some):

| Return | Purpose | Due date | What to file |
|---|---|---|---|
| **GSTR-1** | Outward supplies (invoices you issued) | 11th of next month | B2B invoices individually, B2C consolidated, export-of-service invoices with LUT tag |
| **GSTR-3B** | Summary return + tax payment | 20th of next month | Tax liability summary, ITC claimed, tax paid |
| **GSTR-2A / 2B** | Auto-populated inward supplies (purchases) | Read-only | Match against your purchase records; reconcile before GSTR-3B |

**QRMP (Quarterly Returns, Monthly Payment)** option — if turnover <₹5Cr, file GSTR-1 + GSTR-3B quarterly but pay tax monthly via PMT-06 challan. Reduces filing burden from 24 returns/yr to 12. **Opt into QRMP when registering.**

### Annual returns

- **GSTR-9** — Annual return, due 31 December of next FY. Mandatory if turnover >₹2Cr.
- **GSTR-9C** — Reconciliation statement, due with GSTR-9. Required if turnover >₹5Cr.
- Below ₹2Cr → GSTR-9 optional but recommended.

---

## 8. What you pay, what you pass through

The practical split of every rupee that hits your Razorpay / Paddle account:

```
                         ┌─────────────────────────────────┐
                         │ Razorpay payout (INR customers) │
                         └────────────┬────────────────────┘
                                      │
  Customer pays ₹1,500 (GST-inclusive, ToS stipulates)
                                      │
                                      ├─ ₹1,271 service fee       → taxable as business receipts
                                      ├─ ₹229 GST @ 18%            → flows to GSTIN, remitted monthly
                                      └─ ₹35 Razorpay fee           → settles from the ₹1,271 on Razorpay side
                                      
                         ┌─────────────────────────────────┐
                         │ Paddle payout (USD customers)   │
                         └────────────┬────────────────────┘
                                      │
  Customer pays $19 to Paddle (Paddle collects VAT/sales-tax globally, settles net to us)
                                      │
                                      ├─ Paddle remits VAT/GST in each jurisdiction (not our problem)
                                      ├─ Paddle fee: 5% + $0.50 → deducted at source
                                      └─ Net ~$17.50 arrives as SWIFT credit → zero-rated under LUT, full amount taxable as export business receipts
```

**Rupee-level implications:**

- The 18% GST on Razorpay sales is **not our profit** — it's a passthrough liability. Treat the GST portion as a separate liability line, don't mix with operating cash.
- Open a separate savings account **labelled "GST float"**. Move the 18% GST out of the operating account the day Razorpay settles. Pay from the float every 20th.
- The Paddle payout is clean (zero-rated) — no GST split, full amount is income.
- Keep a **reconciliation spreadsheet** that maps every Razorpay / Paddle settlement row to an invoice number and a bank credit date.

---

## 9. Reverse charge mechanism (RCM) — rare but check

If you pay for services from a non-Indian supplier (e.g., OpenAI API charges billed to you, Paddle fees treated as "service from UK"), RCM applies: you pay 18% GST **to the government on the import of services**, but you also claim it back as ITC (Input Tax Credit). Net zero, but must be disclosed.

- OpenAI / Anthropic / Google AI API charges: RCM applies, 18% on invoice amount
- AWS, Cloudflare, Vercel: RCM applies
- GitHub, Notion, Figma: RCM applies
- Domain registrar (if non-Indian): RCM applies

**CA will handle this at year-end reconciliation.** Key action on your side: keep every foreign-supplier invoice in a single folder for your CA.

---

## 10. Compliance artefacts — what your CA will ask for at each year-end

- [ ] GST registration certificate (REG-06)
- [ ] LUT certificate (current FY)
- [ ] All outward invoices (Razorpay + Paddle)
- [ ] All inward invoices (foreign and domestic suppliers) — for ITC claim
- [ ] Bank statements for operating account + GST float account
- [ ] All FIRCs from AD bank for Paddle SWIFT credits
- [ ] Paddle monthly statements (downloadable from vendor.paddle.com)
- [ ] Razorpay monthly statements (dashboard.razorpay.com → Settlements → Export)
- [ ] Advance tax payment receipts (quarterly)
- [ ] TDS certificates (if any; e.g., if you pay >₹30k/yr to a freelancer)

**Retention period:** 6 years from the end of the relevant FY (GST law).

---

## 11. Edge cases and gotchas

### 11.1 INR customer with GSTIN (B2B intra-India)

Customer who provides GSTIN at checkout is B2B. Invoice must carry customer GSTIN + tax split (CGST/SGST if same state, IGST otherwise). Customer can claim ITC on your invoice.

**Product TODO:** add optional "GSTIN" field at Razorpay checkout page. Not a day-1 blocker.

### 11.2 Refunds

If you refund an INR customer, you **reverse the GST** on the original invoice via a credit note (CDNR row in GSTR-1). The credit note must reference the original invoice number. Refund must happen within **the same FY** — cross-FY refunds trigger a reclaim procedure that can delay refund by 60-90 days.

**Paddle-handled refunds**: Paddle handles the refund to the end customer; Paddle then deducts that amount from your next payout. No GST reversal needed on your side (export-of-service was zero-rated to begin with).

### 11.3 Chargebacks

Same mechanics as refunds on the INR side. On the Paddle side, chargeback fee ($20) is a deductible business expense but **not GST-relevant** (foreign-dispute fee).

### 11.4 Foreign exchange fluctuation

Paddle settles in USD; you receive INR. The INR received is "gross receipts" for GST purposes — not the USD invoice amount. Use the RBI reference rate on the date of credit for the conversion in invoice + return.

### 11.5 Different state per FY

If you move residence state mid-year: cancel old GSTIN, register fresh in new state. Messy. Avoid if possible.

---

## 12. Registration artefact checklist (before you start Part A)

- [ ] PAN (physical + PDF)
- [ ] Aadhaar (linked to PAN, mobile active)
- [ ] Passport-size photo (for Part B)
- [ ] Address proof for principal place of business: electricity bill (latest, <3 months) OR rent agreement + owner NOC
- [ ] Bank statement or cancelled cheque for intended business account
- [ ] Email + mobile (both with active OTP access)
- [ ] DSC (optional — EVC sufficient for sole prop)
- [ ] Two witnesses for LUT (after registration)

---

## 13. Sequencing with the rest of Phase 0

Rough recommended order:

1. **Week 1** — register for GST (this doc)
2. **Week 1** — file LUT immediately after GSTIN received
3. **Week 2** — open business current account; get first FIRC-capable bank relationship
4. **Week 2** — set up Razorpay KYC using GSTIN; enable production credentials
5. **Week 3** — set up Paddle Billing sandbox (see `docs/payments/MOR_EVALUATION.md`)
6. **Week 3** — CA consult: walk them through this doc + TAX_MODEL.md, get written opinions on Q1-Q7 in TAX_MODEL.md §7
7. **Week 4** — CA-ratified invoice template in pdfcraftai codebase (SAC, CGST/SGST/IGST logic, LUT reference block)
8. **Week 4** — GST float account + reconciliation sheet live
9. **Week 5** — Phase 0 launch: start accepting payments

---

## 14. Open items — to confirm with CA before any filing

- [ ] SAC code: 998313 vs 998314 vs 998319
- [ ] Paddle revenue classification (export of services under s. 2(6) IGST Act)
- [ ] QRMP opt-in at registration
- [ ] RCM handling of foreign supplier invoices
- [ ] GSTIN capture at checkout for B2B Indian customers
- [ ] Refund + credit-note workflow within-FY vs cross-FY
- [ ] DSC vs EVC for monthly return filing (EVC is simpler; DSC is mandatory for company, not sole prop)
- [ ] Composition scheme eligibility (for service providers, turnover <₹50L, flat 6% — we don't want this because ITC blocked, but confirm exclusion)

---

## 15. Cross-references

- `TAX_MODEL.md` — income tax stack, regime comparison, net take-home projections
- `docs/payments/MOR_EVALUATION.md` — Paddle vs Lemon Squeezy, MoR rationale
- `docs/GEO_LAUNCH_POLICY.md` — customer geography mix, which drives IN vs export revenue split
- `docs/ai/MARGIN_VERIFICATION.md` — blended margin math that consumes these tax assumptions
- `docs/MASTER_PLAN.md` §4 D5 — BYOK-vs-managed decision, which affects gross margin and thus tax exposure
- `docs/PLAN_GAP_ANALYSIS.md` T2-G1 (GST gap — this doc closes it), T2-G2 (EU VAT — Paddle handles)

---

## 16. Disclaimer

This is an operational planning document. All decision points marked "**confirm with CA**" are genuine — do not act on this doc alone. GST law changes materially every 6-12 months via CBIC circulars; this doc is frozen at 2026-04-20 and must be re-reviewed at every FY boundary.
