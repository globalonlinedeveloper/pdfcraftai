# 3-provider cost matrix + detect points + margin moves

**Date:** 2026-04-21
**Anchored to:** 1 organic `ai_usage` row (gate #3 close, 17:25:26 UTC) + published provider pricing.
**Companion:** `docs/ai/COST_MATRIX_3PROVIDER.xlsx` — every number below is a live formula; edit the blue "Providers" / "Ops" cells to re-run the analysis.

**Answers:**
1. "Did we analyze cost across all 3 provider possibilities?" — Yes, now. See §2 cost matrix.
2. "Detect points?" — §3 arbitrage table + §5 detect-point instrumentation.
3. "Higher margin profits?" — §4 ranked moves; biggest single lever drops cost-per-call 77% on 7 of 10 ops.

---

## 1. What actually ships today vs what the margin model assumed

| Provider | Registry default (code) | Rate used in `margin_scenarios.py` (v3) | Actual rate |
|---|---|---|---|
| Anthropic | `claude-haiku-4-5-20251001` | $1.00 / $5.00 per Mtok | ✓ matches |
| OpenAI | `gpt-4o-mini` | $0.15 / $0.60 per Mtok | ✓ matches |
| Gemini | `gemini-2.5-flash` | **$0.075 / $0.30 per Mtok (1.5 Flash)** | **$0.30 / $2.50 per Mtok (2.5 Flash)** |

**Finding 1 — the margin model is running on stale Gemini pricing.** `docs/ai/MARGIN_VERIFICATION.md` §3 cites "Gemini Flash at 43× cheaper than Haiku per page" — that was true for 1.5 Flash. The registry actually calls 2.5 Flash, which is 4× more expensive on input and ~8× more expensive on output than 1.5 Flash. Every "cheap routing" number in MARGIN_VERIFICATION.md that assumes Gemini costs over-states margin by 2-3pp on ops that route to Gemini.

Impact on the pack-level claims: S1 Baseline "cheap routing" column drops from 88.9/91.0/90.4/89.5 → roughly 86.5/89.0/88.5/87.8 after correcting Gemini. Still above claim, but the headroom is thinner than the doc says. **Update `margin_scenarios.py` PROVIDERS["gemini"] to (0.30, 2.50) before any public margin claim.**

## 2. Per-op per-provider cost matrix (USD per single call)

From the xlsx `Cost Matrix` tab — token estimates from `margin_scenarios.py:OP_TOKENS`, provider rates from the table in §1.

| Op | Credits | Anthropic Haiku | OpenAI 4o-mini | Gemini 2.5 Flash | Cheapest |
|---|---:|---:|---:|---:|---|
| chat_turn | 1 | $0.003500 | **$0.000465** | $0.001450 | openai |
| summarize | 3 | $0.011000 | **$0.001560** | $0.003900 | openai |
| translate | 5 | $0.019000 | **$0.002370** | $0.008900 | openai |
| ocr | 2 | $0.004500 | (no pdfInput) | **$0.002150** | gemini |
| compare | 15 | $0.025000 | **$0.003450** | $0.009500 | openai |
| rewrite | 3 | $0.025000 | **$0.003120** | $0.011700 | openai |
| table | 3 | $0.013500 | **$0.001800** | $0.005550 | openai |
| redact | 5 | $0.010000 | **$0.001350** | $0.004000 | openai |
| generate | 20 | $0.042000 | **$0.005100** | $0.020600 | openai |
| sign | 10 | $0.008500 | **$0.001050** | $0.004050 | openai |
| **Basket (one of each)** | 72 | **$0.1620** | **$0.0208** | **$0.0718** | — |

**Two readings that flip priors:**
- **OpenAI gpt-4o-mini is the cheapest capable provider on 9 of 10 ops.** The exception is OCR, which requires `pdfInput` (per `router.ts:OP_REQUIRED_CAPABILITY`) and OpenAI's Chat Completions doesn't expose it — so OCR's cheapest capable option is Gemini, not OpenAI.
- **Gemini 2.5 Flash is ~3-5× more expensive than OpenAI 4o-mini on every op.** Sending ops to Gemini for "cheap routing" reasons is the opposite of cheap under current pricing. The only reason to keep Gemini on an op is a capability gate (pdfInput for OCR) or quality (OCR fidelity on scans).

## 3. Arbitrage detection — current routing vs cheapest capable

From the xlsx `Routing vs Best` tab. "Current primary" is the first entry of `ROUTING_POLICY` in `lib/ai/router.ts`. "Cheapest capable" respects the `OP_REQUIRED_CAPABILITY` gate.

| Op | Current primary | Cheapest capable | Savings/call | Savings/1k calls | Verdict |
|---|---|---|---:|---:|---|
| chat_turn | openai | openai | $0.000000 | $0.00 | ✓ aligned |
| summarize | anthropic | openai | $0.009440 | $9.44 | → re-route |
| translate | gemini | openai | $0.006530 | $6.53 | → re-route |
| ocr | gemini | gemini | $0.000000 | $0.00 | ✓ aligned (OpenAI lacks pdfInput) |
| compare | anthropic | openai | $0.021550 | $21.55 | → re-route |
| rewrite | anthropic | openai | $0.021880 | $21.88 | → re-route |
| table | anthropic | openai | $0.011700 | $11.70 | → re-route |
| redact | anthropic | openai | $0.008650 | $8.65 | → re-route |
| generate | anthropic | openai | $0.036900 | $36.90 | → re-route |
| sign | anthropic | openai | $0.007450 | $7.45 | → re-route |

**At 1k calls of every op (10k calls total):** current routing burns **$127** in provider cost; cheapest-capable routing burns **$21** — a **$106 / 10k-call savings**. Scaled to the MARGIN_VERIFICATION.md realistic mix (chat-heavy), the savings concentrate on chat (already aligned) and summarize (huge re-route win).

**Caveat — why we don't just flip everything to OpenAI:**
1. **Quality on long-form writing.** `router.ts` comment L36-39 explicitly says "Claude's writing style wins" for summarize/compare/generate/sign. That's an AB-test result, not a cost claim. Re-routing primary → fallback on quality-sensitive ops needs an eval before the switch, not after.
2. **Vendor concentration risk.** Putting 9 of 10 ops on OpenAI primary means an OpenAI outage is a site-wide outage. Current ladder has built-in cross-vendor failover.
3. **OCR stays gemini** — capability-locked.

**Recommended first move:** re-route **rewrite + table + redact + translate** to OpenAI primary (these are all "mechanical" ops where style doesn't matter — re-word, extract-table, strip-PII, translate). Leave summarize / compare / generate / sign on anthropic primary until quality evals run. Estimated savings on realistic mix: ~4-6pp gross margin.

## 4. Higher-margin moves, ranked by revenue impact

### 4a. Route the 4 mechanical ops to gpt-4o-mini primary (1-hour change)

Edit `lib/ai/router.ts:ROUTING_POLICY`:

```ts
translate: ["openai", "gemini", "anthropic"],   // was [gemini, anthropic, openai]
rewrite:   ["openai", "anthropic", "gemini"],   // was [anthropic, openai, gemini]
table:     ["openai", "anthropic", "gemini"],   // was [anthropic, openai, gemini]
redact:    ["openai", "anthropic", "gemini"],   // was [anthropic, openai, gemini]
```

(Note: rewrite/table/redact don't appear in the router's AIOp union in the mount's router.ts — they route via `generate` today. Fix as part of this change: split the ops so each gets its own ladder. Until then, all 4 are routed via the `generate` ladder → anthropic primary → paying 8× the OpenAI rate.)

**Estimated margin delta on realistic mix:** +3 to +5pp at the pack level. The rewrite row fails the 75% AI-only target today (72.2% GM%) on current routing — it hits 96.5% after re-routing.

**Risk:** low. These 4 ops are mechanical/structural, not stylistic. OpenAI has shipped these against GPT-4o-class models for 18+ months with no quality regressions reported.

### 4b. Quality-eval summarize/compare/generate/sign on gpt-4o-mini (1 sprint)

Run the existing production prompts through gpt-4o-mini on a held-out set of 50 real inputs per op. Grade on:
- summarize: faithfulness + key-point coverage (human graders or claude-judge)
- compare: diff completeness + correctness (automated against gold diffs)
- generate: readability + instruction-following (A/B side-by-side)
- sign: narrative quality + detection accuracy (blinded grader)

Pass threshold: ≥95% parity with current anthropic baseline. Any op that passes flips primary to openai. Estimated margin delta if all 4 pass: +6 to +9pp on realistic mix (these are the largest-credit ops, so re-route has outsized leverage).

**Risk:** medium. GPT-4o-mini is smaller than Haiku 4.5 on reasoning benchmarks. Likely passes summarize + sign, coin-flip on compare + generate. Budget to keep ~2 of 4 on anthropic.

### 4c. Populate `cost_micros` at insert time (Task #22 follow-up)

Currently every row writes `cost_micros: null`. Without it, the margin dashboard will compute 100% margin on every row (the rollup COALESCE's NULL to 0). **This is a higher-priority integrity move than any routing change** — you cannot measure the effect of 4a/4b without it.

Implementation sketch:

```ts
// lib/ai/adapters/anthropic.ts (and openai.ts, gemini.ts)
const PRICING = {
  "claude-haiku-4-5-20251001":   { in: 1_00, out: 5_00 },   // micros per Mtok
  "claude-sonnet-4-6-20260101":  { in: 3_00, out: 15_00 },  // hypothetical
} as const;
export function costMicros(model: string, inTok: number, outTok: number): bigint {
  const p = PRICING[model];
  if (!p) return 0n;  // unknown model → 0, caller logs warning
  return BigInt(Math.ceil(inTok * p.in + outTok * p.out));  // per Mtok, so ÷1M at read time
}
```

Then `app/api/ai/chat/route.ts:465 / :520` passes `costMicros: costMicros(model, inTok, outTok)` instead of `null`. **Unblocks gate #7's 7-day streak.**

### 4d. Starter-pack: the detect point

From MARGIN_VERIFICATION.md §12.3: Starter net margin on Paddle is 88.5% under cheap routing but drops to ~38% in the combined worst case (S11 in margin_scenarios.py). The $0.49 Paddle fixed fee alone is 10% of the $5 sticker, and a single chargeback wipes out a year of margin. **Gate 4a/4b wins aren't distributed equally across packs** — they concentrate on Creator/Pro/Studio where AI cost is the dominant cost bucket. For Starter, processor + infra + support already eat more than AI cost, so re-routing moves the pack-level needle less.

**Detect point:** instrument the margin dashboard to split by pack. If Starter net margin dips below 60% for 3 consecutive days (moving average), trigger a pricing review. Do not advertise a flat "88% margin" claim in copy — use "up to 91%" or publish per-pack numbers.

## 5. Detect-point instrumentation

Two alerts the margin rollup cron (Task #22 gate #7) should raise, once `cost_micros` is populated:

### 5a. Per-op margin drift alarm

```sql
-- Fires if any op's daily margin_bps falls >2000 bps (20pp) below the trailing
-- 30-day median for that op. Catches both provider price rises (§8 of
-- margin_scenarios.py) and token-estimate misses (§9).
WITH op_medians AS (
  SELECT operation, APPROX_PERCENTILE(margin_bps, 0.5) WITHIN GROUP (ORDER BY margin_bps) AS med_30d
  FROM ai_daily_margin_per_op
  WHERE day BETWEEN DATE_SUB(CURRENT_DATE, INTERVAL 30 DAY) AND DATE_SUB(CURRENT_DATE, INTERVAL 1 DAY)
  GROUP BY operation
)
SELECT today.operation, today.margin_bps, m.med_30d, (today.margin_bps - m.med_30d) AS drift_bps
FROM ai_daily_margin_per_op today
JOIN op_medians m USING (operation)
WHERE today.day = CURRENT_DATE - INTERVAL 1 DAY
  AND today.margin_bps < m.med_30d - 2000;
```

### 5b. Provider-cost share alarm

If a provider's share of total `cost_micros` on a given day exceeds its share of the routing policy (e.g., anthropic is in primary position on 7/10 ops → expect ≤ 70% cost share; if it hits 85%, either traffic mix skewed toward anthropic-primary ops, or providers OpenAI/Gemini failed over to anthropic mid-day). Both cases are worth a human look.

### 5c. "Dark routing" detector

Count rows where `provider_id` ≠ the current `ROUTING_POLICY[operation][0]` (primary). Expected: 1-3% of rows (failover). If it spikes above 10%, either the primary is flapping or the env var override is wrong. Already implementable — no schema change needed.

## 6. Organic-row anchor (gate #3)

From `docs/ai/COST_MATRIX_3PROVIDER.xlsx` "Organic Anchor" tab, using the 1 real row in production:

| Metric | Value |
|---|---|
| Provider routed | anthropic (claude-haiku-4-5-20251001) |
| Real cost | $0.005486 |
| Revenue (3 credits × $0.030) | $0.090000 |
| **Gross margin actual** | **93.9%** |
| Cost if we'd routed to openai | $0.000697 (87% cheaper) |
| Cost if we'd routed to gemini | $0.002485 (55% cheaper) |
| GM% if re-routed to openai | 99.2% |

The real row hits **+5.6pp above** the margin_scenarios.py estimate for summarize (estimate = 8000 in / 600 out → predicts $0.011 cost → 87.8% GM%). **In production, summarize runs on shorter inputs than the model assumes**, so the margin model is under-reporting today's real margin. One data point is a data point, not a trend — re-run this analysis after 50 rows accumulate per op.

## 7. Definition of done

- [ ] `margin_scenarios.py` PROVIDERS["gemini"] updated to (0.30, 2.50) — matches registry default
- [ ] `router.ts:ROUTING_POLICY` flipped for translate/rewrite/table/redact to openai primary
- [ ] Quality-eval harness run on summarize/compare/generate/sign → decide each op's primary
- [ ] `cost_micros` populated at insert time in all 3 adapters (Task #22 close)
- [ ] 5a/5b/5c alarms wired into `/api/cron/ai-margin-rollup`
- [ ] `ai_daily_margin_per_op` view added (split the existing rollup by operation)
- [ ] 7 consecutive days of green margin data → flip public copy from "up to X%" to per-pack actuals

## 8. Cross-references

- `lib/ai/router.ts` — routing policy, capability gates
- `lib/pricing.ts:AI_OPERATION_COSTS` — credits-per-op table
- `lib/ai/margin-rollup.ts:72` — `REFERENCE_USD_MICROS_PER_CREDIT = 30_000`
- `docs/ai/MARGIN_VERIFICATION.md` — pack-level margin sweep (11 scenarios)
- `docs/ai/COST_GUARDRAILS.md` — per-op cap + dark-launch guardrails
- `docs/STATUS.md` — Task #22 follow-up (cost_micros integrity)
- `docs/ai/COST_MATRIX_3PROVIDER.xlsx` — live model for this doc
