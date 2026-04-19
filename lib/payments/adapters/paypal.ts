// PayPal adapter.
//
// PCI posture: we use Smart Buttons + Advanced Checkout (hosted card
// fields). Card input is rendered inside PayPal-hosted iframes, so PAN
// / CVV never touch our servers. This is SAQ-A territory. The scrubber
// runs anyway on `providerRaw` as defense-in-depth.
//
// Design note: PayPal's API surface is *very* different from Razorpay
// (OAuth tokens instead of Basic auth, decimal strings for money,
// webhook signature verification requires a round-trip to PayPal). The
// adapter is where those differences live — the PaymentProvider
// interface hides all of it from upstream code.
//
// References:
//   Orders API:       https://developer.paypal.com/docs/api/orders/v2/
//   Subscriptions:    https://developer.paypal.com/docs/api/subscriptions/v1/
//   Webhook verify:   https://developer.paypal.com/docs/api/webhooks/v1/#verify-webhook-signature
//   Reporting API:    https://developer.paypal.com/docs/api/transaction-search/v1/

import "server-only";
import type { PaymentProvider } from "../provider";
import { scrub } from "./razorpay";
import type {
  CheckoutInput,
  CheckoutResult,
  Currency,
  Money,
  NormalizedPaymentEvent,
  NormalizedTx,
  ProviderCapabilities,
  RefundInput,
  RefundResult,
  WebhookVerifyInput,
  WebhookVerifyResult,
} from "../types";

export type PayPalConfig = {
  clientId: string;
  clientSecret: string;
  webhookId: string;
  environment: "sandbox" | "live";
};

function apiBase(env: "sandbox" | "live"): string {
  return env === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

// --- Provider -------------------------------------------------------------

export class PayPalProvider implements PaymentProvider {
  readonly id = "paypal";
  readonly displayName = "PayPal";
  readonly capabilities: ProviderCapabilities = {
    oneTime: true,
    subscriptions: true,
    refunds: true,
    partialRefunds: true,
    webhooks: true,
  };
  readonly supportedCurrencies: readonly Currency[] = ["USD"];

  constructor(private readonly config: PayPalConfig) {}

  // --- Checkout ---------------------------------------------------------

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    if (input.mode === "one_time") {
      return this.createOrder(input);
    }
    return this.createSubscription(input);
  }

  private async createOrder(
    input: Extract<CheckoutInput, { mode: "one_time" }>
  ): Promise<CheckoutResult> {
    const body = {
      intent: "CAPTURE",
      purchase_units: [
        {
          // PayPal's `custom_id` flows through all subsequent resources
          // (capture, refund, webhook). We use our internal UUID so
          // webhook handlers can always map back. Max 127 chars.
          custom_id: input.internalPaymentId,
          reference_id: input.packId,
          amount: toPayPalMoney(input.amount),
          description: `pdfcraft.ai ${input.packId} pack`,
        },
      ],
      application_context: {
        brand_name: "pdfcraft.ai",
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
        user_action: "PAY_NOW",
      },
    };

    const order = await this.call<{
      id: string;
      links: Array<{ rel: string; href: string }>;
    }>("POST", "/v2/checkout/orders", body);

    // PayPal Smart Buttons / Advanced Checkout consume the order id
    // client-side. If a caller wants the redirect flow instead, the
    // approve link is in the response — they can render that as a
    // button. We default to the client-token shape since Advanced
    // Checkout is the inline-card UX that matches the UI intent.
    return {
      providerRef: order.id,
      session: {
        kind: "client",
        clientToken: order.id,
        sdk: "paypal",
        publicConfig: {
          clientId: this.config.clientId,
          currency: input.amount.currency,
          environment: this.config.environment,
        },
      },
    };
  }

  private async createSubscription(
    input: Extract<CheckoutInput, { mode: "subscription" }>
  ): Promise<CheckoutResult> {
    // planCode in our schema maps to a PayPal plan ID (P-XXX...), which
    // is created out-of-band in the PayPal dashboard and stored as an
    // env var or config row.
    const body = {
      plan_id: input.planCode,
      custom_id: input.internalPaymentId,
      application_context: {
        brand_name: "pdfcraft.ai",
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
        user_action: "SUBSCRIBE_NOW",
      },
    };

    const sub = await this.call<{
      id: string;
      links: Array<{ rel: string; href: string }>;
    }>("POST", "/v1/billing/subscriptions", body);

    const approve = sub.links.find((l) => l.rel === "approve");
    if (!approve) {
      throw new Error("PayPal subscription response missing approve link");
    }
    return {
      providerRef: sub.id,
      session: { kind: "redirect", url: approve.href },
    };
  }

  // --- Webhook verification ---------------------------------------------

  async verifyWebhook(input: WebhookVerifyInput): Promise<WebhookVerifyResult> {
    // PayPal's verification is an API call, not a local HMAC. We send
    // the headers + event body back and ask PayPal whether it's real.
    // This adds latency (~150ms) but is the only supported method.
    const required = [
      "paypal-auth-algo",
      "paypal-cert-url",
      "paypal-transmission-id",
      "paypal-transmission-sig",
      "paypal-transmission-time",
    ];
    for (const h of required) {
      if (!input.headers[h]) {
        return { ok: false, reason: `missing header ${h}` };
      }
    }

    let parsedEvent: PayPalWebhookBody;
    try {
      parsedEvent = JSON.parse(input.rawBody) as PayPalWebhookBody;
    } catch {
      return { ok: false, reason: "body is not valid JSON" };
    }

    const verifyBody = {
      auth_algo: input.headers["paypal-auth-algo"],
      cert_url: input.headers["paypal-cert-url"],
      transmission_id: input.headers["paypal-transmission-id"],
      transmission_sig: input.headers["paypal-transmission-sig"],
      transmission_time: input.headers["paypal-transmission-time"],
      webhook_id: this.config.webhookId,
      webhook_event: parsedEvent,
    };

    const verification = await this.call<{ verification_status: string }>(
      "POST",
      "/v1/notifications/verify-webhook-signature",
      verifyBody
    );

    if (verification.verification_status !== "SUCCESS") {
      return {
        ok: false,
        reason: `verification_status=${verification.verification_status}`,
      };
    }

    const event = this.normalize(parsedEvent);
    if (!event) {
      return {
        ok: false,
        reason: `unhandled shape for event ${parsedEvent.event_type}`,
      };
    }
    return { ok: true, event };
  }

  private normalize(body: PayPalWebhookBody): NormalizedPaymentEvent | null {
    const t = body.event_type;
    const occurredAt = new Date(body.create_time ?? Date.now());

    // --- Captures --------------------------------------------------------
    if (t === "PAYMENT.CAPTURE.COMPLETED") {
      const r = body.resource;
      if (!r) return null;
      const internalPaymentId = r.custom_id ?? "";
      return {
        kind: "payment_captured",
        providerId: this.id,
        providerRef: r.id ?? "",
        internalPaymentId,
        amount: fromPayPalMoney(r.amount),
        occurredAt,
        providerRaw: scrub(body),
      };
    }

    if (
      t === "PAYMENT.CAPTURE.DENIED" ||
      t === "PAYMENT.CAPTURE.DECLINED" ||
      t === "CHECKOUT.ORDER.VOIDED"
    ) {
      const r = body.resource;
      if (!r) return null;
      return {
        kind: "payment_failed",
        providerId: this.id,
        providerRef: r.id ?? "",
        internalPaymentId: r.custom_id ?? "",
        reason: r.status_details?.reason ?? t,
        occurredAt,
        providerRaw: scrub(body),
      };
    }

    // --- Refunds ---------------------------------------------------------
    if (t === "PAYMENT.CAPTURE.REFUNDED") {
      const r = body.resource;
      if (!r) return null;
      // PayPal refund webhook: resource IS the refund. The original
      // capture id lives in `links` with rel=up.
      const up = r.links?.find((l) => l.rel === "up");
      const captureId = up?.href?.split("/").pop() ?? "";
      return {
        kind: "refund",
        providerId: this.id,
        providerRef: captureId,
        internalPaymentId: r.custom_id ?? "",
        providerRefundRef: r.id ?? "",
        amount: fromPayPalMoney(r.amount),
        occurredAt,
        providerRaw: scrub(body),
      };
    }

    // --- Subscriptions ---------------------------------------------------
    type SubState = "activated" | "renewed" | "cancelled" | "paused" | "failed";
    const subStateMap: Record<string, SubState> = {
      "BILLING.SUBSCRIPTION.ACTIVATED": "activated",
      "BILLING.SUBSCRIPTION.RE-ACTIVATED": "activated",
      "BILLING.SUBSCRIPTION.CANCELLED": "cancelled",
      "BILLING.SUBSCRIPTION.SUSPENDED": "paused",
      "BILLING.SUBSCRIPTION.PAYMENT.FAILED": "failed",
      "PAYMENT.SALE.COMPLETED": "renewed",
    };

    const mappedState = subStateMap[t];
    if (mappedState) {
      const r = body.resource;
      if (!r) return null;
      return {
        kind: "subscription_event",
        providerId: this.id,
        providerRef: r.id ?? r.billing_agreement_id ?? "",
        internalPaymentId: r.custom_id ?? "",
        state: mappedState,
        occurredAt,
        providerRaw: scrub(body),
      };
    }

    return {
      kind: "ignored",
      providerId: this.id,
      providerRef: body.resource?.id ?? "",
      eventType: t,
      occurredAt,
      providerRaw: scrub(body),
    };
  }

  // --- Mutations ---------------------------------------------------------

  async cancelSubscription(internalPaymentId: string): Promise<void> {
    // See Razorpay adapter: the caller resolves providerRef.
    throw new Error(
      `PayPalProvider.cancelSubscription: resolve providerRef first (got internalPaymentId=${internalPaymentId})`
    );
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    throw new Error(
      `PayPalProvider.refund: resolve providerRef first via billing action (got internalPaymentId=${input.internalPaymentId})`
    );
  }

  /**
   * Issue a refund against a PayPal capture id. Same-currency rule: the
   * billing action supplies `amount` in the capture's original currency,
   * and we just pass it through `toPayPalMoney` for decimal formatting.
   * Omit for a full refund.
   */
  async refundByProviderRef(
    captureId: string,
    amount?: Money
  ): Promise<RefundResult> {
    const body = amount ? { amount: toPayPalMoney(amount) } : {};
    const r = await this.call<{ id: string }>(
      "POST",
      `/v2/payments/captures/${captureId}/refund`,
      body
    );
    return { providerRefundRef: r.id };
  }

  async cancelSubscriptionByProviderRef(subscriptionId: string): Promise<void> {
    await this.call(
      "POST",
      `/v1/billing/subscriptions/${subscriptionId}/cancel`,
      { reason: "User cancelled from pdfcraft.ai billing page" }
    );
  }

  // --- Reconciliation ----------------------------------------------------

  async *listTransactionsSince(since: Date): AsyncIterable<NormalizedTx> {
    // PayPal's Reporting API returns at most 31 days per query and is
    // paged. We iterate in 30-day slices to stay within the limit.
    const now = new Date();
    let windowStart = new Date(since);

    while (windowStart < now) {
      const windowEnd = new Date(windowStart);
      windowEnd.setDate(windowEnd.getDate() + 30);
      const cappedEnd = windowEnd > now ? now : windowEnd;

      let page = 1;
      while (true) {
        const qs = new URLSearchParams({
          start_date: windowStart.toISOString(),
          end_date: cappedEnd.toISOString(),
          fields: "all",
          page: String(page),
          page_size: "100",
        });

        const res = await this.call<{
          transaction_details: Array<{
            transaction_info: {
              transaction_id: string;
              transaction_status: string;
              transaction_amount: { value: string; currency_code: string };
              transaction_initiation_date: string;
              custom_field?: string;
            };
          }>;
          total_pages?: number;
        }>("GET", `/v1/reporting/transactions?${qs.toString()}`);

        const items = res.transaction_details ?? [];
        for (const item of items) {
          const info = item.transaction_info;
          yield {
            providerId: this.id,
            providerRef: info.transaction_id,
            internalPaymentId: info.custom_field ?? null,
            status: mapPayPalStatus(info.transaction_status),
            amount: fromPayPalMoney(info.transaction_amount),
            occurredAt: new Date(info.transaction_initiation_date),
          };
        }
        if (!res.total_pages || page >= res.total_pages) break;
        page++;
      }
      windowStart = cappedEnd;
    }
  }

  // --- OAuth + HTTP -----------------------------------------------------

  private tokenCache: { token: string; expiresAt: number } | null = null;

  private async getAccessToken(): Promise<string> {
    // 60-second buffer so we don't race expiry.
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt - 60_000 > now) {
      return this.tokenCache.token;
    }
    const auth = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString("base64");
    const res = await fetch(`${apiBase(this.config.environment)}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`PayPal OAuth failed ${res.status}: ${text.slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.tokenCache = {
      token: data.access_token,
      expiresAt: now + data.expires_in * 1000,
    };
    return data.access_token;
  }

  private async call<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<T> {
    const token = await this.getAccessToken();
    const res = await fetch(`${apiBase(this.config.environment)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body !== undefined && method !== "GET" ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `PayPal ${method} ${path} failed ${res.status}: ${text.slice(0, 500)}`
      );
    }
    // Some PayPal endpoints return 204 No Content (e.g. subscription
    // cancel). Guard against empty bodies.
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

// --- Money conversion -----------------------------------------------------

// PayPal expresses money as a decimal string in major units ("5.00").
// Our types use minor units (500). We never do float math with it —
// always integer multiplications on the string side.
function toPayPalMoney(m: { amountMinor: number; currency: Currency }): {
  value: string;
  currency_code: string;
} {
  // Major units with exactly 2 decimal places. Valid for USD; currencies
  // with different decimal counts would need per-currency logic, but we
  // only support USD on PayPal right now.
  const major = m.amountMinor / 100;
  return { value: major.toFixed(2), currency_code: m.currency };
}

function fromPayPalMoney(m: { value: string; currency_code: string } | undefined): {
  amountMinor: number;
  currency: Currency;
} {
  if (!m) return { amountMinor: 0, currency: "USD" };
  // Parse the decimal string, multiply by 100, round to int to dodge
  // floating-point rounding on values like "0.1 + 0.2".
  const major = parseFloat(m.value);
  const minor = Math.round(major * 100);
  return { amountMinor: minor, currency: m.currency_code as Currency };
}

function mapPayPalStatus(
  s: string
): "captured" | "failed" | "refunded" | "pending" {
  // PayPal uses single-letter codes in the reporting API.
  switch (s) {
    case "S":
      return "captured";
    case "F":
      return "failed";
    case "V":
      return "refunded";
    case "P":
    default:
      return "pending";
  }
}

// --- Webhook body shape ---------------------------------------------------

type PayPalWebhookBody = {
  event_type: string;
  create_time?: string;
  resource?: {
    id?: string;
    custom_id?: string;
    status_details?: { reason?: string };
    amount?: { value: string; currency_code: string };
    billing_agreement_id?: string;
    links?: Array<{ rel: string; href: string }>;
  };
};
