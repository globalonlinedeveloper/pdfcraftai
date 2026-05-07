// app/admin/evals/grade-pairwise/page.tsx — Phase G-2 final
// side-by-side comparison grader (PENDING §6a, 2026-05-07).
//
// Pairs with /admin/evals/grade (single-output Likert grader).
// This page captures preference between TWO outputs from
// different (provider × model) configs on the same op + fixture.
//
// URL params (all optional — defaults to a blank form the
// admin fills in):
//   ?op=summarize
//   &fixtureId=blog-post-long
//   &leftProviderId=anthropic&leftModel=claude-haiku-4-5
//   &rightProviderId=openai&rightModel=gpt-4o-mini
//
// The grader pastes both outputs into the form, picks a
// preference (left wins / right wins / tie / both bad), and
// optionally adds absolute Likert scores + notes.

import type { Metadata } from "next";

import { auth } from "@/auth";
import { requireAdmin } from "@/lib/admin/guard";
import { PairwiseGraderForm } from "./PairwiseGraderForm";

export const metadata: Metadata = {
  title: "Grade pairwise (side-by-side)",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SearchParams {
  op?: string;
  fixtureId?: string;
  leftProviderId?: string;
  leftModel?: string;
  rightProviderId?: string;
  rightModel?: string;
}

export default async function GradePairwisePage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  await requireAdmin();
  // Pull session userId for the form's anti-impersonation pin
  // (the form posts without userId; the route reads it from
  // session). We don't use it on the page render but auth() is
  // already cached by requireAdmin so this is essentially free.
  await auth();

  const initial = {
    op: searchParams?.op ?? "",
    fixtureId: searchParams?.fixtureId ?? "",
    leftProviderId: searchParams?.leftProviderId ?? "",
    leftModel: searchParams?.leftModel ?? "",
    rightProviderId: searchParams?.rightProviderId ?? "",
    rightModel: searchParams?.rightModel ?? "",
  };

  return (
    <div>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>
          Pairwise grade — side-by-side
        </h1>
        <p className="muted" style={{ marginTop: 4, lineHeight: 1.5 }}>
          Compare TWO outputs from different (provider × model)
          configs on the same op + fixture. Pick a preference + (optional)
          absolute Likert scores. Posts to{" "}
          <code>/api/admin/evals/grade-pairwise</code>. Pair is
          alphabetically canonicalized at write time so (A vs B) and
          (B vs A) end up as the same row.
        </p>
      </header>
      <PairwiseGraderForm initial={initial} />
    </div>
  );
}
