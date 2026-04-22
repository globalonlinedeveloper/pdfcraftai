// /api/admin/tax/export.csv — Download the tax snapshot as CSV.
//
// Phase D / Task #23.
//
// The /admin/tax page shows the same data on-screen; this route serves
// a CSV for CAs + Excel-driven reconciliation. Single file, four
// sections, each prefixed by a section header comment line so a human
// scrolling through the CSV in Notepad can tell which block is which.
//
// Columns:
//
//   # HEADLINE
//   metric,value_micros,value_usd
//
//   # BY_TREATMENT
//   treatment,tx_count,collected_micros,remittable_micros,kept_micros
//
//   # BY_CURRENCY
//   currency,tx_count,collected_micros,remittable_micros,kept_micros
//
//   # DAILY
//   date,tx_count,collected_micros,remittable_micros
//
// Why not JSON? CAs use Excel. Filing a GSTR-1 is a copy-paste from the
// spreadsheet onto the GSTN portal, so the data needs to paste cleanly.
// The CLI-ish `# SECTION` headers let the CA split the sheet on them
// with Ctrl+End navigation. An all-JSON alternative ships in Phase E
// once the CA confirms the CSV shape is stable.
//
// Auth:
//   - requireAdmin() — 404 for non-admins (never a 403; admin-surface
//     existence is non-public per docs/roadmap/ADMIN_PAGES_CATALOG.md).
//
// Response:
//   - Content-Type: text/csv; charset=utf-8
//   - Content-Disposition: attachment; filename="tax-snapshot-{days}d-{today}.csv"

import "server-only";

import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/guard";
import { getTaxSnapshot } from "@/lib/admin/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Clamp to the same range the /admin/tax page uses (1–90). */
function clampDays(raw: string | null): number {
  const n = raw ? Number(raw) : 30;
  if (!Number.isFinite(n)) return 30;
  return Math.max(1, Math.min(90, Math.floor(n)));
}

/** CSV-escape: wrap in quotes + double internal quotes if the cell
 *  contains comma/quote/newline. Keep numeric cells bare for Excel. */
function csvCell(raw: string | number): string {
  const s = typeof raw === "number" ? String(raw) : raw;
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: Request) {
  // Admin-only. notFound() throws to 404.
  await requireAdmin();

  const url = new URL(req.url);
  const days = clampDays(url.searchParams.get("days"));

  const snap = await getTaxSnapshot({ days });
  if (snap.error) {
    // Mirror the on-page error banner — send a 500 with a readable body.
    return new NextResponse(`error: ${snap.error}`, { status: 500 });
  }
  const s = snap.data;

  // Build the CSV body in-memory — the largest snapshot we produce
  // today is 90 days × ~100 rows/day ≤ 10k lines, well under 1 MB.
  const lines: string[] = [];

  // --- HEADLINE --------------------------------------------------------
  lines.push("# HEADLINE");
  lines.push("metric,value_micros,value_usd");
  const toUsdStr = (m: number) => (m / 1_000_000).toFixed(4);
  lines.push(`tx_count,${s.txCount},`);
  lines.push(
    `total_collected,${s.totalCollectedMicros},${toUsdStr(s.totalCollectedMicros)}`
  );
  lines.push(
    `total_remittable,${s.totalRemittableMicros},${toUsdStr(s.totalRemittableMicros)}`
  );
  lines.push(
    `total_kept,${s.totalKeptMicros},${toUsdStr(s.totalKeptMicros)}`
  );
  lines.push("");

  // --- BY_TREATMENT ----------------------------------------------------
  lines.push("# BY_TREATMENT");
  lines.push("treatment,tx_count,collected_micros,remittable_micros,kept_micros");
  for (const r of s.byTreatment) {
    lines.push(
      [
        csvCell(r.treatment),
        r.txCount,
        r.collectedMicros,
        r.remittableMicros,
        r.keptMicros,
      ].join(",")
    );
  }
  lines.push("");

  // --- BY_CURRENCY -----------------------------------------------------
  lines.push("# BY_CURRENCY");
  lines.push("currency,tx_count,collected_micros,remittable_micros,kept_micros");
  for (const r of s.byCurrency) {
    const kept = r.collectedMicros - r.remittableMicros;
    lines.push(
      [
        csvCell(r.currency),
        r.txCount,
        r.collectedMicros,
        r.remittableMicros,
        kept,
      ].join(",")
    );
  }
  lines.push("");

  // --- DAILY -----------------------------------------------------------
  lines.push("# DAILY");
  lines.push("date,tx_count,collected_micros,remittable_micros");
  for (const r of s.daily) {
    lines.push(
      [
        csvCell(r.date),
        r.txCount,
        r.collectedMicros,
        r.remittableMicros,
      ].join(",")
    );
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const filename = `tax-snapshot-${days}d-${today}.csv`;
  const body = lines.join("\r\n") + "\r\n"; // CRLF for Excel

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
