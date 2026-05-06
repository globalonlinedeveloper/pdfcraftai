// app/admin/evals/[op]/[providerId]/[model]/page.tsx — Phase G-2
// drilldown view for a single (operation × providerId × model)
// combo (PENDING §6a, 2026-05-06).
//
// Surfaces all eval_human_grades rows for the combo across all
// golden-set fixtures, with per-grade notes + ai_output_excerpt
// in expanded view. Used by ops to investigate WHY a combo's
// overall average dropped below HUMAN_GRADE_FLOOR (the parent
// /admin/evals page renders red on combos below the floor; this
// page is the drilldown that shows the actual feedback).
//
// Read-only by design — no actions, no mutation, no admin grants.
// Pure observability surface.

import Link from "next/link";

import { requireAdmin } from "@/lib/admin/guard";
import {
  HUMAN_GRADE_FLOOR,
  loadGradesForOpCombo,
} from "@/lib/ai/eval/human-grades";
import { SectionTitle, Td, Th, tableStyle } from "@/components/admin/ui";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Params {
  op: string;
  providerId: string;
  model: string;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ") + " UTC";
}

function fmtScore(n: number): string {
  return n.toFixed(2);
}

function shortUser(userId: string): string {
  if (userId.length <= 16) return userId;
  return `${userId.slice(0, 8)}…${userId.slice(-4)}`;
}

function scoreColor(avg: number): string {
  if (avg < HUMAN_GRADE_FLOOR) return "#c00";
  if (avg < 4.0) return "var(--fg)";
  return "#4caf50";
}

export default async function AdminEvalsDrilldownPage({
  params,
}: {
  params: Params;
}) {
  await requireAdmin();
  // Next.js URL-decodes params, but we re-trim defensively in case
  // a URL-encoded value comes in with whitespace.
  const op = decodeURIComponent(params.op).trim();
  const providerId = decodeURIComponent(params.providerId).trim();
  const model = decodeURIComponent(params.model).trim();

  const grades = await loadGradesForOpCombo(op, providerId, model, 500);

  // Compute combo-level averages from the result set so the page
  // is self-contained (doesn't need to re-query loadPerOpAverages).
  // Floors at 0/0/0/0 when grades is empty.
  const n = grades.length;
  const sum = grades.reduce(
    (acc, r) => ({
      relevance: acc.relevance + r.scoreRelevance,
      completeness: acc.completeness + r.scoreCompleteness,
      faithfulness: acc.faithfulness + r.scoreFaithfulness,
      actionability: acc.actionability + r.scoreActionability,
    }),
    { relevance: 0, completeness: 0, faithfulness: 0, actionability: 0 },
  );
  const avg = n > 0
    ? {
        relevance: sum.relevance / n,
        completeness: sum.completeness / n,
        faithfulness: sum.faithfulness / n,
        actionability: sum.actionability / n,
        overall:
          (sum.relevance + sum.completeness + sum.faithfulness +
            sum.actionability) /
          (4 * n),
      }
    : null;

  // Group by goldenSetId so the table reads "fixture, then chronologically
  // within the fixture" — easier to spot per-fixture regression.
  const byFixture = new Map<string, typeof grades>();
  for (const g of grades) {
    const list = byFixture.get(g.goldenSetId) ?? [];
    list.push(g);
    byFixture.set(g.goldenSetId, list);
  }

  return (
    <div>
      <header style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, marginBottom: 8 }}>
          <Link href="/admin/evals" style={{ color: "var(--accent)" }}>
            ← All evals
          </Link>
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>
          <code style={{ fontSize: 22 }}>
            {op} · {providerId} · {model}
          </code>
        </h1>
        <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>
          {n} grade{n === 1 ? "" : "s"} across {byFixture.size} fixture
          {byFixture.size === 1 ? "" : "s"}. Threshold floor:{" "}
          <strong>{HUMAN_GRADE_FLOOR.toFixed(1)}</strong> overall
          average.
        </p>
      </header>

      {/* Combo averages */}
      {avg ? (
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 12,
            marginBottom: 24,
          }}
        >
          {(
            [
              ["Relevance", avg.relevance],
              ["Completeness", avg.completeness],
              ["Faithfulness", avg.faithfulness],
              ["Actionability", avg.actionability],
              ["Overall", avg.overall],
            ] as Array<[string, number]>
          ).map(([label, value]) => (
            <div key={label} className="card" style={{ padding: 16 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                {label}
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color:
                    label === "Overall" ? scoreColor(value) : "var(--fg)",
                }}
              >
                {fmtScore(value)}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {n === 0 ? (
        <p
          className="muted"
          style={{
            padding: "12px 16px",
            background: "var(--bg-2)",
            borderRadius: 6,
          }}
        >
          No grades for this combo yet. Check the parent{" "}
          <code>/admin/evals</code> table — this drilldown is reachable
          only from rows that have at least one grade in the lookback
          window, so a stale URL might land here after retention
          pruning.
        </p>
      ) : (
        Array.from(byFixture.entries()).map(([fixtureId, fixtureGrades]) => (
          <section key={fixtureId} style={{ marginBottom: 24 }}>
            <SectionTitle>
              Fixture: <code>{fixtureId}</code> ({fixtureGrades.length})
            </SectionTitle>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Grader</Th>
                  <Th>R</Th>
                  <Th>C</Th>
                  <Th>F</Th>
                  <Th>A</Th>
                  <Th>Notes</Th>
                </tr>
              </thead>
              <tbody>
                {fixtureGrades.map((g) => (
                  <tr key={g.id}>
                    <Td>
                      <span
                        style={{ fontSize: 11, color: "var(--fg-subtle)" }}
                      >
                        {fmtDate(g.createdAt)}
                      </span>
                    </Td>
                    <Td>
                      <code style={{ fontSize: 12 }}>
                        {shortUser(g.graderUserId)}
                      </code>
                    </Td>
                    <Td>{g.scoreRelevance}</Td>
                    <Td>{g.scoreCompleteness}</Td>
                    <Td>{g.scoreFaithfulness}</Td>
                    <Td>{g.scoreActionability}</Td>
                    <Td>
                      {g.notes ? (
                        <span style={{ fontSize: 12, lineHeight: 1.5 }}>
                          {g.notes}
                        </span>
                      ) : (
                        <span
                          className="muted"
                          style={{ fontSize: 11, fontStyle: "italic" }}
                        >
                          (no notes)
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </div>
  );
}
