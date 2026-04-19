// PayPal webhook endpoint.
// Configure in PayPal developer dashboard → your app → Webhooks with URL
// https://pdfcraftai.com/api/webhooks/paypal. The webhook ID PayPal
// generates goes into PAYPAL_WEBHOOK_ID so we can echo it back when
// asking PayPal to verify each event.

import { handleWebhook } from "@/lib/payments/webhook-handler";

// Never cache — every webhook is unique.
export const dynamic = "force-dynamic";
// PayPal verification needs to hit their API; Node runtime is required.
export const runtime = "nodejs";

export async function POST(req: Request) {
  return handleWebhook(req, {
    providerId: "paypal",
    // PayPal event IDs live in the body, not headers.
    extractEventId: ({ parsedBody }) => {
      if (
        parsedBody &&
        typeof parsedBody === "object" &&
        "id" in parsedBody &&
        typeof (parsedBody as { id: unknown }).id === "string"
      ) {
        return (parsedBody as { id: string }).id;
      }
      return null;
    },
  });
}
