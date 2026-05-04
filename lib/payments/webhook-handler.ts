// Shared webhook handler — the per-provider route files (e.g.
// app/api/webhooks/razorpay/route.ts) are thin wrappers that call
// `handleWebhook` with a providerId + a function that extracts the
// provider-specific event ID from headers/body.
//
// Response codes follow the industry conventions:
//   200 — delivered / idempotent duplicate / ignored event. Provider
//         treats this as "done, don't retry".
//   400 — signature verification failed or malformed. Provider should
//         NOT retry a bad signature; the problem is config drift on our
//         side, not transient.
//   500 — genuine processing error (DB down, upstream timeout). Provider
//         retries with backoff.
//
// 2026-05-04 (PENDING §11a) — handler-vs-ledger ordering correctness
//
//   Earlier shape: recordWebhookEvent (audit) → applyPaymentEvent
//   (process). On a first-delivery processing failure, the audit row
//   persisted via the standalone insert; the retry then saw recorded:
//   false and returned 200 duplicate WITHOUT re-running the processor.
//   The reconcile sweep covered this within 24h, but it was a real
//   "silent loss for ~24h" bug.
//
//   Current shape: applyPaymentEvent FIRST, then recordWebhookEvent
//   AFTER success. The ledger layer is already idempotent —
//   `applyPaymentEvent` routes every credit-touching path through
//   `grantCredits` with deterministic idempotencyKey
//   (`${paymentId}:base`, `:bonus`, `:refund:${ref}`, etc.) per the
//   contract documented at `lib/payments/ledger.ts:204` — so re-
//   running on retry is correct + safe. We lose handler-level dedup
//   (each retry now redoes the work) but gain correctness on the
//   transient-error path. Cost is bounded: applyPaymentEvent's hot
//   path on a duplicate is a unique-key conflict + early-return, ~ms.
//
//   When applyPaymentEvent throws (genuine DB / network failure), we
//   STILL skip the audit insert. Next retry re-runs processing.
//   When the processor returns "skipped" (ignored event type) or
//   "ok" (real work done), audit row is inserted to mark seen.
//
//   The audit row's UNIQUE on (providerId, providerEventId) still
//   protects against THE SAME EVENT processing twice if the provider
//   retries AFTER a successful first delivery — applyPaymentEvent's
//   ledger-layer idempotency would no-op anyway, but the audit-layer
//   skip saves the round-trip.

import "server-only";
import { getProvider } from "./registry";
import { applyPaymentEvent, recordWebhookEvent } from "./ledger";
import type { ProviderId } from "./types";

export type WebhookHandlerOptions = {
  /**
   * Provider to route the request through. Matches the `id` field on
   * the PaymentProvider instance (e.g. "razorpay").
   */
  providerId: ProviderId;
  /**
   * Extract the provider's event id so we can dedupe in `webhook_events`.
   * Razorpay reads from headers; some providers embed the event id in
   * the body (so the extractor receives both). Return null if no
   * usable id is
   * present — the handler will synthesize one from signature + timestamp
   * so the audit row still lands.
   */
  extractEventId: (args: {
    headers: Record<string, string>;
    parsedBody: unknown;
  }) => string | null;
};

export async function handleWebhook(
  req: Request,
  opts: WebhookHandlerOptions
): Promise<Response> {
  // 1. Read RAW body BEFORE touching req.json(). Signature checks
  //    operate on the exact bytes the provider signed.
  const rawBody = await req.text();

  // 2. Normalize header access — Headers is case-insensitive but our
  //    adapter expects lowercase string keys.
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  // 3. Load the adapter from the env-driven registry.
  const provider = await getProvider(opts.providerId);
  if (!provider) {
    // Env not configured OR unknown provider. 404 so misconfigured
    // webhook URLs surface loudly in the provider dashboard — we
    // shouldn't silently 200 on a provider we can't actually process.
    return new Response(
      JSON.stringify({ error: `provider ${opts.providerId} not configured` }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  // 4. Verify signature. This MUST run on the raw body.
  const verification = await provider.verifyWebhook({
    rawBody,
    headers,
  });

  if (!verification.ok) {
    // Bad signature or malformed — 400 signals the provider this is
    // a client error they shouldn't retry forever.
    return new Response(
      JSON.stringify({ error: "verification_failed", reason: verification.reason }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const event = verification.event;

  // 5. Compute the audit-row identity (providerEventId + label) ahead
  //    of processing. We don't INSERT the audit row yet — that
  //    happens in step 7 after applyPaymentEvent succeeds, per the
  //    PENDING §11a fix documented in this file's header.
  let parsedBody: unknown = null;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    // Shouldn't happen — adapter already parsed it successfully during
    // verification — but defensive.
  }

  const providerEventId =
    opts.extractEventId({ headers, parsedBody }) ??
    // Fallback: synthesize from signature header + timestamp so we at
    // least have *something* unique for the audit dedupe.
    `${headers["x-razorpay-signature"] ?? "unknown"}:${Math.floor(event.occurredAt.getTime() / 1000)}`;

  const eventTypeLabel =
    event.kind === "ignored"
      ? event.eventType
      : event.kind; // for non-ignored, just use our normalized kind

  // 6. Process FIRST. Errors bubble as 500 so the provider retries.
  //    applyPaymentEvent is idempotent at the ledger layer, so a
  //    retry that re-runs it is safe (duplicate-key on the ledger's
  //    idempotency_key returns early without double-granting).
  let result: Awaited<ReturnType<typeof applyPaymentEvent>>;
  try {
    result = await applyPaymentEvent(event);
  } catch (err) {
    // Log to server output — Hostinger surfaces these in the Node.js
    // logs tab. We intentionally DON'T leak the error body to the
    // provider; a generic 500 is enough for them to retry.
    //
    // No audit row was inserted yet, so the next retry re-runs both
    // processing AND the post-process audit insert. This is the fix
    // for the silent-loss bug documented in PENDING §11a.
    console.error(
      `[webhook:${opts.providerId}] applyPaymentEvent threw:`,
      err
    );
    return new Response(
      JSON.stringify({ error: "processing_failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // 7. Audit log — dedupe on (providerId, providerEventId). Inserts
  //    AFTER successful processing so a transient failure on retry
  //    doesn't get short-circuited by a stale audit row. If the
  //    SAME event has already been audited (e.g. provider re-delivered
  //    a successful webhook), we get recorded:false here — which is
  //    correct: the previous delivery's processing already succeeded,
  //    this delivery's processing also succeeded (idempotent no-op
  //    via ledger idempotency_key), audit row stays the original.
  //    The 200 we return either way matches the contract: provider
  //    stops retrying on 200.
  const audit = await recordWebhookEvent({
    providerId: opts.providerId,
    providerEventId,
    eventType: eventTypeLabel,
    normalizedKind: event.kind,
    paymentId: event.kind === "ignored" ? null : event.internalPaymentId || null,
    rawPayload: event.providerRaw,
  });

  return new Response(
    JSON.stringify({
      status: audit.recorded ? "ok" : "duplicate",
      result,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
