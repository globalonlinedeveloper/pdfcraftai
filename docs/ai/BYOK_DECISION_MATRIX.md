# BYOK decision matrix — every path, pinned behavior

**Companion to:** `docs/ai/PROVIDER_STRATEGY.md` (business case) and `docs/ai/MODELS_AND_MULTI_KEY.md` (routing + multi-key design).

**Purpose:** Enumerate every decision a BYOK-enabled AI request must make and pin the behavior *before* code is written. This is the spec the implementation must pass.

**Core principle (the prime directive):**

> **If a user has a valid BYOK key for a provider we'd route to, we use their key and charge them only the infra fee. Otherwise we use the platform key and charge full credits. We never silently move a request from BYOK to platform, because that means their bill looks normal while our provider bill spikes.**

---

## 1. The 7-step decision a request goes through

Every call to `/api/ai/*` follows this exact flow. Each step has a pinned answer in §3.

```
┌─ STEP 1 ────────────────────────────────────────────────────────┐
│ Auth + plan check                                               │
│   Who is the user? Are they eligible for BYOK at all?           │
└────────┬────────────────────────────────────────────────────────┘
         ▼
┌─ STEP 2 ────────────────────────────────────────────────────────┐
│ Resolve route                                                   │
│   What provider + model does this op want by default?           │
└────────┬────────────────────────────────────────────────────────┘
         ▼
┌─ STEP 3 ────────────────────────────────────────────────────────┐
│ Pick key source: BYOK vs platform                               │
│   Does the user have an active BYOK key for the resolved        │
│   provider (or for an allowed substitute)?                      │
└────────┬────────────────────────────────────────────────────────┘
         ▼
┌─ STEP 4 ────────────────────────────────────────────────────────┐
│ Charge credits                                                  │
│   BYOK → 15% infra fee (Pro) or 0 (Studio seat). Platform →     │
│   full credits. Use idempotency key so retries never double-    │
│   charge.                                                       │
└────────┬────────────────────────────────────────────────────────┘
         ▼
┌─ STEP 5 ────────────────────────────────────────────────────────┐
│ Decrypt + call adapter                                          │
│   Adapter takes apiKey per-call. Plaintext zeroized after.      │
└────────┬────────────────────────────────────────────────────────┘
         ▼
┌─ STEP 6 ────────────────────────────────────────────────────────┐
│ Handle failure                                                  │
│   Refund the RIGHT credits: infra on BYOK, full on platform.    │
│   Decide whether to retry on a different key / provider.        │
└────────┬────────────────────────────────────────────────────────┘
         ▼
┌─ STEP 7 ────────────────────────────────────────────────────────┐
│ Log ai_usage                                                    │
│   Record provider, model, key_source, byok_key_id, tokens,      │
│   cost_usd_micro (0 on BYOK), latency, result.                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Current code vs required changes

What the repo has today that BYOK must change:

| Today (lib/ai/) | Issue for BYOK | Required change |
|---|---|---|
| `adapters/anthropic.ts`: `this.client = new Anthropic({ apiKey: opts.apiKey })` in constructor | Key is baked into the cached client — can't vary per request | Accept optional `apiKey` on `chat()` / `streamChat()` methods; lazily build a per-call client if override provided |
| `adapters/openai.ts`: same pattern | Same | Same |
| `registry.ts`: caches adapter instance per provider_id | Singleton carries platform key | Keep the singleton for platform calls; add a "build unbound adapter" factory for BYOK calls |
| `app/api/ai/*/route.ts`: `selectProvider({ capabilityNeeded: 'streaming' })` then `provider.chat(...)` | Selects by capability from platform-configured providers only; doesn't know about BYOK | Route handlers call `router.resolve(userId, op, tier)` → `{ providerId, model, apiKey, keySource, byokKeyId }` and pass apiKey through |
| `credits.ts`: `spendCredits(userId, op, idempotencyKey)` always charges full `AI_OPERATION_COSTS[op]` | No concept of infra fee | Add `spendInfraFee(userId, op, idempotencyKey, byokKeyId)` that charges `ceil(cost × 0.15)`; Studio seat plan → charge 0 but still write the ledger row for audit |
| `chat_sessions.providerId` pins one provider per session | Breaks if user removes/rotates BYOK mid-session | Treat as a *hint* not a constraint; re-resolve each turn |
| No `ai_usage` table | Can't compute per-op margin or detect BYOK anomalies | Create per §5 below |

---

## 3. Decision matrix — every scenario answered

### 3.1 Step 1 — auth + plan eligibility

| Scenario | Behavior |
|---|---|
| Anonymous request | 401. No change from today. |
| Authed user on **Starter** / **Creator** | BYOK disabled by plan. `/app/api-keys` shows upsell. Any BYOK rows in DB for this user are ignored (not deleted). |
| Authed user on **Pro** with no keys | Platform path, full credits. |
| Authed user on **Pro** with at least one valid key | BYOK path, 15% infra fee. |
| Authed user on **Studio** with seat active | BYOK path, 0 credits (seat covers it). Ledger row still written for audit (`amount=0`, `note="studio_seat"`). |
| Authed user on **Studio** with seat expired / unpaid | Downgrade behavior (see §3.7). |

### 3.2 Step 2 — route resolution

Route = `{ providerId, model, fallback_*, max_input_tokens, max_output_tokens }` from `ai_routes`. Independent of BYOK.

| Scenario | Behavior |
|---|---|
| Admin picked `cheapest` tier in their config | Router respects tier. User has no say. |
| User requested `deep` tier (e.g. "Deep summarize" button) | Route looks up `(op, 'deep')`. Charge higher credit multiplier per `ai_routes.credit_multiplier`. |
| `ai_routes` row is `enabled=false` | Fall through to `tier='default'`; if that's also disabled, 503 `ai_op_disabled`. |
| Canary hit (canary_pct triggers) | Use canary provider/model. Log `canary_hit=true` in `ai_usage`. |

### 3.3 Step 3 — key source decision (the heart of BYOK)

Let `P` = resolved primary provider. Let `user.byok_preferences.provider_order` be the user's ordered list.

| User state | Behavior |
|---|---|
| No active BYOK key for any provider | Platform key for P. |
| Active BYOK key for **P** | BYOK. Pick specific key per balancing strategy (§3.8). |
| Active BYOK key only for a **different provider Q** | *Not* automatic. Two configurable behaviors: (a) **strict** — 503 `byok_provider_not_configured` with message "This op uses Anthropic by default; you only have an OpenAI key."; (b) **flexible** — substitute Q if `ai_routes.allow_byok_substitute = true` for this op AND Q supports the op's required capability. Default = **flexible** for chat/summarize/translate/rewrite, **strict** for ocr/table/redact/generate/sign (we pick the model for quality reasons, don't let BYOK degrade quality silently). |
| Has BYOK for P but `user.byok_preferences.op_overrides[op] = "Q"` | Use Q. User's per-op override wins over route's default, provided they have a Q key. |
| Has BYOK key but `status != active` (invalid / revoked / rate_limited / over_budget) | Skip that key. If no other active key matches § the above rules, fall through to platform (not silently — surface banner on UI: "Your Anthropic key is rate-limited until 14:32, using your OpenAI key instead"). Never, ever, fall from *any BYOK* to *platform* without an explicit user setting `byok_preferences.fallback_to_platform = true`. Default = **false**. |

**The anti-silent-fallback rule (most important):** If `byok_preferences.fallback_to_platform = false` (the default) and *no BYOK key* is usable, return `402 byok_unavailable` with structured details (`{ tried: [...], reason_by_key: {...} }`). The user sees a banner and fixes it. We never quietly spend our provider budget.

### 3.4 Step 4 — credit charging

| Scenario | Charge |
|---|---|
| Platform key, op = `summarize` (3 credits) | 3 credits, `reason=summarize`. |
| BYOK on Pro, op = `summarize` (3 credits) | `ceil(3 × 0.15) = 1` credit, `reason=summarize_byok_infra`. |
| BYOK on Studio with active seat | 0 credits, `reason=summarize_byok_studio`, ledger amount 0 (still written for count + audit). |
| Studio seat canceled / payment failed | Downgrade to Pro pricing rules for the rest of that billing period, then no BYOK if Pro itself lapses. See §3.7. |
| Idempotent replay (same `idempotencyKey`) | Lookup `ai_outputs` → if present, return cached output with `replay=true, creditCost=0`. Already in current code. |
| Credit balance < required | 402 `insufficient_credits`. No adapter call. |

**Ceiling rule:** infra fee is `max(1, ceil(base_cost × 0.15))`. Never zero, so ledger always has a row.

**Refund semantics on failure:**
- Provider 5xx/timeout → refund the same amount we charged (infra credits on BYOK, full on platform).
- Provider 4xx caused by user input (bad PDF, too many tokens) → refund (not user's fault they paid for our validation pass).
- User hit **their** BYOK quota → refund infra credits (we didn't do the work successfully).
- User hit **our** budget guard → refund full credits (our fault).
- Moderation pre-flight blocked the request → **no refund**. We did work and caught abuse; their choice to retry with different content.

### 3.5 Step 5 — adapter call with BYOK

Refactored adapter signature:

```ts
interface AIProvider {
  chat(input: ChatInput & { apiKey?: string }): Promise<ChatResult>;
  streamChat(input: ChatInput & { apiKey?: string }): AsyncIterable<ChatChunk>;
}
```

Per-call behavior:

| apiKey param | Adapter behavior |
|---|---|
| Omitted | Use the cached SDK client (platform key from constructor). Fast path, keep-alive benefits. |
| Provided | Build a throwaway SDK client with this key. Slightly higher latency on first call; SDKs are cheap to construct. Zeroize the string reference after the call returns. |

**Important: BYOK calls still flow through the same moderation / token-cap / output-limit pipeline** as platform calls. BYOK doesn't bypass safety; it bypasses our *billing*.

### 3.6 Step 6 — failure handling

| Adapter outcome | Action | Retry? |
|---|---|---|
| 200 | Write `ai_usage` ok, `ai_outputs` row, return. | — |
| 401 / 403 from provider (BYOK key rejected) | Mark `byok_keys.status = invalid`. Refund infra credits. Show banner. Do **not** retry on platform key. | No |
| 429 with `Retry-After` (BYOK key rate-limited) | Set `cooldown_until`, mark `rate_limited`. If user has another active BYOK key for this provider (or a substitute provider allowed per §3.3), retry on that. Otherwise refund + 429 to user. | Yes, up to 2 hops |
| 429 on **platform** key | Budget exceeded or rate-limited. Fall over to configured `fallback_provider_id` in `ai_routes`. If fallback also 429s, refund + 503. | Yes, 1 hop to fallback |
| Provider 5xx | Retry same key once with 2s backoff. If still fails, fall over per above matrix. | Yes |
| Budget guard triggered (our daily provider budget) | Short-circuit BEFORE adapter call. Fall to fallback. If fallback also over-budget, 503 `budget_exceeded`. Admin-alert. | No (budget, not transient) |
| Output moderation flagged | Return 422 `content_filtered`. No refund. | No |
| Input moderation flagged (before adapter call) | Return 422 `content_filtered`. Refund any credits we charged. | No |
| Client aborts mid-stream (SSE) | Abort adapter SignalController. Refund credits (we didn't deliver). Write `ai_usage` with `status=aborted`, `tokens_out=<partial>`. | No |

### 3.7 Step 7 — plan/subscription edge cases

| Event | Effect on BYOK |
|---|---|
| User upgrades Creator → Pro | BYOK becomes available. Any keys they added pre-upgrade become usable. |
| User downgrades Pro → Creator | Keys become `status=disabled_by_plan` (not deleted, not revoked, so re-upgrading restores). UI shows banner. Router skips them. |
| User downgrades Studio → Pro | Switch from seat-based (0 credits) to 15% infra fee. Ledger note records the switch. Keys stay active. |
| User cancels subscription | Same as downgrade to the lowest paid tier they still have balance on; when balance runs out, treat as free tier. |
| Razorpay refund on Pro subscription | Immediately disable BYOK for that user (`disabled_by_plan`). Do not revoke the stored keys — they might re-subscribe. |
| Payment failure / dunning | 7-day grace period with BYOK still active. On day 8 → `disabled_by_plan`. |
| Account deletion | Irreversibly `revoke` all BYOK keys; wipe ciphertext (NULL); keep row for audit. |

### 3.8 Multi-key tie-breaking

When user has 2+ active keys for the chosen provider:

| `balancing_strategy` | Pick |
|---|---|
| `priority` | Lowest `priority` number. Ties → `least_loaded` → `least_recently_used`. |
| `weighted` | Weighted-round-robin across all priority=0 keys by `weight`. P1+ keys only engaged on failover. |
| `least_loaded` | `min(in_flight_count)`. Ties → `least_recently_used`. |

**Sticky session rule for chat (important for prompt caching):** within a single `chat_session` and while Anthropic prompt cache is hot (5-minute window from last turn), use the same BYOK key across turns. Rotating keys mid-session re-pays for the cache. The router remembers `chat_session.last_byok_key_id`; only switches keys if the pinned one becomes unhealthy.

### 3.9 Per-op override conflicts

User set `op_overrides.translate = "mistral"` but only has Gemini keys:

| Behavior | Choice |
|---|---|
| Fail closed (strict) | 503 with message "You pinned translate to Mistral, but no Mistral key is configured. Add a key or clear the override." |
| Fall to user's global provider_order | Route to first available provider in their global order. |
| Fall to route's default | Route to route's default provider (Gemini) if user has a key there. |

**Chosen behavior: fail closed.** Anything else silently ignores an explicit user choice, which is worse than a clear error.

### 3.10 Capability gaps

Op needs `streaming`, user's chosen provider supports it, user's model doesn't:

| Scenario | Behavior |
|---|---|
| Capability supported by provider + model | Proceed. |
| Capability not supported by model (but provider has other models that do) | Router auto-upgrades model to the next capable model in the provider's catalog at same tier. Log `model_upgraded_reason=capability` in `ai_usage`. |
| Capability not supported by any provider user has | Fall to route's fallback per §3.3. If still no match: 503 `capability_unavailable`. |

Example: op = `chat_turn`, user pinned `provider=gemini` but chose `model=text-bison-001` (no streaming). Router auto-upgrades model to `gemini-1.5-flash`.

### 3.11 Data / PII constraints

| User key labeled `region=EU` and doc flagged `eu_scope=true` | Use only EU keys. If none active, 503 `eu_key_required`. No auto-fall to US keys. |
| User marked `allow_data_retention=false` on key | Router sets provider-specific header (Anthropic: `anthropic-beta=prompt-retention-0`; OpenAI: `x-stainless-disable-retention: 1`; Gemini: PAYG already opted-out). Refuse on providers that can't honor (DeepSeek). |
| Admin disabled `deepseek` globally (`ai_providers.enabled=false`) | Router skips even if user has DeepSeek BYOK. Message: "DeepSeek is disabled by the platform." |

### 3.12 Concurrency and races

| Race | Mitigation |
|---|---|
| Two concurrent requests pick same BYOK key → both exceed that key's concurrency cap | Pre-flight: increment `in_flight_count` atomically (optimistic SELECT + UPDATE with version check, or Redis if available). If >= cap, pick the next key. |
| User adds new key during a long-running request | Long request already has its key decrypted + in-flight. Completes on old key. New key joins pool on next request. |
| User deletes a key during a long-running request | Same — plaintext is already in memory; completes. Next request to the deleted key returns `invalid`. DB row soft-deletes first (status=revoked) for audit; physical deletion is a cron. |
| Two concurrent adds of the same key (user double-clicks) | Unique index on `(user_id, provider_id, key_fingerprint)` where fingerprint = HMAC-SHA256(master_key, plaintext). Second insert fails cleanly. |
| Monthly budget overrun race (two concurrent calls both see under-budget) | Same as credits race today: accept small overshoot. If it becomes a problem, add Redis reservation. |

### 3.13 Observability — what we log, what we don't

**Always log:**
- `ai_usage.provider_id`, `model`, `key_source`, `byok_key_id` (null for platform)
- `tokens_in`, `tokens_out`, `cost_usd_micro` (0 on BYOK)
- `ledger_id` pointing at the credit debit
- `status`, `error_code`, `latency_ms`
- `canary_hit`, `model_upgraded_reason`

**Never log:**
- Plaintext API keys
- Ciphertext keys (the crypto DB column) outside that column
- Prompt contents on BYOK calls (only token counts) — even on error paths
- Master encryption key anywhere, including in error messages

Admin dashboard (`/admin/ai-usage`) distinguishes:
- **Platform spend** = sum of `cost_usd_micro` where `key_source='platform'`
- **Platform revenue** = sum of credit debits × blended $/credit rate
- **BYOK volume** = count of calls, tokens — but no cost-to-us number (there isn't one)
- **BYOK infra revenue** = credit debits on BYOK rows × blended $/credit

---

## 4. Invariants (things that must always be true)

These are acceptance criteria the implementation must pass. Test cases derive directly from them.

1. **I-1 No key crossing:** A BYOK-initiated request never silently completes on the platform key. Either it uses the user's key, or it 402s.
2. **I-2 No plaintext leak:** API key plaintext exists only in process memory for the duration of the request, is zeroized on exit, and never appears in any log, error message, or response body.
3. **I-3 Credit conservation:** For every adapter call attempt, exactly one ledger debit exists AND exactly one refund exists iff the call failed in a refundable way. `SUM(debits) - SUM(refunds)` = actual value delivered.
4. **I-4 Single source of truth for model choice:** `ai_routes` is read at the start of every request; no code path hardcodes a model string.
5. **I-5 Idempotency:** Given the same `idempotencyKey`, a request either returns the cached `ai_outputs` row or runs once and only once. Retries never double-charge.
6. **I-6 Safety equality:** Moderation + token caps apply equally to BYOK and platform paths.
7. **I-7 Budget guard applies only to platform:** BYOK requests are not subject to our daily provider budget (that's their money). BYOK requests ARE subject to *their* per-key monthly budget.
8. **I-8 Capability honesty:** We never call a model for a capability it doesn't support. Capability is resolved before the API call.
9. **I-9 Audit completeness:** Every attempted call (success, fail, abort, moderation-blocked, budget-blocked) writes exactly one `ai_usage` row.
10. **I-10 Plan boundary:** BYOK is unreachable for Starter/Creator. `/app/api-keys` hides add-key UI; any orphan DB keys are ignored by the router.

---

## 5. Minimum schema to support all of the above

### 5.1 `ai_routes` (from MODELS_AND_MULTI_KEY.md §2.2.1, adding one column)

Add: `credit_multiplier DECIMAL(3,2) NOT NULL DEFAULT 1.00` — for `deep` tier that charges 2× credits.
Add: `allow_byok_substitute BOOLEAN NOT NULL DEFAULT TRUE` — per §3.3 strict-vs-flexible behavior.

### 5.2 `byok_keys` (from MODELS_AND_MULTI_KEY.md §3.1, adding two columns)

Add: `key_fingerprint CHAR(64) NOT NULL` — HMAC-SHA256(master_key, plaintext). Unique per user. Prevents duplicate adds (§3.12).
Add: `region ENUM('any','eu','us','apac') DEFAULT 'any'` — for §3.11 data residency.
Add: `allow_retention BOOLEAN DEFAULT TRUE` — sets provider no-retention headers.

### 5.3 `byok_preferences` (from MODELS_AND_MULTI_KEY.md §3.1, adding two columns)

Add: `fallback_to_platform BOOLEAN NOT NULL DEFAULT FALSE` — THE anti-silent-fallback switch.
Add: `strict_provider_match BOOLEAN NOT NULL DEFAULT FALSE` — if true, §3.3 "active BYOK for different provider" path fails instead of substituting.

### 5.4 `ai_usage` (from PROVIDER_STRATEGY.md §4.1, adding columns)

Add: `canary_hit BOOLEAN DEFAULT FALSE`
Add: `model_upgraded_reason VARCHAR(64) NULL` — e.g. `capability`, `fallback_429`, `canary`
Add: `request_aborted BOOLEAN DEFAULT FALSE`

### 5.5 `credit_ledger`

Existing table; new `reason` values used:
- `summarize_byok_infra`, `chat_turn_byok_infra`, etc. (one per op)
- `summarize_byok_studio` (amount=0)
- `refund_byok_infra` (matched to original debit via `refunded_ledger_id`)

---

## 6. Test cases that must pass

### 6.1 Happy paths

- **T-1** Pro user, one Anthropic BYOK, `summarize` → charges 1 credit, calls user's Anthropic key, `ai_usage.key_source=byok`.
- **T-2** Studio user, one OpenAI BYOK, `chat_turn` → charges 0 credits, ledger row with amount=0, `ai_usage.key_source=byok`.
- **T-3** Free user, `summarize` → charges 3 credits, platform key, `ai_usage.key_source=platform`.

### 6.2 Fallback paths

- **T-4** Pro user, 2 Anthropic BYOK keys both at priority 0 (weighted). 100 requests → roughly 50/50 split.
- **T-5** Pro user, Anthropic BYOK returns 429 → router retries on second Anthropic key. If only one key, refund + 429 to user.
- **T-6** Pro user, Anthropic BYOK returns 401 → key marked `invalid`, infra credit refunded, 402 `byok_unavailable` to user (not silent fall to platform).

### 6.3 Plan boundary

- **T-7** Starter user with an old BYOK row in DB → router ignores it, platform path, full credits.
- **T-8** Pro user downgrades to Creator → next request skips BYOK even if row exists; keys marked `disabled_by_plan`.

### 6.4 Concurrency

- **T-9** Same user fires 10 summarize calls in parallel with `concurrency_cap=3`. Exactly 3 in-flight per key at any moment; the other 7 queue or pick a secondary key.
- **T-10** Same `idempotencyKey` sent twice → second returns cached `ai_outputs` with `replay=true`; no second adapter call; no second debit.

### 6.5 Safety

- **T-11** BYOK call with a prompt that trips moderation pre-flight → 422 `content_filtered`, infra credits refunded, adapter never called.
- **T-12** BYOK call succeeds but output has `finish_reason=content_filter` → 422 returned to user, infra credits **not** refunded (we did the work).
- **T-13** BYOK call exceeds per-key `monthly_budget_usd_micro` → key marked `over_budget`, request falls to next BYOK key or 402 per §3.3.

### 6.6 Audit / observability

- **T-14** After 1,000 mixed requests, `SUM(ai_usage WHERE key_source='platform').cost_usd_micro` matches provider console within 1%.
- **T-15** For every `ai_usage.status='ok'` row there's exactly one non-refunded `credit_ledger` row.
- **T-16** `key_ciphertext` never appears in application logs (grep check in CI).

---

## 7. What today's code needs changed — concrete file-level diff list

Minimum viable implementation:

### New files
- `lib/ai/router.ts` — `resolve({ userId, op, tier })` returns `RouterHandle`.
- `lib/ai/byok/crypto.ts` — AES-256-GCM encrypt/decrypt with zeroize.
- `lib/ai/byok/store.ts` — CRUD on `byok_keys` + `byok_preferences`.
- `lib/ai/byok/health.ts` — in-memory health tracker + cooldown.
- `lib/ai/budget.ts` — daily platform budget guard.
- `lib/ai/moderation.ts` — OpenAI Moderation pre-flight wrapper.
- `db/schema/ai_routes.ts`, `ai_usage.ts`, `byok_keys.ts`, `byok_preferences.ts`.
- `app/admin/ai-routes/page.tsx`, `app/admin/ai-usage/page.tsx`.
- `app/app/api-keys/page.tsx` — real UI replacing "coming soon" stub.

### Modified files
- `lib/ai/adapters/anthropic.ts` — `chat()` / `streamChat()` accept optional `apiKey` arg.
- `lib/ai/adapters/openai.ts` — same.
- `lib/ai/registry.ts` — expose `buildUnbound(providerId)` alongside existing `getProvider`.
- `lib/ai/credits.ts` — add `spendInfraFee()` and `refundInfraFee()`.
- `lib/pricing.ts` — export `INFRA_FEE_RATE = 0.15` and helpers.
- `app/api/ai/*/route.ts` (10 files) — replace `selectProvider()` with `router.resolve()`; pass `apiKey` through to adapter.
- `auth.ts` / session shape — expose `user.plan` for router to check.

### New env
- `BYOK_MASTER_KEY` — 32 random bytes base64-encoded. In Hostinger env only.
- `AI_DAILY_BUDGET_USD_ANTHROPIC` etc. — per-provider daily caps.
- `ENABLE_BYOK=true` — feature flag to keep it dark until ready.

---

## 8. Rollout checklist — "yes, all the logic is handled"

The claim "we handle all the BYOK logic" is only true if the implementation passes **every** invariant in §4 and **every** test case in §6. Until then, BYOK ships behind `ENABLE_BYOK=false` and the `/app/api-keys` page stays on its placeholder.

Go-live gates:

- [ ] All 16 tests in §6 pass in CI (each as a Vitest case against a mocked provider).
- [ ] A penetration-test style review against §4's invariants (try to leak a plaintext key via error message; try to silently fall from BYOK to platform; try to double-charge via idempotency).
- [ ] Admin dashboard shows clean platform-vs-BYOK separation on a 24-hour live canary.
- [ ] Docs pages updated: `/help/byok`, `/privacy` (sub-processors list), ToS note.
- [ ] Support playbook written: "User reports 402 byok_unavailable — steps to diagnose."

Anything short of these five items means we DON'T "handle all the logic" — we handle most of it, which is worse than "none of it", because silent bugs turn into financial leaks.

---

## 9. TL;DR answer to the question

**"Suppose user entered BYOK — if they entered own key, we also provisioning key — system will use the BYOK instead of admin key — all the logics are we handling?"**

**Short answer:** The design handles every scenario I can think of, but the current *code* doesn't yet. The gap:

1. Adapters today cache the platform apiKey at construction; they need a per-call override.
2. Route handlers call `selectProvider()` which doesn't know about users or BYOK; they need to call a new `router.resolve()` that reads `byok_keys` + `ai_routes`.
3. Credit layer charges full `AI_OPERATION_COSTS`; needs `spendInfraFee()` variant.
4. No `ai_usage` table yet, so we can't prove §4's invariants after the fact.

Once those four changes land and the 16 tests in §6 pass:

- Yes, BYOK takes precedence over admin key when a valid one exists for an allowed provider.
- Yes, we charge the infra fee (Pro) or nothing (Studio) instead of full credits.
- Yes, we never silently fall back to the admin key (unless the user explicitly opts in).
- Yes, we handle 401 (invalid), 429 (rate-limited), 5xx (provider down), budget, concurrency, plan downgrades, regional routing, capability gaps, idempotency, and refunds correctly.
- Yes, we audit every call with `key_source` + `byok_key_id` so you can reconcile BYOK volume, platform spend, and margin on one screen.

Until the code ships and passes the tests: **"the plan handles it, the code does not yet."** The `ENABLE_BYOK` feature flag keeps users off the path until it's green.
