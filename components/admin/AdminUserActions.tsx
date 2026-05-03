"use client";

// AdminUserActions — grant + debit credit form (plan §7 + §8 / Gap #5).
//
// Mounted at the top of /admin/users/[id]. Two compact forms side-by-side:
// "Grant credits" and "Debit credits". Each form takes amount + optional
// note, calls the matching server action, and shows a small toast-style
// success/error message inline.
//
// Why useTransition + form action prop
//   Server actions in Next.js 14 work cleanly with useTransition for the
//   loading state. The action result is captured via a wrapper handler
//   so we can render the success/error message — Next's useFormState is
//   the canonical pattern but it requires "useActionState" hooks newer
//   than what's in our React version. The wrapper-with-state approach
//   is forward-compatible and zero-deps.
//
// Why the result message disappears after 5s
//   Admin will click these buttons many times in a row across different
//   users; a stale "+5 credits granted" toast on the next user is
//   confusing. setTimeout cleanup keeps the UI honest.

import { useState, useTransition } from "react";
import {
  adminGrantCredits,
  adminDebitCredits,
  type AdminActionResult,
} from "@/lib/admin/user-actions";

interface Props {
  targetUserId: string;
  /** Current balance, displayed for context. */
  currentBalance: number;
}

export function AdminUserActions({ targetUserId, currentBalance }: Props) {
  const [grantAmount, setGrantAmount] = useState("");
  const [grantNote, setGrantNote] = useState("");
  const [debitAmount, setDebitAmount] = useState("");
  const [debitNote, setDebitNote] = useState("");
  const [result, setResult] = useState<
    | { tone: "good" | "bad"; message: string }
    | null
  >(null);
  const [pending, startTransition] = useTransition();

  function showResult(r: AdminActionResult, verb: "Granted" | "Debited") {
    if (r.ok) {
      setResult({
        tone: "good",
        message: `${verb} ${Math.abs(r.delta)} credits — new balance ${r.newBalance}.`,
      });
      // Optimistic clear of the form on success.
      setGrantAmount("");
      setGrantNote("");
      setDebitAmount("");
      setDebitNote("");
    } else {
      setResult({ tone: "bad", message: r.error });
    }
    // Clear toast after 5s so it doesn't bleed across user pages.
    setTimeout(() => setResult(null), 5000);
  }

  function handleGrant() {
    const amount = Math.floor(Number(grantAmount));
    startTransition(async () => {
      const r = await adminGrantCredits({
        targetUserId,
        amount,
        note: grantNote,
      });
      showResult(r, "Granted");
    });
  }

  function handleDebit() {
    const amount = Math.floor(Number(debitAmount));
    startTransition(async () => {
      const r = await adminDebitCredits({
        targetUserId,
        amount,
        note: debitNote,
      });
      showResult(r, "Debited");
    });
  }

  const inputStyle: React.CSSProperties = {
    padding: "8px 10px",
    fontSize: 13,
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg)",
    color: "var(--fg)",
    width: "100%",
  };

  return (
    <div className="card" style={{ padding: 16 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        {/* Grant form */}
        <form
          action={handleGrant}
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
            Grant credits
          </div>
          <input
            type="number"
            min={1}
            max={1000}
            step={1}
            placeholder="Amount (1–1000)"
            value={grantAmount}
            onChange={(e) => setGrantAmount(e.target.value)}
            disabled={pending}
            style={inputStyle}
          />
          <input
            type="text"
            placeholder="Note (optional, e.g. goodwill credit for outage)"
            value={grantNote}
            onChange={(e) => setGrantNote(e.target.value)}
            disabled={pending}
            maxLength={256}
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={pending || !grantAmount}
            className="btn btn-sm btn-primary"
            style={{ alignSelf: "flex-start" }}
          >
            {pending ? "Working…" : "Grant"}
          </button>
        </form>

        {/* Debit form */}
        <form
          action={handleDebit}
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
            Debit credits
            <span className="muted" style={{ fontWeight: 400, marginLeft: 6 }}>
              (clamped to balance: {currentBalance})
            </span>
          </div>
          <input
            type="number"
            min={1}
            max={Math.min(1000, Math.max(currentBalance, 1))}
            step={1}
            placeholder={`Amount (1–${Math.min(1000, currentBalance)})`}
            value={debitAmount}
            onChange={(e) => setDebitAmount(e.target.value)}
            disabled={pending || currentBalance === 0}
            style={inputStyle}
          />
          <input
            type="text"
            placeholder="Note (optional, e.g. clawback flagged signup bonus)"
            value={debitNote}
            onChange={(e) => setDebitNote(e.target.value)}
            disabled={pending || currentBalance === 0}
            maxLength={256}
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={pending || !debitAmount || currentBalance === 0}
            className="btn btn-sm btn-outline"
            style={{ alignSelf: "flex-start" }}
          >
            {pending ? "Working…" : "Debit"}
          </button>
        </form>
      </div>

      {result && (
        <div
          role="status"
          style={{
            marginTop: 12,
            padding: "8px 12px",
            borderRadius: 6,
            fontSize: 13,
            color: result.tone === "good" ? "var(--green)" : "var(--red)",
            background:
              result.tone === "good"
                ? "color-mix(in oklab, var(--green) 8%, transparent)"
                : "color-mix(in oklab, var(--red) 8%, transparent)",
            border: `1px solid ${
              result.tone === "good" ? "var(--green)" : "var(--red)"
            }`,
          }}
        >
          {result.message}
        </div>
      )}

      <div className="muted" style={{ fontSize: 11, marginTop: 12 }}>
        Both actions write to <code>credit_ledger</code> with reason{" "}
        <code>manual_grant</code> / <code>manual_debit</code>. Audit trail
        captures admin email in the note field. Idempotent on (userId, second-aligned timestamp).
      </div>
    </div>
  );
}
