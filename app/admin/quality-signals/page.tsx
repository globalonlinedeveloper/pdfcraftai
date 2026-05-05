// app/admin/quality-signals/page.tsx — per-user AI quality signal viewer.
//
// PENDING_WORK_ANALYSIS.md §6c. Read-only consumer of
// `lib/ai/quality-signal.ts`. Surfaces every user whose recent thumbs ↑/↓
// history puts them in the `watch` (≥2 trailing thumbs-down) or
// `flagged` (≥4 trailing thumbs-down) bucket.
//
// What this page does NOT do (yet)
// --------------------------------
// - Trigger any auto-action. Today the surface is purely
//   informational — a human operator looks at the list, opens the
//   matching `/admin/users/[id]` page, and decides whether to email
//   the user, refund credits, or investigate the underlying AI
//   output. The `lib/ai/quality-signal.ts` module has a
//   `TODO(automation)` marker for the eventual auto-routing
//   integration.
// - Send a notification when a user crosses a threshold. That
//   needs a separate background runner (cron + Slack helper) which
//   is its own follow-up.
// - Show the actual chip-down feedback rows. The list shows the
//   bucket + streak + recent operations only — for the actual
//   feedback content (reason chips, free-text notes), drill into
//   the user from this page or visit `/admin/ai-feedback` directly.
//
// Why ship the empty-or-near-empty viewer now
// -------------------------------------------
// Mirrors the dunning + ai-feedback discipline: schema/library +
// viewer + CI guard land before the table has meaningful traffic,
// so when real chip data accumulates the surface is already
// available. The "empty by design today" empty state is itself
// useful — it confirms the read path works end-to-end.

import Link from "next/link";

import { listFlaggedUsers, QUALITY_SIGNAL_POLICY } from "@/lib/ai/quality-signal";
import type {
  QualityBucket,
  UserQualitySignal,
} from "@/lib/ai/quality-signal";
import { requireAdmin } from "@/lib/admin/guard";
import {
  ErrorBanner,
  SectionTitle,
  Td,
  Th,
  tableStyle,
} from "@/components/admin/ui";
import { formatRelative, maskEmail } from "@/lib/admin/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PageData {
  signals: UserQualitySignal[];
  byBucket: Record<QualityBucket, number>;
}

async function getQualitySignals(): Promise<{
  data: PageData | null;
  error: string | null;
}> {
  try {
    const signals = await listFlaggedUsers(200);

    const byBucket: Record<QualityBucket, number> = {
      flagged: 0,
      watch: 0,
      healthy: 0,
    };
    for (const signal of signals) {
      byBucket[signal.bucket] = (byBucket[signal.bucket] ?? 0) + 1;
    }

    return {
      data: { signals, byBucket },
      error: null,
    };
  } catch (e) {
    return { data: null, error: String(e) };
  }
}

function BucketChip({ bucket }: { bucket: QualityBucket }) {
  const palette: Record<QualityBucket, { bg: string; fg: string; label: string }> = {
    flagged: {
      bg: "color-mix(in oklab, #e53935 18%, transparent)",
      fg: "#e53935",
      label: "FLAGGED",
    },
    watch: {
      bg: "color-mix(in oklab, #f57c00 18%, transparent)",
      fg: "#f57c00",
      label: "WATCH",
    },
    healthy: {
      bg: "color-mix(in oklab, #4caf50 18%, transparent)",
      fg: "#4caf50",
      label: "HEALTHY",
    },
  };
  const tone = palette[bucket];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        background: tone.bg,
        color: tone.fg,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.4,
      }}
    >
      {tone.label}
    </span>
  );
}

export default async function AdminQualitySignalsPage() {
  await requireAdmin();
  const { data, error } = await getQualitySignals();

  return (
    <div>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>
          AI quality signals
        </h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Source: <code>ai_feedback</code> table + classifier in{" "}
          <code>lib/ai/quality-signal.ts</code>. Surfaces users whose
          recent thumbs ↑/↓ history shows a trailing thumbs-down streak
          worth a manual look.
        </p>
        <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
          Thresholds: <strong>WATCH</strong> at{" "}
          {QUALITY_SIGNAL_POLICY.watchThreshold} consecutive thumbs-down,{" "}
          <strong>FLAGGED</strong> at {QUALITY_SIGNAL_POLICY.flaggedThreshold}.
          Recent window: last {QUALITY_SIGNAL_POLICY.recentWindow} feedback
          rows per user, looking back 30 days.
        </p>
        <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
          <strong>Read-only surface today.</strong> Auto-routing on flagged
          users is a planned follow-up (see <code>TODO(automation)</code>{" "}
          marker in <code>lib/ai/quality-signal.ts</code>) — needs 1-2 weeks
          of accumulated data to confirm the false-positive rate at the
          current thresholds.
        </p>
      </header>

      {error ? (
        <ErrorBanner message={`Quality-signal query failed: ${error}`} />
      ) : null}

      {data ? (
        <>
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
                Total flagged + watch
              </div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>
                {data.signals.length}
              </div>
            </div>
            <div
              className="card"
              style={{
                padding: 16,
                borderColor: data.byBucket.flagged > 0 ? "#e53935" : "var(--border)",
              }}
            >
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                Flagged
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: data.byBucket.flagged > 0 ? "#e53935" : "var(--fg)",
                }}
              >
                {data.byBucket.flagged}
              </div>
            </div>
            <div
              className="card"
              style={{
                padding: 16,
                borderColor: data.byBucket.watch > 0 ? "#f57c00" : "var(--border)",
              }}
            >
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                Watch
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: data.byBucket.watch > 0 ? "#f57c00" : "var(--fg)",
                }}
              >
                {data.byBucket.watch}
              </div>
            </div>
          </section>

          <SectionTitle>Users worth a look ({data.signals.length})</SectionTitle>

          {data.signals.length === 0 ? (
            <p className="muted" style={{ fontSize: 14 }}>
              No users in <code>watch</code> or <code>flagged</code> bucket.
              (Either everything's healthy — or chip data is still accumulating
              after the Stage 3 rollout completed in commit{" "}
              <code>2a459f3</code>. The first day or two will be quiet by
              design.)
            </p>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <Th>Bucket</Th>
                  <Th>User</Th>
                  <Th>Streak</Th>
                  <Th>Recent ops</Th>
                  <Th>Last feedback</Th>
                  <Th>In window</Th>
                </tr>
              </thead>
              <tbody>
                {data.signals.map((s) => (
                  <tr key={s.userId}>
                    <Td>
                      <BucketChip bucket={s.bucket} />
                    </Td>
                    <Td>
                      <Link
                        href={`/admin/users/${s.userId}`}
                        style={{
                          fontSize: 12,
                          color: "var(--accent)",
                          textDecoration: "underline",
                        }}
                      >
                        {maskEmail(s.userId)}
                      </Link>
                    </Td>
                    <Td>
                      <strong style={{ fontSize: 14 }}>
                        {s.consecutiveNegative}
                      </strong>
                      <span className="muted" style={{ fontSize: 11 }}>
                        {" "}
                        consecutive ↓
                      </span>
                    </Td>
                    <Td>
                      <div style={{ fontSize: 11, lineHeight: 1.5 }}>
                        {s.recentOperations.length === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          s.recentOperations.slice(0, 5).map((op, i) => (
                            <code
                              key={i}
                              style={{
                                display: "inline-block",
                                marginRight: 4,
                                padding: "1px 4px",
                                borderRadius: 3,
                                background:
                                  "color-mix(in oklab, var(--fg) 6%, transparent)",
                              }}
                            >
                              {op}
                            </code>
                          ))
                        )}
                      </div>
                    </Td>
                    <Td>
                      {s.lastFeedbackAt ? (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {formatRelative(new Date(s.lastFeedbackAt))}
                        </div>
                      ) : (
                        <span className="muted" style={{ fontSize: 12 }}>
                          —
                        </span>
                      )}
                    </Td>
                    <Td>
                      <div style={{ fontSize: 13 }}>
                        {s.downInWindow} ↓ / {s.totalInWindow} total
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
