// Server actions for the checkout UI.
//
// Responsibilities split between this file and the provider adapters:
//   - This file: owns the DB lifecycle of a `payments` row. Mints the
//     internal UUID, writes "pending" state, attaches the providerRef
//     returned by the adapter, and hands the browser-safe `CheckoutSession`
//     back to the React client.
//   - Adapters: own the provider-side call. They never write to our DB —
//     the webhook + reconciliation path is what promotes a row from
//     "pending" to "captured".
//
// Why a server action (not a route handler)?
//   - Server actions give us built-in CSRF protection and inline form
//     semantics, which is exactly what a "Buy pack" button needs.
//   - The return value is a plain JS object — we can send the
//     `CheckoutSession` back to the client component without serializing
//     through JSON headers or building our own envelope.
//
// Security:
//   - Auth is enforced inside the action, not at the Next.js middleware
//     layer, because /pricing is a public marketing page. Anonymous users
//     clicking "Buy" get redirected to /login?returnTo=/pricing.
//   - `preferredProviderId` is trusted only to the extent that the
//     registry filters it against configured + currency-eligible
//     providers. A hostile client can't force-route through a provider
//     that isn't configured.

"use server";

import { randomUUID } from "crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { CREDIT_PACKS, type CreditPackId } from "@/lib/pricing";
import { selectProvider, listConfiguredProviderIds } from "./registry";
import type { CheckoutSession, ProviderId } from "./types";

// Packs are priced in USD in the UI. If a user's locale ever wants INR
// pricing we swap this per-pack, but for now USD is the single source of
// truth and providers quote the user in their local currency at checkout.
const PACK_CURRENCY = "USD" as const;

export type CreateCheckoutResult =
  | {
      ok: true;
      internalPaymentId: string;
      providerRef: string;
      providerId: ProviderId;
      session: CheckoutSession;
    }
  | {
      ok: false;
      error:
        | "not_authenticated"
        | "unknown_pack"
        | "no_provider_configured"
        | "provider_error";
      message: string;
    };

/**
 * Mint a checkout session for a one-time credit pack.
 *
 * Call flow:
 *   1. Verify the user is signed in. (Anon → /login redirect.)
 *   2. Resolve the pack from CREDIT_PACKS; bail if unknown.
 *   3. Pick a provider via the registry. If `preferredProviderId` is
 *      configured, honor it; otherwise take the first eligible one.
 *   4. INSERT a `payments` row in "pending" with a fresh UUID.
 *   5. Call `provider.createCheckout`. On success, UPDATE the row with
 *      the providerRef. On failure, mark the row "failed" (still useful
 *      for the audit trail — shows attempted-but-not-started checkouts).
 *   6. Return the `CheckoutSession` shape the client component uses to
 *      load the SDK or redirect.
 */
export async function createCheckoutAction(args: {
  packId: CreditPackId;
  preferredProviderId?: ProviderId;
}): Promise<CreateCheckoutResult> {
  const session = await auth();
  const userId = session?.user
    ? (session.user as { id?: string }).id
    : undefined;

  if (!userId) {
    return {
      ok: false,
      error: "not_authenticated",
      message: "Please sign in before purchasing credits.",
    };
  }

  const pack = CREDIT_PACKS.find((p) => p.id === args.packId);
  if (!pack) {
    return {
      ok: false,
      error: "unknown_pack",
      message: `Unknown pack: ${args.packId}`,
    };
  }

  const provider = await selectProvider({
    currency: PACK_CURRENCY,
    mode: "one_time",
    preferredId: args.preferredProviderId,
  });

  if (!provider) {
    return {
      ok: false,
      error: "no_provider_configured",
      message:
        "Checkout is temporarily unavailable. Please try again in a few minutes.",
    };
  }

  // Build return URLs from the current request's origin. `headers()` is
  // the safest way to learn the host Next.js is serving on right now —
  // env overrides would drift between staging and production.
  const origin = resolveOrigin();
  const internalPaymentId = randomUUID();

  // Step 4: pre-insert the pending row. We want this to exist BEFORE we
  // call the provider so that if the provider call succeeds but our DB
  // write fails afterward, reconciliation can still identify the payment
  // by its internal ID echoed in provider metadata.
  await db.insert(schema.payments).values({
    id: internalPaymentId,
    userId,
    providerId: provider.id,
    providerRef: null,
    mode: "one_time",
    status: "pending",
    amountMinor: pack.price * 100,
    currency: PACK_CURRENCY,
    packId: pack.id,
    planCode: null,
    subscriptionId: null,
    metadata: {
      initiatedFrom: "pricing_page",
      preferredProviderId: args.preferredProviderId ?? null,
    },
  });

  try {
    // Step 5: ask the adapter for a checkout handle.
    const result = await provider.createCheckout({
      mode: "one_time",
      internalPaymentId,
      userId,
      packId: pack.id,
      amount: { amountMinor: pack.price * 100, currency: PACK_CURRENCY },
      returnUrl: `${origin}/app/billing?status=success&id=${internalPaymentId}`,
      cancelUrl: `${origin}/pricing?status=cancelled&id=${internalPaymentId}`,
      metadata: {
        internalPaymentId,
        packId: pack.id,
        userId,
      },
    });

    // Attach the providerRef so the webhook handler can look us up later.
    await db
      .update(schema.payments)
      .set({ providerRef: result.providerRef })
      .where(eq(schema.payments.id, internalPaymentId));

    return {
      ok: true,
      internalPaymentId,
      providerRef: result.providerRef,
      providerId: provider.id,
      session: result.session,
    };
  } catch (err) {
    // Adapter failure — mark the row failed so billing audits can see
    // we attempted and why. We don't swallow the details internally (the
    // exception bubbles to server logs) but we do sanitize for the client
    // response — providers sometimes include tokens or PII in errors.
    await db
      .update(schema.payments)
      .set({
        status: "failed",
        metadata: {
          initiatedFrom: "pricing_page",
          error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
        },
      })
      .where(eq(schema.payments.id, internalPaymentId));

    console.error("[checkout] createCheckout failed:", err);
    return {
      ok: false,
      error: "provider_error",
      message:
        "We couldn't start checkout with that provider. Please try another option.",
    };
  }
}

/**
 * Server action invoked by anonymous users clicking a Buy button. We
 * route them to /login with a returnTo so they land back on /pricing
 * after signing in.
 */
export async function redirectToSignIn(returnTo: string): Promise<never> {
  const sanitized =
    returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/pricing";
  redirect(`/login?returnTo=${encodeURIComponent(sanitized)}`);
}

/**
 * Exposed for the UI so the pricing page can render provider chooser
 * buttons only for providers that are actually configured. Wrapping
 * listConfiguredProviderIds in a server action lets client components
 * call it without pulling the registry into their bundle.
 */
export async function getConfiguredProviderIds(): Promise<ProviderId[]> {
  return listConfiguredProviderIds();
}

function resolveOrigin(): string {
  // Next.js 14: `headers()` returns a read-only store — host + proto
  // tell us the origin Hostinger is currently serving on. Falls back to
  // NEXT_PUBLIC_SITE_URL for local dev where the forwarded-proto header
  // is sometimes missing.
  const h = headers();
  const host = h.get("host");
  const proto =
    h.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");
  if (host) return `${proto}://${host}`;
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://pdfcraftai.com";
}
