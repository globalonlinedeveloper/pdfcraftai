// Razorpay webhook endpoint.
// Configure in Razorpay dashboard → Settings → Webhooks with URL
// https://pdfcraftai.com/api/webhooks/razorpay and RAZORPAY_WEBHOOK_SECRET.

import { handleWebhook } from "@/lib/payments/webhook-handler";

// Never cache — every webhook is unique.
export const dynamic = "force-dynamic";
// Next.js 14: opt out of Node.js native body parsing. Route handlers
// don't auto-parse body anyway, but being explicit guards future defaults.
export const runtime = "nodejs";

export async function POST(req: Request) {
  return handleWebhook(req, {
    providerId: "razorpay",
    extractEventId: ({ headers }) => headers["x-razorpay-event-id"] ?? null,
  });
}
