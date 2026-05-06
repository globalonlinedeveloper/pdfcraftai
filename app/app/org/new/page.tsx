// app/app/org/new/page.tsx — Create-organization page (PENDING §3b
// Phase F-2 partial, 2026-05-05).
//
// Form-based creation flow: signed-in user enters an org name +
// optional billing-mode selection, submits, the Server Action calls
// `lib/orgs/writers.ts:recordOrgCreate`, redirects to the new org's
// page on success.
//
// MULTI_SEAT-gated: when the flag is off, recordOrgCreate returns
// null and the page surfaces "team plan rolling out — check back"
// copy. The flag check happens both at render time (to render the
// disabled banner) AND inside recordOrgCreate (the load-bearing
// guard — UI flag check is just for cleaner UX).
//
// What this page does NOT do (deferred Phase F-2 follow-on)
// ---------------------------------------------------------
// - Show a list of orgs the user already belongs to. /app/dashboard
//   has the "Refer" StatCard from §3e Phase E; a similar
//   "Organizations" StatCard would wire here once orgs exist.
// - Per-org settings (rename / change billing mode / delete org).
//   Phase F-2 part 2 builds /app/org/<slug>/settings.
// - Member directory + invite UI on the new org's landing page.
//   Phase F-2 part 2 builds /app/org/<slug>.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { isMultiSeatEnabled } from "@/lib/orgs/queries";
import { CreateOrgForm } from "./CreateOrgForm";

export const metadata: Metadata = {
  title: "Create an organization",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function CreateOrgPage() {
  const session = await auth();
  const userId = session?.user
    ? (session.user as { id?: string }).id
    : undefined;
  if (typeof userId !== "string") {
    redirect("/login?callbackUrl=%2Fapp%2Forg%2Fnew");
  }

  const enabled = isMultiSeatEnabled(userId);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        maxWidth: 720,
      }}
    >
      <header>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          ORGANIZATION
        </div>
        <h1 style={{ fontSize: 28, letterSpacing: "-0.02em", margin: 0 }}>
          Create an organization
        </h1>
        <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
          {enabled
            ? "Set up a team account. You'll be the owner — invite members from the org settings page after you create it."
            : "We're still rolling out the team plan. The form below is the future create-org flow; flag activation is operator-side."}
        </p>
      </header>

      {!enabled ? (
        <div
          role="status"
          className="card"
          style={{
            padding: "10px 14px",
            borderColor: "#f57c00",
            background: "color-mix(in oklab, #f57c00 8%, transparent)",
            fontSize: 13,
            color: "#f57c00",
          }}
        >
          <strong>Beta:</strong> the team plan is staged but not yet
          live. Submitting the form below will not yet create a real
          organization — it&rsquo;ll surface a friendly &ldquo;not
          available&rdquo; notice. When we activate the flag, this page
          becomes live with no UI change.
        </div>
      ) : null}

      <CreateOrgForm />
    </div>
  );
}
