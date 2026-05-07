# Auth-flow gaps — analysis + closeout (2026-05-06)

Context: review of the signup → verification → dashboard flow surfaced four honest gaps. This doc tracks the closeout state of each.

## Gap #1 — No 6-digit OTP / code-confirmation alternative ⏳ DEFERRED

**State:** the only verification path is the magic-link in the email. Users who prefer typing a 6-digit code (or whose mail client strips the link) have no alternative. Common pattern on banking + SaaS apps; missing here.

**Why deferred to its own ship:** safe OTP requires 4 design decisions that don't fit a tight commit:

1. **Throttling.** A 6-digit code is 10^6 ≈ 1M combinations. An attacker who knows the email + can submit 100 attempts/sec brute-forces in <3 hours. Need:
   - Per-(userId, code-attempt) rate limit (e.g. 5 attempts then 15-min lockout)
   - Server-side attempt counter persisted in a new column or a Redis-ish in-memory store
   - Generic error copy on failed attempts (no enumeration of which codes are wrong)
2. **Storage strategy.** Two options:
   - Reuse `verification_tokens` table — store hash of the 6-digit code with a `code:` prefix on the identifier, primary key `(identifier, token)` already supports multiple rows per user. Simple but the existing query in `consumeVerificationToken` would need to be updated to differentiate token-vs-code rows.
   - New `verification_codes` table with `(user_id, code_hash, attempts, locked_until, expires)` columns. Cleaner separation; small migration.
3. **TTL.** Magic link is 24h. Codes should be shorter — 15 min industry standard — because a code visible to a shoulder-surfer in the email preview is more trivially compromised than a one-click link.
4. **UI.** New form on `/verify-email` with 6 input boxes (auto-advance, paste-handling) OR a single 6-digit input. Plus a `/api/auth/verify-code` POST endpoint with the throttle.

**Estimate:** 1 day (writer + endpoint + UI + throttle table migration + CI guards). Distinct deliverable.

**Stub helper signatures** (not implemented, but documented for the next ship):

```ts
// lib/auth/email-verification.ts (additions for OTP path)
export async function createVerificationCode(userId: string): Promise<string>
  // Returns 6-digit string, stores hash, deletes any existing code for user.

export async function consumeVerificationCode(
  userId: string,
  code: string,
): Promise<
  | { ok: true }
  | { ok: false; reason: "invalid" | "expired" | "locked_out" }
>
  // Increments attempts on miss; locks out after 5 misses for 15 min.
  // Constant-time comparison on the hash (timing-attack defense).
```

## Gap #2 — No "resend verification email" button ✅ SHIPPED 2026-05-06

**Old state:** if the 24h verification token expired or got lost in the inbox, the user had no recovery path other than emailing support.

**Closed by this commit:**
- Added `lib/auth/email-verification.ts:resendVerificationEmail(userId)` — handles already-verified short-circuit, 60s rate-limit (inferred from existing token's age), SMTP-failure mapping.
- Added `POST /api/auth/resend-verification` route with anti-impersonation (`userId` from session, never body).
- Added `<UnverifiedEmailBanner />` client component on `/app/dashboard` with Resend button + four terminal states (sent / already_verified / rate_limited / smtp_failed).

**60s rate-limit rationale:** prevents accidental double-tap on the Resend button from spamming the user's inbox. Implemented by inferring "last send time" from the existing token's `expires` (TOKEN_TTL_MS - (expires - now) ≈ token age). No new column needed.

## Gap #3 — No verification gate on AI tools ✅ SHIPPED 2026-05-06

**Old state:** unverified users couldn't get the 5-credit signup bonus (gated on verification), but a paid user could theoretically buy credits + run AI ops without ever proving email control. DPDP doesn't strictly require pre-verification for paid usage, but it's an enforcement gap that lets the same-email-multiple-account abuse vector slip through.

**Closed by this commit:**
- Added `lib/auth/email-verification.ts:assertEmailVerified(userId)` — throws `EmailNotVerifiedError` on null email_verified.
- Extended `lib/ai/route-guards.ts:guardAiRoute()` to call `assertEmailVerified` after `assertWithinDailyCap`, mapping the error to a 403 response with structured body (`{ error: "email_not_verified", recoveryUrl: "/app/dashboard" }`).
- All 10 AI route handlers (`/api/ai/{chat,summarize,translate,ocr,rewrite,table,compare,sign,redact,generate}`) inherit the gate via the existing `guardAiRoute` call — no per-route changes needed (the file's header comment foreshadowed exactly this extension pattern at line 12-15).

**Behind a feature flag** (`EMAIL_VERIFICATION_GATE=on`) — graceful staging rollout. Default OFF. Operator opts in once the resend UI has been live + monitored for SMTP-failure false positives for ~1 week. Once stable, flip to ON.

**Free non-AI tools (merge, split, rotate, etc.) remain accessible** to unverified users. The gate is scoped to AI ops only — the lockout matches the existing "unverified means no signup-bonus credits" semantics.

## Gap #4 — SMTP fail-open ✅ SHIPPED 2026-05-06 (recovery path)

**Old state:** the verification email is sent fire-and-forget via a microtask in `registerAction`. SMTP failure is logged but doesn't block signup. The user lands on `/app/dashboard` with 0 credits, no email arrives, no obvious next step. Real UX gap — surfaced as support tickets in production.

**Closed by this commit:** the `<UnverifiedEmailBanner />` from gap #2 is also the recovery surface for SMTP fail-open. Even if the original send silently failed, the banner is rendered for any unverified user, with a Resend button that re-fires the send via `resendVerificationEmail`. The banner stays visible until `users.email_verified` is set, at which point the server-component render path drops it on next page load.

**The banner mentions the address explicitly** (`We sent a verification link to <code>{email}</code>`) so the user can confirm whether the email they signed up with matches what they expected — catches typo'd emails (e.g. `alic@gmail.com` instead of `alice`) without an additional flow.

## Validation

- `npx tsc --noEmit` — clean
- All existing CI guards still pass (no behavior change for verified users)
- New code paths are feature-flagged (`EMAIL_VERIFICATION_GATE`) so gap #3 doesn't accidentally lock out users when deployed before the resend UI is exercised in production
