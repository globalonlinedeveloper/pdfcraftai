// Client-side refund button.
//
// Shown on /app/billing next to each captured payment. The server
// (BillingPage) has already run eligibility and passes us a pre-computed
// summary of how many credits/$ would be refunded — we don't need to
// re-check client-side, but we DO re-check inside the server action as
// a defense (TOCTOU: eligibility can change between page render and the
// click — user might spend credits, or the 14-day window might tick).
//
// UX shape:
//   1. Button label reflects amount ("Refund $3.50 / 70 credits").
//   2. On click, open a small inline confirmation block (no modal
//      library — this page is otherwise dependency-free). One more
//      click confirms.
//   3. On confirm → call the refund server action. While pending, the
//      button disables and the label flips to "Refunding…".
//   4. On success: show a green confirmation and let the user know the
//      balance/payment row will update shortly (webhook-driven).
//   5. On error: inline red text, button re-enables so the user can
//      retry.
//
// Why no router.refresh() on success: the server action already calls
// revalidatePath("/app/billing"), which re-runs the page on the next
// tick. But since the actual status flip happens on webhook arrival
// (seconds later), a refresh now would show "Paid" still — we'd rather
// the user see the "Refund requested" inline state and let the page
// naturally update when they navigate back.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestRefundAction } from "@/lib/payments/refund-actions";

type Props = {
  paymentId: string;
  refundableCredits: number;
  refundAmountMinor: number;
  currency: string;
  /** Helpful for the confirmation copy. */
  totalPackCredits: number;
  /** ISO string of when the 14-day window closes. */
  expiresAt: string;
};

export function RefundButton({
  paymentId,
  refundableCredits,
  refundAmountMinor,
  currency,
  totalPackCredits,
  expiresAt,
}: Props) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "confirm" | "pending" | "done">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);

  const isPartial = refundableCredits < totalPackCredits;
  const prettyAmount =
    currency === "USD"
      ? `$${(refundAmountMinor / 100).toFixed(2)}`
      : `${(refundAmountMinor / 100).toFixed(2)} ${currency}`;

  const daysRemaining = Math.max(
    0,
    Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  );

  const handleConfirm = async () => {
    setError(null);
    setState("pending");
    try {
      const result = await requestRefundAction(paymentId);
      if (!result.ok) {
        setError(result.message);
        setState("idle");
        return;
      }
      setState("done");
      // Nudge Next to re-read server data a moment later. The webhook
      // usually lands within a few seconds; this refresh gives the user
      // the payment-row flip without them having to reload manually.
      setTimeout(() => router.refresh(), 5000);
    } catch (err) {
      console.error("[refund-button]", err);
      setError(
        "Something went wrong requesting the refund. Please try again."
      );
      setState("idle");
    }
  };

  if (state === "done") {
    return (
      <span
        style={{
          fontSize: 12,
          color: "var(--accent)",
        }}
      >
        Refund requested · balance updates shortly
      </span>
    );
  }

  if (state === "confirm") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          alignItems: "flex-end",
        }}
      >
        <div
          className="muted"
          style={{ fontSize: 11, textAlign: "right", maxWidth: 220 }}
        >
          Refund {prettyAmount} for {refundableCredits.toLocaleString()}{" "}
          unused credit{refundableCredits === 1 ? "" : "s"}
          {isPartial ? " (partial)" : ""}?
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setState("idle")}
            disabled={false}
            style={{ fontSize: 12, padding: "4px 10px" }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={handleConfirm}
            style={{ fontSize: 12, padding: "4px 10px" }}
          >
            Confirm refund
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        alignItems: "flex-end",
      }}
    >
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => setState("confirm")}
        disabled={state === "pending"}
        style={{ fontSize: 12, padding: "4px 10px" }}
      >
        {state === "pending" ? "Refunding…" : `Refund ${prettyAmount}`}
      </button>
      {daysRemaining > 0 && daysRemaining <= 3 && (
        <span
          className="muted"
          style={{ fontSize: 10 }}
        >
          {daysRemaining} day{daysRemaining === 1 ? "" : "s"} left
        </span>
      )}
      {error && (
        <span
          role="alert"
          style={{
            fontSize: 11,
            color: "var(--danger, #c00)",
            textAlign: "right",
            maxWidth: 220,
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
