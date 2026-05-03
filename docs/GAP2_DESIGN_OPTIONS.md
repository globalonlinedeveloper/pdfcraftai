# Gap #2 — Per-tool first-use cap: design options

**Status:** OPEN — needs decision before implementation.
**Date drafted:** 2026-05-03 (post-plan auto-mode arc).
**Owner:** rajasekarjavaee@gmail.com (founder).
**Plan ref:** `docs/PRICING_AND_TELEMETRY_PLAN.md` §8 layer 6.

---

## TL;DR

The plan listed "5 credits should be one-use-per-tool" as the layer-6 abuse defense. That phrasing admits at least three interpretations, each with a different bot-defense and legit-user-friction profile. Pick one before I implement; the actual code change is ~30 minutes once the design lands.

| Option | Bot defense | Legit-user friction | Implementation cost | Recommendation |
|---|---|---|---|---|
| **A — Per-op cap on signup_bonus credits** | Strong (forces bot to sign up multiple times) | Low (user can still try every tool) | Small (~30 min, no schema) | **DEFAULT** |
| B — Separate 1-credit-per-tool grant | Weak (bot collects more total credits) | None (more credits!) | Medium (~1h, schema additions) | Skip unless growth-experiment data shows the 5-credit pool isn't enough |
| C — Force spread across ≥3 tools | Strong | High (user is told "you can't use this tool again, try another") | Medium (~1h, requires custom check) | Skip — friction outweighs defense |

---

## Background — what's deployed today

After the Pricing/Telemetry plan auto-mode arc (commits `c635015` → `d75f726`):

- New users get **5 credits, valid 7 days**, granted at `/verify-email` (after email-ownership proof).
- The 5 credits are **pooled** — a user can spend all 5 on a single op (e.g. one OCR run on a 5-page PDF, or one summarize across the whole pool).
- The 7-layer abuse stack (disposable blocklist, Gmail+alias normalize, verification gate, IP /24 throttle, device fingerprint, 7-day expiry, Cloudflare Turnstile) makes a single bot account expensive to manufacture.
- Admin can claw back via the new `/admin/users/[id]` grant/debit form.

The plan's intent for layer 6 was to add **one more** defense: even if a bot beats all the upstream layers, the 5 credits shouldn't be redeemable in a single high-value run.

## The three interpretations

### Option A — Per-op cap on signup_bonus credits (DEFAULT)

**Mechanic:** when a user spends signup_bonus credits, no more than `N` of them can go to any single op type. If they already spent `N` on `summarize`, the next summarize run must come from paid balance (or be denied if no paid balance).

**Concrete rule:** `N = 2` per op. A new user can summarize twice + translate once + ocr a single 1-page PDF before exhausting the 5-credit pool.

**Bot defense profile:**
- A bot that signs up to bulk-OCR has to register fresh accounts every 2 OCR runs (5 credits = 1 OCR run on a ~2-page PDF + 2 summarizes; per-op cap of 2 means they'd OCR once per account, and the 7-day expiry means they can't stockpile).
- Translate's per-chunk multiplier already self-limits — a 50-page translate burns through 5 credits in one shot, but with per-op cap `N=2` they get only the first 2 chunks free.
- OCR with `N=2` cap: max 2 pages of free OCR per account. Keeps per-account abuse value close to free-tier free-tools value.

**Legit-user friction profile:**
- A new user trying summarize, then translate, then ocr: zero friction (each op stays under the cap).
- A new user evaluating summarize specifically by running it on 3 different docs: hits the cap on the third try, sees "Top up to keep summarizing" — same UX as running out of pool credits, just a turn or two earlier.

**Implementation:**
- No schema change.
- `spendCredits` already records `(userId, operation, creditsSpent)` rows in `ai_usage`.
- New helper `lib/payments/per-op-bonus-cap.ts` queries: "credits this user has spent on op X via signup_bonus pool." Subtracts from a hard `N=2` cap. If the new spend would exceed the cap, route remaining cost to paid balance (or 402 if no paid balance).
- Hook lives at the spendCredits boundary — every AI route already calls it, so no per-route plumbing.

**Test surface:**
- New CI guard `test-per-op-bonus-cap.mjs` (~25 assertions: cap enforced, paid balance unaffected, fully-spent grant doesn't keep firing the cap, refunds restore the bucket, etc.).
- Existing `test-signup-bonus.mjs` extends with cap-related assertions.

**Risk:** the rule "no more than 2 of your 5 free credits on any single op" is harder to explain in marketing copy than "5 free credits, valid 7 days." Mitigation: don't surface the per-op cap in marketing — let it be a quiet server-side constraint that legit users almost never trip. The OutOfCreditsAlert will frame it as ordinary "out of credits, top up" UX.

**Estimate:** **~30 min** to ship the helper + wire into spendCredits + existing test guards adapt.

---

### Option B — Separate 1-credit-per-tool first-use grant

**Mechanic:** drop the 5-credit pooled bonus. Replace with: every user gets 1 credit per AI tool, granted on first use of that tool, capped to one-time-ever. Total possible value: 9 credits across 9 AI tools (ocr, redact, sign, summarize, rewrite, table, compare, generate, translate). Per tool: capped at 1 use.

**Bot defense profile:**
- A bot can collect 9 credits per signup (more than the current 5).
- Forces the bot to use multiple tools per account, but each individual tool is only worth 1 credit (~₹0.40), so spreading is low-value.
- Per-op cap of 1 makes OCR-on-a-50-page-PDF (5 credits at multiplier pricing) impossible for free — the bot can OCR 1 page max per account.

**Legit-user friction profile:**
- New user trying summarize: gets 1 free run, sees "this run was free, next run costs 3 credits."
- More complex marketing message: "9 free credits — 1 per tool, never expires."
- Discoverability problem: users who only ever care about 1-2 tools effectively get less than current 5-credit grant.

**Implementation:**
- Schema: new `signup_bonus_per_op_grants` table or extend ledger with `op_scope` column.
- New helper that grants 1 credit on first run of each op, with a separate idempotency key per (userId, op).
- Migration cost. Marketing copy rewrite.

**Risk:** changes the marketing pitch. We just shipped a 5-credit grant in the plan and the marketing copy at `/pricing` is still mid-update. Switching to "9 credits, 1 per tool" mid-flight is a UX walkback we'd have to explain to early users.

**Estimate:** **~1h** code + migration + marketing copy update + new CI guard.

---

### Option C — Force spread across ≥3 tools

**Mechanic:** hard limit on signup_bonus consumption: no more than 1 use per op until the user has used at least 3 different tools. After that, the remaining pool credits unlock for any op.

**Bot defense profile:**
- Stronger than Option A: a bot must successfully exercise 3 different op types per account before it can stockpile any one tool's free credits.
- For a translate-bot: useless — they'd have to also touch summarize and ocr to even use translate cheaply.

**Legit-user friction profile:**
- High. A user who specifically wants to evaluate translate gets denied after the first run unless they also try two other tools they don't care about.
- Admin support load: "why is it telling me to use compare when I only wanted to translate?"
- Conversion-killing UX. The whole point of the free grant is to let users evaluate the specific tool that drove their signup.

**Implementation:**
- Schema: track `tools_used` set per user.
- Logic complexity: every spendCredits call has to evaluate "is this user past the 3-tool gate?" and route to paid balance if not.

**Risk:** seriously hurts conversion. The free grant exists so a marketing-driven sign-up can immediately experience the tool they signed up for. Forcing them to use 3 tools first inverts that logic.

**Estimate:** **~1h** code + schema + careful UX copy + new CI guard.

---

## Recommendation

**Ship Option A.** Bot defense is the goal; per-op `N=2` cap on the 5-credit pool gets us 80% of the defense at 10% of the implementation cost, with near-zero legit-user friction and no schema change.

Skip Option B unless growth data later shows that the pooled 5 credits aren't driving enough cross-tool exploration. Skip Option C entirely — the friction is conversion-killing.

## Decision needed

Reply with **A**, **B**, or **C** (or "wait — let me think"). I'll ship A within 30 minutes of the answer.

## After-decision implementation plan (Option A)

1. New file `lib/payments/per-op-bonus-cap.ts` — pure helper, no I/O. Inputs: `(userId, op, requestedDelta, signupBonusBalance)`. Returns `{ allowedFromBonus: number, allowedFromPaid: number, deniedReason?: string }`.
2. Modify `spendCredits` (in `lib/payments/ledger.ts` or wherever it lives) to call the helper before debiting. If `allowedFromBonus < requestedDelta`, route the remainder to paid balance; if `allowedFromPaid` is also insufficient, return 402 with the standard insufficient-credits response.
3. Schema: none. The cap is computed from `ai_usage` (already filterable by userId, operation, createdAt > signup_bonus_grant.createdAt).
4. New CI guard `test-per-op-bonus-cap.mjs`.
5. Existing `test-signup-bonus.mjs` extends with cap assertions.
6. STATUS.md update.
7. Commit + push.

Total: 5 file changes, ~150 lines, ~30 min including aggregator runtime.
