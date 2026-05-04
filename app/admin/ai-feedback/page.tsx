// app/admin/ai-feedback/page.tsx — AI thumbs ↑/↓ feedback overview.
//
// PENDING_WORK_ANALYSIS.md §6b. The data flywheel surface for AI
// quality. Three sections:
//   1. Summary cards — total feedback, NPS-like balance (up vs.
//      down), top-3 operations by negative feedback
//   2. Per-operation NPS table — every operation that got at least
//      one feedback row, with up/down counts + NPS bps
//   3. Recent thumbs-down rows — the actionable backlog (50 most
//      recent, with reason chip, model, link to the user)
//
// What this page does NOT do (yet)
//   - Mark-as-handled — v1 is read-only, same posture as
//     /admin/contact-submissions and /admin/abuse-signals
//   - Link to the actual AI output (would need a per-output admin
//     viewer; deferred until we see whether reading the markdown
//     content is worth the privacy implications of admin-side access
//     to user-generated AI content)
//   - A/B variant slicing (the prompt registry already attaches
//     prompt_version + experiment_id to ai_usage; future commit can
//     join via ai_usage.id and surface variant NPS here)

import Link from "next/link";
import { sql } from "drizzle-orm";

import { db, schema } from "@/db/client";
import { requireAdmin } from "@/lib/admin/guard";
import {
  DayPicker,
  ErrorBanner,
  SectionTitle,
  Td,
  Th,
  clampDays,
  tableStyle,
} from "@/components/admin/ui";
import {
  formatRelative,
  formatUtcDate,
  maskEmail,
} from "@/lib/admin/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface FeedbackRow {
  id: string;
  userId: string;
  aiUsageId: string | null;
  operation: string;
  verdict: string;
  reason: string | null;
  note: string | null;
  providerId: string | null;
  model: string | null;
  createdAt: Date;
}

interface OpStats {
  operation: string;
  upCount: number;
  downCount: number;
  total: number;
  // Feedback NPS: ((up - down) / total) * 10000 (bps, range
  // -10000..+10000). NOT the marketing "Net Promoter Score" — this
  // is just a balance metric chosen because the bps unit aligns with
  // /admin/margin's other NPS-like columns. -5000 means "twice as
  // many thumbs-down as thumbs-up"; +5000 means the inverse.
  npsBps: number;
}

interface QueryResult {
  rows: FeedbackRow[];
  totalInWindow: number;
  upCount: number;
  downCount: number;
  byOp: OpStats[];
}

async function getFeedback(days: number): Promise<{
  data: QueryResult | null;
  error: string | null;
}> {
  try {
    const windowStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Recent thumbs-down (the actionable backlog).
    const downRowsRaw = await db
      .select()
      .from(schema.aiFeedback)
      .where(sql`${schema.aiFeedback.createdAt} > ${windowStart}
        AND ${schema.aiFeedback.verdict} = 'down'`)
      .orderBy(sql`${schema.aiFeedback.createdAt} DESC`)
      .limit(50);

    const rows: FeedbackRow[] = downRowsRaw.map((r) => ({
      id: r.id,
      userId: r.userId,
      aiUsageId: r.aiUsageId ?? null,
      operation: r.operation,
      verdict: r.verdict,
      reason: r.reason ?? null,
      note: r.note ?? null,
      providerId: r.providerId ?? null,
      model: r.model ?? null,
      createdAt: r.createdAt,
    }));

    // Summary cards — total / up / down counts over the window.
    const totalRaw = await db.execute(sql`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN verdict = 'up' THEN 1 ELSE 0 END) AS up_count,
        SUM(CASE WHEN verdict = 'down' THEN 1 ELSE 0 END) AS down_count
      FROM ai_feedback
      WHERE created_at > ${windowStart}
    `);
    const totalRow = (totalRaw as unknown as Array<Array<Record<string, unknown>>>)[0]?.[0]
      ?? (totalRaw as unknown as Array<Record<string, unknown>>)[0];
    const totalInWindow = Number((totalRow as { total?: unknown })?.total ?? 0);
    const upCount = Number((totalRow as { up_count?: unknown })?.up_count ?? 0);
    const downCount = Number(
      (totalRow as { down_count?: unknown })?.down_count ?? 0,
    );

    // Per-operation NPS — aggregate for the table below.
    const byOpRaw = await db.execute(sql`
      SELECT
        operation,
        SUM(CASE WHEN verdict = 'up' THEN 1 ELSE 0 END) AS up_count,
        SUM(CASE WHEN verdict = 'down' THEN 1 ELSE 0 END) AS down_count,
        COUNT(*) AS total
      FROM ai_feedback
      WHERE created_at > ${windowStart}
      GROUP BY operation
      ORDER BY down_count DESC, total DESC
    `);
    const byOpRows = (byOpRaw as unknown as Array<Record<string, unknown>>[])[0]
      ?? (byOpRaw as unknown as Array<Record<string, unknown>>);
    const byOp: OpStats[] = (Array.isArray(byOpRows) ? byOpRows : []).map(
      (r) => {
        const u = Number(r.up_count ?? 0);
        const d = Number(r.down_count ?? 0);
        const t = Number(r.total ?? 0);
        return {
          operation: String(r.operation ?? "?"),
          upCount: u,
          downCount: d,
          total: t,
          npsBps: t > 0 ? Math.round(((u - d) / t) * 10000) : 0,
        };
      },
    );

    return {
      data: { rows, totalInWindow, upCount, downCount, byOp },
      error: null,
    };
  } catch (e) {
    return { data: null, error: String(e) };
  }
}

function npsTone(bps: number): { fg: string; label: string } {
  // Negative = more thumbs-down than -up. Bands are intentionally
  // wide so cards don't flicker between green/yellow on small samples.
  if (bps >= 5000) return { fg: "#4caf50", label: "good" };
  if (bps >= 0) return { fg: "var(--fg)", label: "neutral" };
  if (bps >= -5000) return { fg: "#f57c00", label: "warn" };
  return { fg: "#e53935", label: "bad" };
}

function VerdictChip({ verdict }: { verdict: string }) {
  const isUp = verdict === "up";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        background: isUp
          ? "color-mix(in oklab, #4caf50 18%, transparent)"
          : "color-mix(in oklab, #e53935 18%, transparent)",
        color: isUp ? "#4caf50" : "#e53935",
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      {isUp ? "↑ up" : "↓ down"}
    </span>
  );
}

export default async function AdminAiFeedbackPage({
  searchParams,
}: {
  searchParams?: { days?: string };
}) {
  await requireAdmin();
  const days = clampDays(searchParams?.days);
  const { data, error } = await getFeedback(days);

  return (
    <div>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>
          AI feedback
        </h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Past {days} days. Source: <code>ai_feedback</code> table (migration
          0022). Users submit thumbs ↑/↓ on every AI result; this surface
          is the data flywheel for routing + prompt registry quality
          decisions.
        </p>
        <div style={{ marginTop: 12 }}>
          <DayPicker current={days} base="/admin/ai-feedback" />
        </div>
      </header>

      {error ? (
        <ErrorBanner message={`Feedback query failed: ${error}`} />
      ) : null}

      {data ? (
        <>
          {/* Summary cards */}
          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
              marginBottom: 24,
            }}
          >
            <div className="card" style={{ padding: 16 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                Total feedback
              </div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>
                {data.totalInWindow}
              </div>
            </div>
            <div className="card" style={{ padding: 16 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                Thumbs ↑
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: "#4caf50",
                }}
              >
                {data.upCount}
              </div>
            </div>
            <div
              className="card"
              style={{
                padding: 16,
                borderColor:
                  data.downCount > 0 ? "#e53935" : "var(--border)",
              }}
            >
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                Thumbs ↓
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: data.downCount > 0 ? "#e53935" : "var(--fg)",
                }}
              >
                {data.downCount}
              </div>
            </div>
            <div className="card" style={{ padding: 16 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                NPS (bps)
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: npsTone(
                    data.totalInWindow > 0
                      ? Math.round(
                          ((data.upCount - data.downCount) /
                            data.totalInWindow) *
                            10000,
                        )
                      : 0,
                  ).fg,
                }}
              >
                {data.totalInWindow > 0
                  ? Math.round(
                      ((data.upCount - data.downCount) /
                        data.totalInWindow) *
                        10000,
                    )
                  : "—"}
              </div>
            </div>
          </section>

          {/* Per-op table */}
          <SectionTitle>By operation</SectionTitle>

          {data.byOp.length === 0 ? (
            <p className="muted" style={{ fontSize: 14, marginBottom: 24 }}>
              No feedback in window. (Feedback UI is rolling out — once the
              FeedbackChip lands on AI tool result cards, this surface will
              populate.)
            </p>
          ) : (
            <table style={{ ...tableStyle, marginBottom: 24 }}>
              <thead>
                <tr>
                  <Th>Operation</Th>
                  <Th>Total</Th>
                  <Th>↑ up</Th>
                  <Th>↓ down</Th>
                  <Th>NPS (bps)</Th>
                </tr>
              </thead>
              <tbody>
                {data.byOp.map((op) => (
                  <tr key={op.operation}>
                    <Td>
                      <code
                        style={{
                          fontSize: 12,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background:
                            "color-mix(in oklab, var(--fg) 6%, transparent)",
                        }}
                      >
                        {op.operation}
                      </code>
                    </Td>
                    <Td>{op.total}</Td>
                    <Td>
                      <span style={{ color: "#4caf50" }}>{op.upCount}</span>
                    </Td>
                    <Td>
                      <span
                        style={{
                          color:
                            op.downCount > 0 ? "#e53935" : "var(--fg-subtle)",
                        }}
                      >
                        {op.downCount}
                      </span>
                    </Td>
                    <Td>
                      <span
                        style={{ color: npsTone(op.npsBps).fg, fontWeight: 600 }}
                      >
                        {op.npsBps}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Recent thumbs-down */}
          <SectionTitle>Recent thumbs-down ({data.rows.length})</SectionTitle>

          {data.rows.length === 0 ? (
            <p className="muted" style={{ fontSize: 14 }}>
              No thumbs-down in the past {days} days. (Either nothing's
              broken — or the FeedbackChip UI hasn't shipped yet.)
            </p>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Operation</Th>
                  <Th>User</Th>
                  <Th>Reason</Th>
                  <Th>Note</Th>
                  <Th>Provider/Model</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <Td>
                      <div style={{ fontSize: 13 }}>
                        {formatUtcDate(r.createdAt)}
                      </div>
                      <div
                        className="muted"
                        style={{ fontSize: 11, marginTop: 2 }}
                      >
                        {formatRelative(r.createdAt)}
                      </div>
                    </Td>
                    <Td>
                      <code style={{ fontSize: 12 }}>{r.operation}</code>
                    </Td>
                    <Td>
                      <Link
                        href={`/admin/users/${r.userId}`}
                        style={{
                          fontSize: 12,
                          color: "var(--accent)",
                          textDecoration: "underline",
                        }}
                      >
                        {maskEmail(r.userId)}
                      </Link>
                    </Td>
                    <Td>
                      {r.reason ? (
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 6px",
                            borderRadius: 4,
                            border: "1px solid var(--border)",
                          }}
                        >
                          {r.reason}
                        </span>
                      ) : (
                        <span className="muted" style={{ fontSize: 12 }}>
                          —
                        </span>
                      )}
                    </Td>
                    <Td>
                      <div
                        style={{
                          fontSize: 12,
                          maxWidth: 300,
                          lineHeight: 1.5,
                        }}
                      >
                        {r.note ?? <span className="muted">—</span>}
                      </div>
                    </Td>
                    <Td>
                      <div
                        style={{
                          fontSize: 11,
                          fontFamily: "var(--font-mono, monospace)",
                          color: "var(--fg-subtle)",
                        }}
                      >
                        {r.providerId ?? "?"}
                        {r.model ? ` / ${r.model}` : ""}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}
    </div>
  );
}
