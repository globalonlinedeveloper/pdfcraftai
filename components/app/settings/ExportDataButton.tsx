// 2026-05-08 — item #25 from the improvement analysis. Surfaces
// the existing /api/account/export endpoint with a UI button so
// users can actually exercise their DPDP Act §11 right of access.
// Without this affordance the endpoint was reachable only by
// crafting the URL by hand — not a meaningful "right".
//
// Pairs with the DeleteAccountForm in the Danger zone: users see
// "Export my data" first, then "Delete my account" below — DPDP §11
// (right to access) precedes §12 (right to erasure) so users can
// download a copy of their data before destroying it.
//
// Why a fetch-and-download flow rather than a direct <a href> Link:
//   - The endpoint is auth-gated (server-side session check); a
//     <a href> would work today but the explicit fetch surfaces
//     errors (auth expired, server hiccup) inline rather than a
//     hard navigation away to a JSON page.
//   - Lets us set a friendlier filename via the download attribute
//     (date-stamped) rather than the endpoint's default.

"use client";

import { useState } from "react";
import { I } from "@/components/icons/Icons";

export function ExportDataButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/export", {
        method: "GET",
        credentials: "same-origin",
      });
      if (!res.ok) {
        // The endpoint returns 401 on missing auth and 500 on a
        // server hiccup. Surface either as a user-friendly inline
        // error rather than the raw status.
        if (res.status === 401) {
          setError("Sign in expired — refresh and try again.");
        } else {
          setError(`Export failed (status ${res.status}). Try again or contact support.`);
        }
        return;
      }
      const blob = await res.blob();
      // Filename: pdfcraftai-account-export-YYYY-MM-DD.json. Date-
      // stamping helps users keep multiple snapshots straight if
      // they export periodically.
      const date = new Date().toISOString().slice(0, 10);
      const filename = `pdfcraftai-account-export-${date}.json`;
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        setDownloaded(true);
        setTimeout(() => setDownloaded(false), 2400);
      } finally {
        // Always revoke — leaking blob URLs accumulates in long-
        // lived tabs. M6 audit catches this globally; pinned local
        // shape too.
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("[ExportDataButton] fetch failed", err);
      setError("Network error — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="muted" style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 14 }}>
        Download a JSON copy of every record we hold against your
        account: profile, credit history, AI usage, file metadata,
        payments. Per DPDP Act §11 right of access. We recommend
        running this <strong>before</strong> deleting your account —
        once deletion completes the data is unrecoverable.
      </p>
      <button
        type="button"
        onClick={handleExport}
        disabled={busy}
        aria-busy={busy}
        className="btn btn-sm"
        style={{ gap: 6, color: "var(--fg-muted)" }}
      >
        <I.Download size={13} />
        {downloaded ? "Downloaded" : busy ? "Preparing…" : "Export my data"}
      </button>
      {error ? (
        <p
          role="alert"
          style={{
            color: "var(--red)",
            fontSize: 13,
            marginTop: 10,
          }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
