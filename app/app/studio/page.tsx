// /app/studio — Phase 6.2 batch runner + Phase 6.3 Smart (agent) mode.
//
// Lightweight server shell for the two runner surfaces. The surrounding
// AppShell layout already enforces auth (redirect to /login if no
// session); we re-check here only to silence the TS `session.user`
// narrowing that the runners don't actually need — the per-request POST
// to /api/ai/<tool> (Batch) and the agent's create/approve server
// actions (Smart) are the real auth boundaries.
//
// Balance isn't pre-fetched on this page:
//   - Batch's per-file 402 handling already surfaces insufficient-credit
//     errors with current balance + required amount embedded in each
//     route's JSON response.
//   - Smart shows the planner's total quote in its approval card and
//     hits a 402 on approveRunAction if balance drops below the quote
//     between plan and approve. Both paths link out to /app/billing so
//     pre-fetching would be a second round-trip for nothing.
//
// The mode toggle (Batch ↔ Smart) is owned by `StudioModeSwitcher`, a
// thin client component that keeps both runners mounted and toggles
// visibility — preserving each side's local state (file queue, in-flight
// plan) across switches.

import type { Metadata } from "next";
import Link from "next/link";

import { auth } from "@/auth";
import { redirect } from "next/navigation";

import { StudioModeSwitcher } from "@/components/studio/StudioModeSwitcher";

export const metadata: Metadata = {
  title: "Studio",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const session = await auth();
  if (!session?.user) {
    // Defensive — AppShell already redirects anonymous users, but the
    // runners' macro actions require a userId server-side and we don't
    // want to render the UI for a half-authed state.
    redirect("/login");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 960 }}>
      <header>
        <div className="eyebrow" style={{ marginBottom: 6 }}>STUDIO</div>
        <h1 style={{ fontSize: 32, letterSpacing: "-0.025em", margin: 0 }}>
          Studio
        </h1>
        <p className="muted" style={{ fontSize: 15, marginTop: 6 }}>
          Two ways to work: <strong>Batch</strong> runs one tool across up to
          25 PDFs, and <strong>Smart</strong> takes a plain-English
          description and plans a multi-step run for you. Files process one
          at a time, credits are charged per step, and retries don&apos;t
          double-charge.
          <span style={{ marginLeft: 6 }}>
            <Link href="/app/billing" className="subtle" style={{ textDecoration: "underline" }}>
              Top up credits
            </Link>
          </span>
        </p>
      </header>

      <StudioModeSwitcher />
    </div>
  );
}
