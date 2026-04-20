# pdfcraftai.com — Merchant-of-Record (MoR) Evaluation

_Decision record: why Paddle was selected over Lemon Squeezy, FastSpring, Gumroad, Paypro Global, and direct Stripe/PayPal for the international revenue rail._

**Decision:** **Paddle Billing** as MoR for all non-IN revenue, paired with **Razorpay** on the IN rail.
**Decided:** 2026-04-20
**Owner:** founder + CA (CA sign-off on Paddle export-of-services posture still open)
**Status:** Draft v1 — architecture decision committed; sandbox validation pending.

---

## 1. Why an MoR at all (and not direct Stripe + PayPal)

Initial plan was `Razorpay + PayPal` direct. That plan has three structural problems that became visible during gap analysis:

1. **Global tax compliance is non-trivial.** EU-MOSS VAT, UK VAT, US sales-tax nexus (50-state sprawl, Wayfair economic-nexus thresholds), Australia GST on digital imports, Canada GST/HST/QST, Japan consumption tax, and India GST on OIDAR all apply to a globally-available SaaS. Handling each correctly from an Indian sole prop is impossible without a professional tax handler — and even *with* one, the per-jurisdiction registration fees and ongoing filings consume 10-30% of revenue and multiple man-days per month.
2. **Chargeback / fraud exposure** scales linearly with unprotected card processing. Stripe Radar helps but doesn't shift the legal buck; chargeback fees hit your account directly.
3. **EU compliance (SCA, GDPR data-processor status, PSD2)** burdens grow with EU customer count. Cloudflare geo-block is a workaround but caps addressable market.

An MoR is a reseller: it becomes the **seller of record** for every transaction. Tax liability, chargeback disputes, fraud screening, currency conversion, and invoice generation all shift to the MoR. The founder is paid a net settlement in USD (or INR via SWIFT) as if they were a supplier to the MoR.

**The trade-off:** MoR fees are 5-8% vs direct processing's 2.5-3.5%. You pay 2-5 extra percentage points to buy out ~15% of your time and ~70% of your cross-border risk.

**At Phase 0 with one founder and no dedicated finance function, an MoR is the right call.**

---

## 2. Candidates evaluated

### 2.1 Paddle Billing

- **Fee structure:** 5% + $0.50/successful txn. No monthly minimum. No annual contract.
- **Founder-side payout:** USD via SWIFT, bi-weekly (every 2 weeks) default; weekly on request.
- **India payout reliability:** Confirmed supported. Paddle operates a UK-based entity (Paddle.com Market Ltd) and routes payouts to Indian bank accounts via SWIFT. Some founders report intermittent delays from Paddle's side, but no blocker.
- **Jurisdictions covered:** 200+ countries. EU VAT / UK VAT / US sales tax / Canada GST/HST/QST / Australia GST / Japan consumption tax / India GST on digital — all handled automatically. Paddle is registered in each.
- **Checkout UX:** Hosted (Paddle-branded URL) or fully in-line (overlay). Modern, SCA-compliant, mobile-friendly.
- **Subscriptions:** First-class. Monthly / annual / usage-based / pack upgrades. Proration, upgrades, downgrades, dunning, grace periods — all supported.
- **One-time purchases (credit packs):** Supported via "one-time" product type.
- **API maturity:** Solid REST API + webhooks. Inngest/background-worker friendly. Documentation is excellent.
- **KYC:** Business verification required. Founder identity + proof of domain ownership + tax identifier (PAN works). Typical onboarding 2-7 days.
- **Refund handling:** Paddle auto-refunds within N days (configurable); refunds deduct from next payout.
- **Chargeback handling:** Paddle acts as first-line defender. Chargeback fee: ~$20 (depends on card brand/region); Paddle shoulders dispute admin, you just provide evidence.
- **Downside:** 5% + $0.50 is the ceiling for non-enterprise tiers. On a $19 Creator pack, fee = $1.45 (7.6% effective). On a $5 Starter pack, fee = $0.75 (15% effective). Starter pack margin suffers.
- **Hidden caveat:** Paddle reserves right to reject high-risk merchants (adult, gambling, crypto, certain AI categories). pdfcraftai is clearly fine.

### 2.2 Lemon Squeezy

- **Fee structure:** 5% + $0.50/txn (identical to Paddle). Owned by Stripe (acquired 2024).
- **Founder-side payout:** USD via Stripe Connect (since it's Stripe-owned) OR direct bank transfer in select regions.
- **India payout:** **Historically flaky.** Stripe India has restrictions on cross-border payouts for non-India-incorporated entities. Some founders report 1-2 week delays, and payouts via Payoneer are the most reliable route — but Payoneer adds ~1-2% conversion drag on top of LemonSqueezy's 5%.
- **Jurisdictions covered:** EU VAT, UK VAT, US sales tax, Canada. **No direct handling of India GST on OIDAR** — treated as customer's problem (same as Paddle does). ⚠️ **Coverage is narrower than Paddle.**
- **Checkout UX:** Very polished, Indie-hacker favourite. Hosted-only (no inline overlay yet, though promised in roadmap).
- **Subscriptions:** Yes, but **less mature than Paddle**: no usage-based billing as of 2026-04 launch; pack upgrades rely on manual workarounds.
- **One-time purchases:** Supported, excellent.
- **API maturity:** Good, simpler than Paddle. Webhooks clean.
- **KYC:** Lighter than Paddle; faster onboarding (1-3 days).
- **Refund handling:** Admin dashboard, deducted from payout balance.
- **Chargeback handling:** ~$15 fee, Stripe-backed dispute process.
- **Downside:** (a) India payout reliability, (b) subscription feature gap, (c) smaller customer base means occasional "new provider" friction with compliance teams.
- **Upside over Paddle:** cleaner DX, simpler API, faster onboarding.

### 2.3 FastSpring

- **Fee structure:** 5.9% + $0.95/txn. **The most expensive of the MoR cohort.**
- **Founder-side payout:** Wire, PayPal, Payoneer; India via Payoneer.
- **Jurisdictions covered:** 200+ countries. Mature enterprise posture.
- **Checkout UX:** Feels dated. Their "modern" checkout is still older than Paddle's.
- **Subscriptions:** Yes, very mature (been doing this since 2005).
- **API maturity:** Mature but heavier learning curve.
- **Verdict:** FastSpring is the right pick if you're >$5M ARR enterprise SaaS. At our scale, the fee delta burns 1% of gross that Paddle/Lemon don't. **Skip.**

### 2.4 Gumroad

- **Fee structure:** 10% total (all-in, no per-txn). **Brutal for higher ARR** — but simple.
- **Founder-side payout:** PayPal or Stripe; India via Payoneer.
- **Jurisdictions covered:** Limited — creator-oriented, not enterprise SaaS. EU VAT handled; US sales-tax handled; others are patchy.
- **Subscriptions:** Basic.
- **Verdict:** Gumroad is the right pick for a $2 digital download (e-book, one-shot asset). **Not for a SaaS with credit packs, subscriptions, and $150 pricing.** 10% total is too steep. **Skip.**

### 2.5 Paypro Global

- **Fee structure:** 4.9% + $0.50/txn for credit cards; different for local methods.
- **Founder-side payout:** Wire (USD), India supported.
- **Jurisdictions covered:** 200+ countries. Strong in Eastern Europe.
- **Checkout UX:** Passable. Less polished than Paddle.
- **Subscriptions:** Yes, mature.
- **Verdict:** Competitive with Paddle on fees. **Less mature ecosystem; smaller docs base, fewer third-party integrations.** If Paddle onboarding fails for some reason, this is the backup.

### 2.6 DodoPayments

- **Fee structure:** 2.9% + $0.30/txn. Lower than others because it's newer / competing.
- **India angle:** **Founded by Indian team, native INR support.**
- **Jurisdictions covered:** Claims 190+ countries, but **maturity is limited**. Some compliance coverage is "handled via third party" which introduces supplier risk.
- **Subscriptions:** Yes.
- **Verdict:** Watch-list candidate. **Not mature enough for production pdfcraftai at Phase 0.** Revisit in 6-12 months.

### 2.7 Chargebee (as MoR via Chargebee Retention or Checkout)

- Chargebee is primarily a **subscription-management layer** on top of Stripe / PayPal — not a true MoR unless using their "Compliance-as-a-Service" add-on.
- **Verdict:** Overkill for Phase 0. Revisit when we have complex subscription tiers (Year 2+).

---

## 3. Evaluation matrix

Weighted scoring. Each dimension 1-5 (higher is better for founder); then weighted.

| Dimension | Weight | Paddle | Lemon Squeezy | FastSpring | Paypro Global |
|---|---|---|---|---|---|
| India payout reliability | 20% | 5 | 2 | 4 | 4 |
| Tax jurisdiction coverage | 15% | 5 | 4 | 5 | 5 |
| Fee economics at our mix | 15% | 4 | 4 | 2 | 4 |
| Subscription + pack feature maturity | 15% | 5 | 3 | 5 | 4 |
| API / webhook quality | 10% | 5 | 5 | 3 | 3 |
| Chargeback + fraud handling | 10% | 5 | 4 | 5 | 4 |
| KYC + onboarding time | 5% | 3 | 4 | 3 | 3 |
| Documentation + community | 5% | 5 | 5 | 3 | 2 |
| Downside risk (volatility / acquired / policy changes) | 5% | 4 | 3 (owned by Stripe, flux) | 4 | 3 |
| **Weighted score** | 100% | **4.65** | **3.45** | **4.15** | **3.95** |

Paddle wins on India payout reliability and subscription maturity — the two dimensions that matter most at Phase 0.

---

## 4. Why Paddle over Lemon Squeezy specifically

Lemon Squeezy has the better DX; its checkout is arguably more polished; its API is simpler. But the **India payout problem is unresolved at the provider level as of 2026-04**.

Specifically: Lemon Squeezy payouts to Indian merchants route through Stripe Connect, and Stripe India has a **carve-out for non-Indian-incorporated merchants** that forces the payout through Payoneer. Payoneer adds 1-2% conversion drag + 2-5 day SWIFT delay + occasional hold for "compliance review." This is unacceptable at a founder-cash-flow level — our operating account is the founder's personal account; a 10-day hold on a $5,000 payout mid-month is a real-world pain point.

Paddle, by contrast, has a UK entity that invoices the end customer, holds funds, and SWIFT-transfers the net to the Indian founder account directly. No intermediary, no Stripe Connect complication, no Payoneer. India-founder users report reliable fortnightly payouts with FIRC issuance by the receiving bank.

**The 5% is the same. The payout reliability is not. Paddle wins.**

### If Paddle onboarding fails

**Plan B: Paypro Global.** Fee parity, similar feature set, India payout supported. Less polished, but functional.
**Plan C: Lemon Squeezy with Payoneer payout.** Accept the 1-2% drag + delay as cost of business. Revisit when ARR justifies migration effort.

---

## 5. Architecture in pdfcraftai's codebase

```
┌──────────────────────────────────────────────────────────────┐
│                     checkout router (app layer)              │
│  if user.country === 'IN':  → Razorpay path                  │
│  else:                      → Paddle path                    │
└────────────────────────┬────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          │                              │
    Razorpay adapter              Paddle adapter
    (lib/payments/razorpay/*)     (lib/payments/paddle/*)
          │                              │
    webhook handler                 webhook handler
    (payment.captured,              (transaction.completed,
     refund.processed,              subscription.updated,
     chargeback.disputed)           refund.issued,
          │                          dispute.*)
          │                              │
          └──────────────┬───────────────┘
                         │
              ┌──────────▼──────────┐
              │  unified ledger     │
              │  (credits, history, │
              │   reconciliation)   │
              └─────────────────────┘
```

**Both rails write to a common credit-ledger domain**, so downstream AI tools / dashboards don't need to know which MoR processed the purchase.

**Current plan:** `lib/payments/paddle/` is a new module to build in Phase 1 (Task #80 will expand to cover Paddle adapter). The existing Razorpay adapter scaffolding in `docs/payments/PAYMENT_GATEWAY_PLAN.md` stays unchanged.

---

## 6. Sandbox validation plan (before production cutover)

Before committing real revenue through Paddle, validate end-to-end in sandbox. **Budget: 4 hours.**

### Sandbox checklist

- [ ] Create Paddle sandbox account (vendor.paddle.com/signup, select "Sandbox")
- [ ] Configure product: "Creator credits" $19 one-time + "Pro subscription" $59/mo
- [ ] Test webhook endpoint: `POST /api/payments/paddle/webhook` with HMAC verification
- [ ] Test transactions: US card, UK card, DE card (VAT), CA card, AU card, JP card — each should show correct tax computation
- [ ] Test refund flow: refund a sandbox transaction, verify webhook fires, verify credit-ledger debits correctly
- [ ] Test subscription lifecycle: create → upgrade → downgrade → cancel, each webhook event should process idempotently
- [ ] Test dispute simulation: Paddle sandbox supports synthetic chargebacks
- [ ] Measure: latency from checkout-complete to credits-in-account (target <5s)
- [ ] Validate: SWIFT payout format Paddle uses (needed for bank reconciliation spreadsheet template)

### Production cutover gate

Production KYC + live credentials only proceed when:
- Sandbox checklist 100% green
- CA confirms export-of-services classification for Paddle revenue (TAX_MODEL.md Q2)
- GST LUT filed
- Bank AD account open and FIRC-capable
- Webhook HMAC signature verification test passes in staging

---

## 7. Integration scope (what changes in the codebase)

New files to create in Phase 1 (task #80 expanded scope):

| File | Purpose |
|---|---|
| `lib/payments/paddle/client.ts` | Paddle API wrapper (SDK + raw fetch fallback) |
| `lib/payments/paddle/webhook.ts` | HMAC verification + event dispatcher |
| `lib/payments/paddle/types.ts` | TypeScript types for Paddle transaction / subscription / dispute |
| `app/api/payments/paddle/webhook/route.ts` | Next.js API route; verifies and processes webhooks |
| `app/api/payments/paddle/checkout/route.ts` | Creates Paddle checkout session for a SKU |
| `lib/payments/router.ts` | Geography-aware routing: IN → Razorpay, else → Paddle |
| `lib/credits/reconcile.ts` | Unified reconciliation across both rails |

Env vars to add (Hostinger):
- `PADDLE_API_KEY` (sandbox + production)
- `PADDLE_WEBHOOK_SECRET`
- `PADDLE_VENDOR_ID`
- `PADDLE_ENVIRONMENT` = `sandbox` | `production`

---

## 8. Risks and unknowns

| Risk | Severity | Mitigation |
|---|---|---|
| Paddle rejects KYC (unusual for legitimate SaaS but possible) | Medium | Plan B Paypro Global ready; allow 2-week contingency before Phase 1 launch |
| Paddle changes fee structure (has happened once before — 2023 fee hike) | Medium | Contract lock-in is flexible; monitor quarterly, re-evaluate annually |
| Paddle payout delay (multi-day) during quarter-end volume spikes | Low | Keep 3-month operating runway in bank; don't depend on payout timing for AI API pay-as-you-go |
| Paddle-handled VAT/GST computed incorrectly (rare) | Low | Invoice audit quarterly; if discovered, Paddle indemnifies under their MoR terms |
| CA disagrees with export-of-services posture for Paddle revenue | High | Don't ship production until CA gives written opinion; if CA disagrees, revisit (may need LLP + different GST structure) |
| Paddle acquired / discontinues India payouts | Medium | Quarterly check on alternatives; Plan C Lemon Squeezy+Payoneer always available |

---

## 9. Review cadence

- Quarterly: fee + feature parity scan against Lemon Squeezy + Paypro Global + any new entrants
- Annually: full MoR re-evaluation at FY close (April)
- On any 10%+ fee change: immediate re-eval
- On any India payout regression: immediate re-eval + Plan B activation plan

---

## 10. Cross-references

- `TAX_MODEL.md` §2 — Paddle fee assumptions that drive income calculations
- `TAX_MODEL.md` Q2 — export-of-services classification for Paddle revenue (CA question)
- `GST_SETUP.md` §6 — Paddle invoice template
- `PAYMENT_GATEWAY_PLAN.md` — original Razorpay-only plan (this doc supersedes the international half)
- `docs/MASTER_PLAN.md` §4 D4 — payment stack decision, now resolved in favor of Razorpay + Paddle
- `docs/PLAN_GAP_ANALYSIS.md` T2-G2 — EU VAT compliance (closed by Paddle MoR)
- `docs/PLAN_GAP_ANALYSIS.md` T2-G7 — chargeback clawback (mitigated by Paddle dispute handling)

---

## 11. Decision log

| Date | Event | Decision / outcome |
|---|---|---|
| 2026-04-20 | Initial MoR evaluation | Paddle chosen over Lemon Squeezy, FastSpring, Paypro Global, Gumroad, DodoPayments |
| TBD | Paddle sandbox validation | — |
| TBD | CA written opinion on export-of-services (TAX_MODEL.md Q2) | — |
| TBD | Paddle KYC approval | — |
| TBD | Production cutover gate | — |
