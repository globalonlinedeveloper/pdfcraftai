// /app/ai-history — Tier 4 #11 (2026-05-08).
//
// One-line problem: "Where did my AI output go?" — top user-perceived
// gap from the 2026-05 improvement audit. Outputs are persisted in
// `ai_outputs` (Phase 5.1+5.6) and previewable at
// /app/files/[id]/preview, but discoverability is poor: /app/files
// lists ALL files (uploads + every tool result + AI artifacts)
// intermixed, with the AI ones reachable only via a small Eye icon
// that's easy to miss.
//
// This page is a focused index of just the AI artifacts — summaries,
// translations, OCR transcripts, comparisons, rewrites, table
// extractions, redactions, generations, signings — chronological,
// with the kind, source filename, and a content excerpt visible so
// the user can scan-and-recognize without clicking through.
//
// Auth model: queries `ai_outputs` INNER JOINed to `files` and filters
// by `files.userId = session.userId`. Defense in depth — `ai_outputs`
// itself doesn't carry a userId column (it's keyed off file_id), and
// trusting the join key alone would let a guessed file_id leak someone
// else's output. Same pattern as /app/files/[id]/preview already uses.
//
// Why a separate page vs. a query-string filter on /app/files:
//   1. Different mental model — /app/files is "PDFs I have" (uploads
//      and tool outputs that produce PDFs); ai-history is "things AI
//      wrote about my PDFs" (markdown artifacts, not PDFs).
//   2. Different row UX — Files needs filename + size + delete +
//      open-in-chat; AI History needs kind + excerpt + view. Cramming
//      both into one row component compromises both.
//   3. Cheaper migration path — when the eventual "search across my AI
//      outputs" feature ships (kind + date + content keyword), this
//      page is where it lands. /app/files would have to grow a
//      conditional UI shell.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db, schema } from "@/db/client";
import { I } from "@/components/icons/Icons";

export const metadata: Metadata = {
  title: "AI history",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// Mirrors the `kind` enum in db/schema/app.ts (line 491). Adding a new
// kind requires updating both this map AND the schema enum — keep them
// in sync. The CI guard test-ai-history-page.mjs asserts every member
// of the schema enum has an entry here.
//
// Tints reference the design tokens defined in app/globals.css —
// kept to the four shipped colors (accent / blue / green / yellow) so
// the chips don't introduce new vars. Multiple kinds may share a tint
// — intentional, the shape difference between icons (Summary vs.
// Translate vs. Scan) carries the kind signal, color is decorative.
const KIND_META: Record<
  | "summary"
  | "translation"
  | "ocr"
  | "comparison"
  | "rewrite"
  | "table"
  | "redaction"
  | "generation"
  | "signing",
  { label: string; icon: keyof typeof I; tint: string }
> = {
  summary: { label: "Summary", icon: "Summary", tint: "var(--accent)" },
  translation: { label: "Translation", icon: "Translate", tint: "var(--green)" },
  ocr: { label: "OCR", icon: "Scan", tint: "var(--blue)" },
  comparison: { label: "Comparison", icon: "Compare", tint: "var(--yellow)" },
  rewrite: { label: "Rewrite", icon: "Edit", tint: "var(--accent)" },
  table: { label: "Table", icon: "Pages", tint: "var(--blue)" },
  redaction: { label: "Redaction", icon: "Shield", tint: "var(--red)" },
  generation: { label: "Generation", icon: "Generate", tint: "var(--green)" },
  signing: { label: "Signing", icon: "Pen", tint: "var(--yellow)" },
};

const ALL_KINDS = Object.keys(KIND_META) as Array<keyof typeof KIND_META>;

type SearchParams = { kind?: string };

// `ai_outputs.content_md` is mediumtext (16MB ceiling) — never excerpt
// from raw row content in JSX, the page payload would balloon. We
// truncate server-side to ~220 chars (≈ 2 lines at the chosen typo
// scale) before sending to the client. Strip leading "# " heading
// markers so the excerpt reads as prose, not a chopped header.
function makeExcerpt(md: string): string {
  // Drop leading whitespace + common markdown decorations from the
  // first line so the excerpt starts mid-sentence rather than with
  // "##" or "**".
  const cleaned = md
    .replace(/^[\s>#*_`-]+/, "")
    .replace(/\n+/g, " ")
    .trim();
  if (cleaned.length <= 220) return cleaned;
  // Cut at the nearest word boundary before the 220-char ceiling so we
  // never split mid-word.
  const slice = cleaned.slice(0, 220);
  const lastSpace = slice.lastIndexOf(" ");
  const cutoff = lastSpace > 160 ? lastSpace : 220;
  return cleaned.slice(0, cutoff).trimEnd() + "…";
}

function relativeTime(d: Date): string {
  const now = Date.now();
  const ms = now - d.getTime();
  const sec = Math.round(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  // Past a month, fall back to a date string — relative time loses
  // resolution and "5 weeks ago" is less useful than the actual date.
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default async function AiHistoryPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const session = await auth();
  const userId = session?.user ? (session.user as { id?: string }).id : undefined;
  if (!userId) redirect("/login?callbackUrl=%2Fapp%2Fai-history");

  // Whitelist the kind filter — anything not in KIND_META is treated
  // as "no filter" rather than echoed into the query, which prevents
  // a malformed `?kind=` from triggering a Drizzle type error.
  const rawKind = searchParams?.kind;
  const kindFilter =
    typeof rawKind === "string" && (ALL_KINDS as string[]).includes(rawKind)
      ? (rawKind as keyof typeof KIND_META)
      : null;

  // INNER JOIN on file_id, filter by files.userId — defense in depth.
  // Even if a future bug grants the wrong userId to ai_outputs, the
  // files-table filter still excludes other users' rows. ORDER BY
  // ai_outputs.createdAt uses the existing ai_outputs_created_idx.
  const baseWhere = eq(schema.files.userId, userId);
  const whereClause = kindFilter
    ? and(baseWhere, eq(schema.aiOutputs.kind, kindFilter))
    : baseWhere;

  const rows = await db
    .select({
      fileId: schema.aiOutputs.fileId,
      kind: schema.aiOutputs.kind,
      contentMd: schema.aiOutputs.contentMd,
      meta: schema.aiOutputs.meta,
      createdAt: schema.aiOutputs.createdAt,
      sourceName: schema.files.name,
      sourceToolId: schema.files.toolId,
    })
    .from(schema.aiOutputs)
    .innerJoin(schema.files, eq(schema.aiOutputs.fileId, schema.files.id))
    .where(whereClause)
    .orderBy(desc(schema.aiOutputs.createdAt))
    .limit(100);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 960 }}>
      <header>
        <div className="eyebrow" style={{ marginBottom: 6 }}>AI HISTORY</div>
        <h1 style={{ fontSize: 28, letterSpacing: "-0.02em", margin: 0 }}>
          Your AI artifacts
        </h1>
        <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>
          Every summary, translation, OCR transcript, and comparison you&apos;ve run — newest first.
          Click an artifact to re-open the rendered preview without spending credits again.
        </p>
      </header>

      <FilterBar active={kindFilter} />

      {rows.length === 0 ? (
        <div
          className="card"
          style={{ padding: 40, textAlign: "center", borderStyle: "dashed" }}
        >
          <p className="muted" style={{ fontSize: 14, margin: "0 0 16px" }}>
            {kindFilter
              ? `No ${KIND_META[kindFilter].label.toLowerCase()} artifacts yet.`
              : "You haven’t run any AI tools yet."}
          </p>
          <Link href="/tools" className="btn btn-ghost btn-sm">
            Browse AI tools <I.ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map((r) => {
            const meta = KIND_META[r.kind as keyof typeof KIND_META];
            const excerpt = makeExcerpt(r.contentMd);
            const Ic = I[meta.icon];
            return (
              <Link
                key={r.fileId}
                href={`/app/files/${r.fileId}/preview`}
                className="card"
                style={{
                  padding: 16,
                  display: "block",
                  textDecoration: "none",
                  color: "inherit",
                  transition: "border-color 0.15s",
                }}
              >
                <div className="row" style={{ gap: 10, alignItems: "center", marginBottom: 8 }}>
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: "var(--accent-soft)",
                      color: meta.tint,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <Ic size={14} />
                  </span>
                  <span
                    className="chip"
                    style={{
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      borderColor: "var(--border)",
                      color: "var(--fg-muted)",
                    }}
                  >
                    {meta.label}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      color: "var(--fg-muted)",
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={r.sourceName ?? ""}
                  >
                    {r.sourceName ?? "Unknown source"}
                  </span>
                  <span className="subtle" style={{ fontSize: 12 }}>
                    {relativeTime(new Date(r.createdAt))}
                  </span>
                </div>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--fg-muted)",
                    lineHeight: 1.55,
                    margin: 0,
                  }}
                >
                  {excerpt || <em>(empty output)</em>}
                </p>
              </Link>
            );
          })}
          {rows.length === 100 ? (
            <p className="subtle" style={{ fontSize: 12, textAlign: "center", margin: "8px 0 0" }}>
              Showing the 100 most recent artifacts. Older ones still live at /app/files.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function FilterBar({ active }: { active: keyof typeof KIND_META | null }) {
  const baseStyle: React.CSSProperties = {
    fontSize: 13,
    padding: "6px 12px",
    borderRadius: 999,
    border: "1px solid var(--border)",
    textDecoration: "none",
    color: "var(--fg-muted)",
    background: "transparent",
    transition: "background 0.15s, color 0.15s",
  };
  const activeStyle: React.CSSProperties = {
    ...baseStyle,
    background: "var(--accent-soft)",
    color: "var(--accent)",
    borderColor: "var(--accent)",
  };
  return (
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      <Link href="/app/ai-history" style={active === null ? activeStyle : baseStyle}>
        All
      </Link>
      {ALL_KINDS.map((k) => (
        <Link
          key={k}
          href={`/app/ai-history?kind=${k}`}
          style={active === k ? activeStyle : baseStyle}
        >
          {KIND_META[k].label}
        </Link>
      ))}
    </div>
  );
}
