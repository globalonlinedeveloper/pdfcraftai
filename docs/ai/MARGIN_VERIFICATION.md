# Margin verification — claimed vs actual

**Date:** 2026-04-20. **Answers:** "Did you verify max margin profit?"

**Short answer:** The 88/83/78/73% margins in `lib/pricing.ts` are **not achieved** under the current code defaults. They are **exceeded** under the intended routing, which isn't built yet. Two leaks (worst-case OCR + PayPal on small pack + Haiku default for everything) require fixes before we can claim those margins truthfully.

---

## 1. What the pricing table claims

From `lib/pricing.ts`:

| Pack | Price | Credits (+ bonus) | Claimed margin |
|---|---|---|---|
| Starter | $5 | 100 | 88% |
| Creator | $19 | 525 | 83% |
| Pro | $59 | 2,200 | 78% |
| Studio | $149 | 6,800 | 73% |

The `margin: 88` field isn't explained anywhere in the repo — no formula, no assumption set. So this audit re-derives the number.

## 2. What I modelled

**Three cost buckets** every pack pays:

1. **Payment processor fee.** Weighted 50% Razorpay INR / 30% PayPal USD / 20% Razorpay USD (matches the currency-routing policy in `PAYMENT_GATEWAY_PLAN.md` §10 Q1).
   - Razorpay INR: 2% × 1.18 (GST) = 2.36%.
   - Razorpay USD intl: 3% × 1.18 = 3.54%.
   - PayPal USD: 3.49% + $0.49 flat + 1.5% cross-border = ~4.99% + $0.49.
2. **AI provider cost.** Per-op tokens × provider pricing. Two scenarios:
   - **"Haiku-all"** — current code default: `ANTHROPIC_MODEL = claude-haiku-4-5-20251001` for every op. $1/Mtok in, $5/Mtok out.
   - **"Cheap routing"** — the intended policy from `docs/ai/MODELS_AND_MULTI_KEY.md`: OCR → Gemini Flash, translate → Gemini Flash, chat/rewrite → GPT-4o-mini, compare/redact/table → Haiku, generate/sign → Sonnet 4.6.
3. **Infrastructure** (Hostinger + MySQL + logs, amortised per pack): $0.10 / $0.20 / $0.50 / $1.00.

**Two usage profiles:**

- **Worst case** — user spends every credit on OCR (2 credits/page). This is rare but is how "margin: 88" should be read if it's conservative.
- **Realistic mix** — 40% chat, 15% summarize, 15% OCR, 10% translate, rest spread across rewrite/table/redact/compare/generate/sign. Weighted by credits each op consumes.

## 3. Results

### 3.1 Worst case (100% OCR)

| Pack | Claim | Haiku-only (today's default) | Cheap routing (Gemini Flash OCR) | PayPal-worst + Haiku |
|---|---|---|---|---|
| Starter | 88% | 79.7% | 91.4% | 71.2% |
| Creator | 83% | 78.2% | 94.4% | 74.8% |
| Pro | 78% | 73.1% | 95.0% | 71.0% |
| Studio | 73% | 68.5% | 95.2% | 66.6% |

**Reading:** with Gemini Flash for OCR (43× cheaper than Haiku per page — $0.00028 vs $0.012), even the worst case beats every claim by 2–22 percentage points. With Haiku for everything (current default), every pack misses its claimed margin by 5–8pp. With a Starter buyer paying via PayPal and doing only OCR on Haiku, margin falls to **71%**.

### 3.2 Realistic mix

| Pack | Claim | Haiku-all | Cheap routing | Gap (cheap vs claim) |
|---|---|---|---|---|
| Starter | 88% | 82.3% | 90.5% | +2.5pp |
| Creator | 83% | 81.9% | 93.2% | +10.2pp |
| Pro | 78% | 78.1% | 93.4% | +15.4pp |
| Studio | 73% | 74.5% | 93.2% | +20.2pp |

**Reading:** under realistic usage, cheap routing beats claim by 2–20 percentage points. Haiku-all routing narrowly misses Starter/Creator claims and matches Pro/Studio — the average user hides the worst-case cost.

## 4. Why the claim isn't safe yet

Three gaps between the pricing table's implicit promise and what ships today:

### Gap A — No Gemini adapter in code

`lib/ai/registry.ts` only has Anthropic and OpenAI rows. The routing table in `docs/ai/MODELS_AND_MULTI_KEY.md` recommends Gemini Flash as the default for `ocr` and `translate`, but there's no code path that can dispatch to it. **Current default routes 100% of OCR to Haiku 4.5 at 43× the cost of Gemini Flash.**

Fix: add a Gemini adapter in Phase A5 (P3 in the master plan today — promote to P2).

### Gap B — No ops-level routing policy

Route handlers call `selectProvider({ capabilityNeeded: 'streaming' })` — which picks the first configured provider that can stream, regardless of cost. A `chat_turn` and a `generate` both resolve to Anthropic today. We're paying Sonnet-class prices when GPT-4o-mini would do.

Fix: build `lib/ai/router.ts` per `AI_API_MASTER_PLAN.md` §4.4. Ship with a hardcoded policy table; DB-backed `ai_routes` is P2.

### Gap C — PayPal + Starter pack is a knife-edge

For a PayPal buyer of the $5 Starter pack, the fixed $0.49 fee alone is 9.8% of revenue. Combined with 3.49% + 1.5% cross-border, the processor drag is ~14%. If that user happens to do only OCR on Haiku, net margin drops to 71% — still profitable, but 17pp below claim.

Fix options (pick one before Payments Phase 1 goes live):

1. **Route Starter to Razorpay-only.** Remove PayPal from the Starter checkout. UI tweak only; the plan already anticipates per-pack provider selection.
2. **Raise Starter to $7.** Preserves PayPal option; hurts conversion.
3. **Cap Starter OCR credits.** 100 credits all on OCR = 50 pages = fine today; but if a user discovers this and buys Starter solely to chew OCR, we lose on the spread. Cap OCR at 30 pages/Starter-pack equivalent.

Current recommendation: option 1. Razorpay covers INR + USD; PayPal is only needed for customers whose cards Razorpay rejects.

## 5. BYOK margin separate analysis

The 15% infra fee on Pro BYOK:

- Pro pack $59 / 2200 credits = $0.0268/credit.
- BYOK charges 15% of that = $0.0040/credit infra fee.
- Our cost per credit at realistic-mix cheap routing: $0.0006.
- Spread per credit: $0.0040 − $0.0006 − processor = ~$0.0032 net.
- Pro user consuming 2200 credits/month via BYOK = ~$7 revenue, $1.30 cost, $5.70 net.

**That works.** 15% on the full-credit price is a ~80% margin on the infra-fee line. Concern: if we under-count the orchestration cost (moderation pre-flight, rate-limit tracking, key rotation checks), 15% shrinks fast. Should be re-measured after 4 weeks of real BYOK usage.

## 6. Actionable fixes (ranked by revenue impact)

1. **Fix the `margin:` field's meaning.** Either document it as "AI-only, excluding processor + infra + GST" or re-compute it as net margin. Today the number is silently misleading. Cost: 15 min. (Do now.)
2. **Route OCR to Gemini Flash.** Biggest single cost lever: 43× cheaper per page. Requires a Gemini adapter. Cost: 1 dev-day. Revenue impact: frees ~6–10pp of margin across all packs at any usage volume.
3. **Route chat/rewrite to GPT-4o-mini.** 4–8× cheaper than Haiku for high-volume ops. Requires nothing beyond `ai_routes` policy and the existing OpenAI adapter. Cost: 30 min. Revenue impact: ~3pp.
4. **Add per-pack processor routing.** Starter-only Razorpay. Cost: 1 hour at the checkout UI. Revenue impact: eliminates the 71% PayPal-worst scenario entirely.
5. **Kill-switch for Haiku in OCR.** Until (2) lands, cap OCR via Haiku at 5 pages per request. Forces users doing large batches to wait or retry, keeps the margin drift bounded.
6. **Measure, don't trust.** Phase A4's daily margin rollup cron turns "we think margin is 80%" into "yesterday's margin was 78.2% ± 2.1%." No pricing decisions on assumption — only on data.

## 7. Limits of this analysis

- Token estimates per op are educated guesses, not measured. OCR at 500 in / 800 out is typical; a user who uploads 20-page PDFs in one call pushes the input higher (on-document extraction). Need real telemetry from Phase A1's `ai_usage` table to replace guesses.
- No dispute / chargeback cost modelled. Razorpay ₹1000–2000 per dispute, PayPal $15–30. One chargeback on a Starter pack wipes out a year of that customer's margin.
- No refund rate modelled. Pricing FAQ promises "unused credits refundable within 14 days" — at any significant refund rate, the processor fee is lost (not refunded by the gateway).
- Support cost per user (~$0.50/mo on average for SaaS at this scale) is not in the infra bucket; real margin is another ~2pp lower.
- Taxes we collect (GST on the invoice we issue to Indian users) are pass-through, not revenue. Zero-rated for exports if LUT is filed. Ignored here.

## 8. Definition of done for "margin verified"

- [ ] `lib/pricing.ts:margin` field clarified or recomputed to be truthful.
- [ ] Gemini adapter shipped; OCR and translate default to Gemini Flash.
- [ ] Chat + rewrite default to GPT-4o-mini (not Haiku).
- [ ] Starter pack checkout hides PayPal, routes to Razorpay-only.
- [ ] Phase A4 daily margin rollup running; 7 consecutive green days at claim-or-better before we advertise the 88% number anywhere.
- [ ] Monthly BYOK infra-fee reconciliation shows 15% covers orchestration cost.

Until those six items are green, the pricing copy on the public site should read **"up to"** 88% margin — never flat-claimed.
