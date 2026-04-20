# pdfcraftai.com — India Tax Model (CA-ready)

_Companion to `GST_SETUP.md`. Internal planning document. Not legal or tax advice. Review with a Chartered Accountant before filing._

**Founder profile assumed:** Indian resident individual, sole proprietor (no LLP / Pvt Ltd yet), selling SaaS globally via **Razorpay (India rail)** + **Paddle (international Merchant of Record)**. Paddle is the seller-of-record outside India; Razorpay collects from Indian customers directly.

**Last updated:** 2026-04-20
**Status:** Draft v1 — awaiting CA review before any of these numbers drive a filing decision.

---

## 1. Why this document exists

Every other doc in the repo models *gross* revenue (or, at best, payment-processor net). Nothing models what actually lands in the founder's bank account after Indian income tax + GST + advance-tax + CA fees + FX drag. This doc fills that gap.

It answers three concrete questions:

1. At a given ARR, what is the **net take-home** in INR, after every compliance layer?
2. Which of the three income-tax regimes (**44ADA**, **44AD**, **regular books**) is safest at each ARR band?
3. At what ARR does the founder need to **switch regimes** or **incorporate** (LLP / Pvt Ltd)?

All figures are planning-grade ±5% and will drift with slab changes, surcharge thresholds, and CA interpretation.

---

## 2. Inputs (what drives the model)

| Variable | Value | Source / assumption |
|---|---|---|
| FX rate | $1 = ₹83 | Spot 2026-04-20; update monthly in `MARGIN_VERIFICATION.md` |
| Razorpay fee | 2.36% (2% + 18% GST) | Standard Indian card/UPI plan |
| Paddle fee | 5% + $0.50/txn | Paddle Billing tier |
| Average ticket (INR customer) | ₹1,500 | Creator pack (₹19 × 83 ≈ ₹1,577) |
| Average ticket (USD customer) | $19 | Creator pack, USD native |
| INR share of revenue | 15% (Year 1) → 25% (Year 3) | Conservative, see GEO_LAUNCH_POLICY |
| AI + infra COGS | 18-22% of gross | From `MARGIN_VERIFICATION.md` |
| Chargeback rate | <0.5% | Paddle handles disputes; impact modeled as 0.5% revenue leak |
| Currency conversion drag (Paddle → INR SWIFT) | 1-2% | Paddle USD→INR payout + bank SWIFT fee |

**What is NOT in the model** (and why):
- Equalisation levy — **does not apply**. EL 2.0 (2% on non-resident e-commerce operators) was a cross-border tax paid by *foreign* operators. Since the founder is Indian resident, EL is irrelevant.
- TCS (Tax Collected at Source) on credit card spend — applies to outbound spend, not inbound revenue.
- ESOPs, depreciation — not material at sole-prop stage.

---

## 3. The three-layer tax stack

Revenue flows through three tax layers before it becomes take-home:

```
 Gross revenue (Paddle + Razorpay settlements)
          ↓   [ Layer 1: Processor + Paddle fees ]
 Processor-net revenue  (business-level "top line")
          ↓   [ Layer 2: GST ]
          ↓     - IN-sourced sales: 18% GST collected from customer, remitted
          ↓     - Export-of-services (Paddle): zero-rated if LUT filed, else 18% on forex realised (recoverable as refund)
 GST-net revenue  (this is what the income-tax code sees as "receipts")
          ↓   [ Layer 3: Income tax ]
          ↓     - Regime 1: 44ADA presumptive (50% deemed profit on receipts up to ₹75L)
          ↓     - Regime 2: 44AD presumptive (6% deemed profit on digital receipts up to ₹3Cr)
          ↓     - Regime 3: Regular books (actual profit, unlimited scale)
          ↓     - New tax regime slabs FY 2026-27 + cess + surcharge
 Take-home  (lands in personal bank account)
          ↓   [ Operational leakages — tracked separately ]
          ↓     - FX drag 1-2%, CA fees ₹25-80k/yr, professional tax ₹2,500/yr, advance-tax timing cost
 Net realised income
```

### Layer 1 — Processor + Paddle fees

On a $100k ARR blended mix (85% Paddle / 15% Razorpay, $19 avg ticket):

| Line | Calc | USD | INR |
|---|---|---|---|
| Gross ARR | — | $100,000 | ₹83,00,000 |
| Paddle share | $85,000 gross → 5% + $0.50 × ~4,474 txn | $85,000 → net $78,513 | ₹65,16,579 |
| Razorpay share | $15,000 gross → 2.36% | $15,000 → net $14,646 | ₹12,15,618 |
| **Processor-net** | — | **$93,159** | **₹77,32,197** |

(Chargebacks modeled separately — 0.5% revenue leak, $500 / ₹41,500.)

### Layer 2 — GST (the single biggest compliance gotcha)

**IN-sourced sales (Razorpay customers):**
- 18% GST must be collected on top of list price OR absorbed out of list price.
- Since our ₹1,500 pack is *gross of GST* per ToS, actual service fee = ₹1,271; GST = ₹229 remitted to GSTIN.
- Net-to-founder per Razorpay INR ticket: ₹1,271 − 2.36% Razorpay fee = ₹1,241.
- On 15% of $100k ARR (~₹12.45L): ₹12,45,000 collected, ~₹10,55,000 flows through as taxable service income; GST ~₹2,25,000 passes through to the GSTIN account (no profit impact, but cash-flow impact between collection and monthly remittance).

**Export-of-services (Paddle customers):**
- Classified as export under Section 2(6) IGST Act: recipient abroad, payment in forex, supplier in India.
- With **LUT (Letter of Undertaking)** filed on the GST portal: **zero-rated**, no GST collected, no GST remitted, full forex lands as taxable income.
- Without LUT: 18% GST would apply on INR-equivalent, reclaimable as refund — cash-flow penalty only.
- **LUT must be filed every financial year** (before April 1 or within first return of the year). Miss it → 18% trap.
- **FIRA / FIRC certificate** (Foreign Inward Remittance Advice / Certificate) is needed from the bank receiving Paddle's SWIFT payout. Keep every FIRC — the CA will want them at year-end to substantiate zero-rated treatment.

**Net impact of Layer 2 on Paddle revenue: 0% (zero-rated). On Razorpay: 18% passthrough, no founder profit impact.**

### Layer 3 — Income tax (the one that actually eats take-home)

This is where regime choice dominates net outcome. Three options, ordered by simplicity:

#### Regime A: Section 44ADA (Presumptive, professionals)

- **Applies to:** Specified professions (engineering, IT consultancy, technical consultancy, etc.). SaaS falls here under the generous CBDT interpretation of "technical consultancy / software services" — **but this is the #1 question to confirm with your CA** (see §7).
- **How it works:** 50% of gross receipts deemed profit. No books required. No audit required.
- **Cap:** ₹75L gross receipts (FY 2026-27 limit, up from ₹50L). If >95% of receipts are digital, cap extends to ₹75L — current limit.
- **Filing:** ITR-4 Sugam. Single-page business schedule. No P&L, no balance sheet.
- **Why it's the default for Year 1:** minimal compliance, fastest cash realisation, CA fees ₹20-30k/year.

#### Regime B: Section 44AD (Presumptive, business)

- **Applies to:** General business income.
- **How it works:** 6% of digital receipts (or 8% of non-digital) deemed profit.
- **Cap:** ₹3Cr gross receipts if >95% digital; ₹2Cr otherwise.
- **Catch:** CBDT has been ambiguous whether SaaS qualifies as "business" under 44AD or must use 44ADA. Some CAs take the aggressive 44AD position; most default to 44ADA for SaaS. **Aggressive interpretation risk: ₹5-10L in back-tax + penalty if reclassified on scrutiny.**
- **Why it looks tempting:** 6% vs 50% deemed profit is a massive tax delta — but see §7 for why this is risky.

#### Regime C: Regular (books of accounts)

- **Applies to:** Always available; mandatory above presumptive caps or when founder voluntarily maintains books.
- **How it works:** Actual P&L profit is taxed. Every expense (AI APIs, Paddle fees, servers, CA, domain, laptop depreciation) deducts from gross receipts.
- **Audit trigger:** Gross receipts > ₹1Cr (₹10Cr if >95% digital + specific conditions) OR profit <6%/8% declared under presumptive-opt-out.
- **Why you'll eventually need it:** (a) ARR crosses ₹75L (44ADA cap); (b) actual profit is > 50% and 44ADA is paying tax on imaginary profit; (c) you switch to LLP / Pvt Ltd.

**New tax regime slabs (FY 2026-27, default for individuals unless they opt into old regime):**

| Slab | Rate |
|---|---|
| ₹0 – ₹3,00,000 | 0% |
| ₹3,00,001 – ₹7,00,000 | 5% |
| ₹7,00,001 – ₹10,00,000 | 10% |
| ₹10,00,001 – ₹12,00,000 | 15% |
| ₹12,00,001 – ₹15,00,000 | 20% |
| > ₹15,00,000 | 30% |

Plus **4% health & education cess** on the tax amount, plus **surcharge** (10% above ₹50L taxable, 15% above ₹1Cr, 25% above ₹2Cr). Old regime (with 80C, HRA, etc. deductions) may be better below ~₹7L net but loses above — irrelevant for a founder at SaaS scale.

**Rebate u/s 87A:** ₹25,000 if taxable income ≤ ₹7L (new regime). Zero impact at our scale.

---

## 4. Scenario table — net take-home by ARR

All scenarios assume the Inputs table (§2), 85/15 Paddle/Razorpay split, LUT filed for zero-rated Paddle revenue, new tax regime.

### $50k ARR (₹41.5L gross) — Year 1 baseline

| Layer | 44ADA | 44AD (aggressive) | Regular |
|---|---|---|---|
| Gross ARR | ₹41,50,000 | ₹41,50,000 | ₹41,50,000 |
| Less processor fees | −₹1,75,000 | −₹1,75,000 | −₹1,75,000 |
| Processor-net | ₹39,75,000 | ₹39,75,000 | ₹39,75,000 |
| Less AI + infra COGS (20%) | (not deductible in presumptive) | (not deductible) | −₹8,30,000 |
| Deemed / actual profit | ₹20,75,000 (50% of ₹41.5L gross) | ₹2,49,000 (6% of ₹41.5L) | ~₹31,45,000 |
| Income tax on profit | ₹3,22,500 | ₹0 (below basic exemption) | ₹5,68,500 |
| +Cess 4% | ₹12,900 | ₹0 | ₹22,740 |
| **Total income tax** | **₹3,35,400** | **₹0** | **₹5,91,240** |
| **Net take-home** | **₹36,39,600** | **₹39,75,000** | **₹25,23,760** |
| Effective margin | 87.7% | 95.8% | 60.8% |

At $50k ARR, **44ADA is the right default**. 44AD shows on paper as dramatically better, but (a) the ₹0 tax outcome will attract scrutiny, (b) SaaS-as-44AD is legally unsettled. Regular regime punishes you because you can't deduct "time" and you're in 20% slab on actual profit.

### $100k ARR (₹83L gross) — Year 2 target

| Layer | 44ADA | 44AD (aggressive) | Regular |
|---|---|---|---|
| Gross ARR | ₹83,00,000 | ₹83,00,000 | ₹83,00,000 |
| Over 44ADA cap? | **YES** (₹75L cap exceeded → must use 44AD or regular) | N/A | N/A |
| If artificially held at ₹75L gross: | | | |
| Deemed profit | ₹37,50,000 (50% of ₹75L) | ₹4,98,000 (6% of ₹83L) | ~₹62,90,000 |
| Income tax | ₹8,62,500 | ₹0 | ₹14,87,000 |
| +Surcharge 0-10% | ₹0 | ₹0 | ₹0 (taxable income just below ₹50L threshold → no surcharge if profit modeled correctly) |
| +Cess 4% | ₹34,500 | ₹0 | ₹59,480 |
| **Total income tax** | **₹8,97,000** | **₹0** | **₹15,46,480** |
| Net take-home (approx) | ₹74,03,000 | ₹83,00,000 | ₹67,53,520 |
| Effective margin | 89% (presumptive) | 100% (unrealistic) | 81% |

**At $100k ARR, 44ADA is no longer available.** Options:

1. **Switch to 44AD.** Tax is near-zero but the gap between 6% deemed and actual ~60% margin is so large that scrutiny likelihood is high. If IT Dept reclassifies to regular + imposes penalty: back-tax ~₹15L + 50% penalty + interest ≈ ₹22-25L hit. Not worth it.
2. **Switch to regular books.** Honest, defensible. Tax ~₹15.5L on ~₹63L actual profit. Net ₹67L.
3. **Incorporate as LLP (or Pvt Ltd).** Company pays 22% flat (new domestic rate) or 25% (if availing MAT exemption). Company profit ₹63L → tax ₹13.86L. Undistributed profits stay with the company. Dividends to founder attract additional DDT-equivalent under current regime. **Makes sense only if founder doesn't need full drawdown.**

### $250k ARR (₹2.08Cr gross) — Year 3 growth target

At this scale, 44ADA is gone, 44AD becomes legally indefensible, and the math around incorporation dominates:

| Regime | Entity | Profit modeling | Tax | Net |
|---|---|---|---|---|
| Regular | Sole prop | Actual ~₹1.52Cr profit (post-COGS) | ~₹47L (30% slab + surcharge 15% above ₹1Cr + cess) | ~₹1.05Cr |
| Regular | LLP | Actual ~₹1.52Cr profit | 30% flat + 12% surcharge above ₹1Cr + cess ≈ ₹48-50L | ~₹1.02-1.04Cr (but LLP retains profits, partner drawdown separate) |
| Regular | Pvt Ltd (new regime) | Actual ~₹1.52Cr profit | 22% flat + cess ≈ ₹34L corporate tax | ~₹1.18Cr retained OR distributed as salary/dividend (further personal tax) |

**Key insight at $250k:** Pvt Ltd under the 22% new domestic rate is the winner *if you can keep profits in the company for reinvestment*. If you need full pass-through to personal bank, LLP is simpler. Sole prop drops to #3 above ₹1Cr.

---

## 5. Multi-year projection

Planning assumption: $50k Y1 → $100k Y2 → $250k Y3 → $500k Y4. Regime transitions:

| Year | ARR | Entity | Regime | ~Effective tax rate | Decision point |
|---|---|---|---|---|---|
| Y1 (FY27) | $50k | Sole prop | 44ADA | ~14% of gross | Default. Zero risk. |
| Y2 (FY28) | $100k | Sole prop | Regular books | ~19% of gross | Must leave 44ADA (cap). Maintain books. Engage CA retainer (~₹60k/yr). |
| Y3 (FY29) | $250k | **LLP** (incorporate end of Y2) | Regular | ~23% of gross | Incorporate to ring-fence personal liability + tax rate management. |
| Y4 (FY30) | $500k | **Pvt Ltd** (convert from LLP) | 22% domestic | ~22% corporate + personal on drawdown | Conversion timed to ESOPs / funding round if any. |

**Concrete trigger events that force a regime change:**
- Gross receipts cross ₹75L → leave 44ADA immediately at year-end
- Gross receipts cross ₹1Cr with <95% digital → tax audit mandatory
- Profit declared < 6% of digital turnover under "regular" opt-out of 44AD → audit triggered
- Net worth > ₹1Cr + multiple co-founders → LLP becomes defensible
- Seeking outside investment / ESOPs → Pvt Ltd becomes mandatory
- First non-Indian hire → GST/PF/ESI complexity — revisit CA on employer-of-record strategy

---

## 6. Non-tax leakages (the "hidden" 3-5% drag)

| Leakage | Annual $ impact at $100k ARR | Mitigation |
|---|---|---|
| FX drag on Paddle USD→INR SWIFT | 1-2% ≈ $1,000-2,000 | Aggregate payouts weekly; use bank with competitive TT rate; track in `MARGIN_VERIFICATION.md` |
| Advance tax quarterly obligations (15%/45%/75%/100% cumulative) | Timing cost ~₹20-50k | Set calendar reminders for 15-Jun, 15-Sep, 15-Dec, 15-Mar |
| CA retainer + GST return filing | ₹40-80k/year | Fixed cost. Don't bargain below a competent mid-tier CA — tax savings > CA fee 10x. |
| Professional tax (state) | ₹2,500/yr (Karnataka; check state) | Annual on-portal payment |
| Chargebacks + disputes | 0.5% × revenue | Paddle handles fraud; set chargeback alert at 0.75% to take preemptive action |
| Bank account maintenance / SWIFT inbound fees | ₹5-15k/yr | Negotiate when opening current account; some banks waive for digital exporters |
| Paddle's bad-actor tax jurisdictions (edge cases) | <0.1% | Rare; noise |

**Combined drag:** 3-5% of gross, or ~$3,000-5,000 at $100k ARR. Already included in "effective margin" figures above.

---

## 7. CA confirmation checklist (take this verbatim to your CA)

Before filing the **first** return under any assumption, get a written opinion from a Chartered Accountant confirming:

**Q1. Is pdfcraftai.com's SaaS revenue classified under Section 44ADA (professional) or Section 44AD (business)?**
- Background: CBDT has no specific SAC-level ruling for productized SaaS. Some CAs treat it as "technical consultancy" (44ADA); others as "general business" (44AD).
- What you need: a position letter on file, citing the specific CBDT circular or case law your CA relies on.
- Why it matters: 44AD → 6% presumptive; 44ADA → 50% presumptive. The delta is the difference between ₹4.98L and ₹41.5L deemed profit on ₹83L gross.

**Q2. Does Paddle-intermediated revenue qualify as "export of services" under Section 2(6) IGST Act?**
- Background: Paddle is the Merchant of Record. Customer pays Paddle; Paddle pays you. From India's side, you are invoicing Paddle (UK entity) for "platform fees" or "software licensing."
- What you need: a legal opinion that your Paddle payouts are zero-rated exports when received as forex with FIRC. Confirm the specific SAC code (likely 998313 or 998314).
- Why it matters: If re-classified as domestic service, 18% GST on all Paddle revenue, cash-flow penalty ₹12-15L on $100k ARR.

**Q3. When should I incorporate (LLP vs Pvt Ltd) given the projected trajectory?**
- What you need: a decision framework tied to ARR milestones (your CA will customize). Typical answer: LLP at ₹75L-1Cr, Pvt Ltd at ₹2Cr+ or pre-funding.
- Why it matters: Incorporation cost (~₹10-20k), ongoing ROC compliance (~₹20k/yr), bank account re-setup. Doing it twice is 2× painful.

**Q4. DTAA (Double Taxation Avoidance) implications on Paddle's withholding?**
- Background: Paddle is UK-domiciled; pdfcraftai is India-domiciled. India-UK DTAA limits withholding to 10% on royalties / 0% on business income (depending on classification).
- What you need: confirmation that Paddle treats your payouts as business income (not royalties), and that TDS is NOT withheld. If it is, claim DTAA credit via Form 67 at ITR time.
- Why it matters: ~10% of gross revenue unrecoverable if mishandled.

**Q5. What should my quarterly advance-tax installments look like?**
- What you need: a year-1 schedule with projected ARR-to-quarter mapping so you don't face 234B/234C interest.
- Why it matters: Interest at 1% per month on underpayment; avoidable with any reasonable forecast.

**Q6. Am I required to register for GST as an individual, or can I wait for the ₹20L turnover threshold?**
- Background: The inter-state supply rule (s. 24 CGST Act) mandates GST registration regardless of turnover if you make inter-state supplies. Exporting to non-Indian customers is inter-state (zero-rated under export), so **registration is required from day 1**.
- What you need: confirmation + GSTIN + LUT filed.
- Why it matters: See `GST_SETUP.md`.

**Q7. Is professional tax applicable in my state? What's the enrollment process?**
- Varies by state (₹2,500/yr Karnataka; not applicable in some northern states).

---

## 8. Best case / worst case

### Best case (regime A works, all optimizations land)

$100k ARR, 44ADA applies, LUT filed, no chargebacks >0.3%, FX drag 0.8%:
- Processor-net: ₹77.3L
- Deemed profit (44ADA): ₹37.5L (on capped ₹75L)
- Income tax: ₹8.97L
- Non-tax leakages: ₹1.5L
- **Net take-home: ~₹66.8L / $80,500 (80.5% effective margin)**

### Realistic case (regime transition to regular mid-year)

$100k ARR, regular books, honest profit ~60%, 0.5% chargebacks, FX drag 1.5%:
- Processor-net: ₹77.3L
- Actual profit (post-COGS): ~₹60L
- Income tax: ~₹15L
- Non-tax leakages: ₹2L
- **Net take-home: ~₹60.3L / $72,700 (72.7% effective margin)**

### Worst case (regime B reclassified on scrutiny, penalty + interest)

$100k ARR declared under 44AD (6% presumptive), IT Dept reclassifies on 3rd-year scrutiny:
- Back-tax: ~₹15L per year × 3 years = ₹45L
- Penalty: 50-200% of tax evaded → ₹22-90L
- Interest u/s 234A/B/C: ~₹8L cumulative
- **Total liability: ₹75L-1.4Cr on a 3-year history with $300k aggregate ARR**
- **Effective margin retroactively: 0% or negative**

This is why §7 Q1 exists. 44AD looks dramatically better on paper for SaaS. It is not defensible if your CA can't cite the circular. Do not pick it without a written opinion.

---

## 9. Open items — to revisit with the CA

- [ ] Confirm 44ADA applicability to productized SaaS (Q1 above) — **blocks all Year-1 tax planning**
- [ ] File LUT on GST portal before filing the first GSTR-1 under zero-rated claim
- [ ] Open current account with a bank that gives clean FIRC (ICICI, HDFC, Axis all work; pick based on SWIFT TT rate)
- [ ] Set up Razorpay GSTIN invoicing flow (18% on top; see `GST_SETUP.md` once written)
- [ ] Decide on HSN/SAC code for SaaS invoices (998313 "IT Design & Development" vs 998314 "Hosting & IT infrastructure")
- [ ] Agree calendar for quarterly advance-tax installments (Jun 15 / Sep 15 / Dec 15 / Mar 15)
- [ ] Confirm DTAA posture with Paddle (Form 67 availability)
- [ ] Identify LLP formation threshold (ARR or non-ARR trigger) and Pvt Ltd threshold
- [ ] Professional-tax state enrollment

---

## 10. Cross-references

- `GST_SETUP.md` — GSTIN registration + LUT + HSN/SAC + monthly filing calendar (to be written)
- `docs/payments/MOR_EVALUATION.md` — Paddle vs Lemon Squeezy decision record
- `docs/GEO_LAUNCH_POLICY.md` — country allow/defer/block list that drives IN vs export revenue mix
- `docs/ai/MARGIN_VERIFICATION.md` — gross / net margin stack, will be updated with Paddle scenarios replacing PayPal
- `docs/MASTER_PLAN.md` §4 — founder-decision register (D4, D5, D11)
- `docs/PLAN_GAP_ANALYSIS.md` T2-G1 (GST gap), T2-G2 (EU VAT gap), T2-G7 (chargeback clawback)

---

## 11. Disclaimer

This model is planning-grade. It is not tax advice. The three questions that dominate the net-take-home outcome (44ADA applicability, LUT/export classification, incorporation timing) are all decisions that require a Chartered Accountant's written position before any filing. Do not treat the scenario tables as authoritative without CA sign-off.

The numbers will drift as:
- CBDT issues clarifications on SaaS presumptive eligibility
- FX rate moves (this model uses spot ₹83; each ₹1 INR appreciation shaves ~$1,000 off a $100k ARR budget)
- Slab / surcharge thresholds are revised in annual Budgets
- Paddle's fee schedule changes
- Revenue mix shifts toward or away from IN customers

Review this doc at least annually before filing, and before any ARR milestone crossing (₹75L, ₹1Cr, ₹2Cr, ₹5Cr).
