// app/admin/evals/grade/page.tsx — Human eval grader form (PENDING
// §6a Phase G partial, 2026-05-05).
//
// Pairs with /api/admin/evals/grade (the POST handler shipped
// earlier this session). Operator submits a Likert grade; the form
// POSTs to the route; the route calls recordHumanGrade or
// replaceGrade.
//
// Scope decision (v1)
// -------------------
// This is the BASIC grader form — text inputs for fixture
// metadata + 4 Likert sliders + notes textarea. The original Phase
// G spec called for "golden-set fixture + AI output side-by-side"
// which would require:
//   - A dropdown of valid fixture ids (read from
//     lib/ai/eval/golden-set.ts)
//   - A "regenerate output now" button that calls route(op,…) and
//     shows the live AI output for grading
// Both are bigger builds. v1 is intentionally minimal: operators
// run scripts/run-ai-evals.mjs separately, then come here to enter
// the score. The richer side-by-side flow is a future enhancement.

import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin/guard";
import { GraderForm } from "./GraderForm";

export const metadata: Metadata = {
  title: "Grade AI eval",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function GradePage() {
  await requireAdmin();
  return (
    <div>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>
          Enter human grade
        </h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Submit a Likert score (1-5) on a (provider × model × op ×
          fixture) tuple. Posts to{" "}
          <code>/api/admin/evals/grade</code>. Returns to{" "}
          <code>/admin/evals</code> on success.
        </p>
      </header>
      <GraderForm />
    </div>
  );
}
