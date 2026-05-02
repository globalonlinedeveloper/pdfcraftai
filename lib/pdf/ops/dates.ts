// lib/pdf/ops/dates.ts
//
// 2026-05-01 — Extract Dates: regex-based extraction of date strings
// from a PDF's text content + ICS calendar generation. Runs entirely
// client-side off lib/pdf/ops/text-export.ts's `extractPagesText`.
//
// Closes the second-longest KNOWN_DEAD_REFS entry. The SEO landing at
// /pdf-to-ics-calendar promised "find every date in a PDF and download
// an .ics file importable into Google Calendar / Apple Calendar /
// Outlook" but the underlying tool didn't exist — visitors hit a
// placeholder. Now they hit a working tool.
//
// Coverage decisions:
//
//   • DEFAULT day-first (Indian/EU convention). The audience is
//     primarily Indian; "04/05/2026" means 4 May to most users on
//     this site. US-style month-first interpretation is preserved
//     in the structured output as a separate column so power users
//     can spot ambiguous cases.
//
//   • Skip "next Tuesday" / "the first Monday of March" — those
//     contextual dates need an LLM, not a regex. AI Action Items
//     handles them.
//
//   • Capture surrounding context (~80 chars around each date)
//     so the .ics SUMMARY field has something meaningful for the
//     calendar entry, not just "5 Jan 2026" floating alone.

import { extractPagesText } from "@/lib/pdf/ops/text-export";

export interface ExtractedDate {
  /** Raw date string as found in the doc, with original formatting. */
  raw: string;
  /** ISO 8601 normalized form: YYYY-MM-DD. Day-first interpretation. */
  iso: string;
  /** True if the date is genuinely ambiguous (e.g. "04/05/2026" could
   *  be 4 May day-first OR April 5 month-first). UI can flag these
   *  for review. */
  ambiguous: boolean;
  /** Alternative interpretation if ambiguous, in ISO form. Undefined
   *  for unambiguous dates (4-digit year always anchors). */
  altIso?: string;
  /** Format detected: "iso" / "slash-numeric" / "dot-numeric" /
   *  "dash-numeric" / "named-month-day-first" / "named-month-month-first". */
  format: string;
  /** ~80 chars of surrounding text from the doc, useful as a
   *  calendar-event description. */
  context: string;
  /** 1-indexed page numbers where this date appears. Deduped. */
  pages: number[];
  /** Total occurrences across the document. */
  count: number;
}

export interface ExtractDatesResult {
  dates: ExtractedDate[];
  /** Total pages of text extracted. */
  pageCount: number;
  /** Set when text extraction returned essentially nothing (scanned
   *  PDF). UI surfaces this so users know to run AI PDF OCR first. */
  scannedPdfLikely: boolean;
}

// ===========================================================================
// Date regex stack — ordered most-specific to least.
//
// Specificity matters: "2026-04-24 5 May 2026" should resolve as ONE
// ISO + ONE named-month, not be confused by overlapping bare-number
// patterns. We use consumed-range tracking (same idea as in contacts.ts)
// to prevent overlap matches from double-counting.
// ===========================================================================

// ISO 8601: 2026-04-24 (always year-first, unambiguous)
const ISO_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

// Named month, day-first: "24 April 2026", "24 Apr 2026", "24-Apr-2026"
const NAMED_DAY_FIRST_RE =
  /\b(\d{1,2})[-\s]?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)(?:[a-z]*)\.?[-\s,]+(\d{2,4})\b/gi;

// Named month, month-first: "April 24, 2026", "Apr 24 2026"
const NAMED_MONTH_FIRST_RE =
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)(?:[a-z]*)\.?[-\s]+(\d{1,2})(?:st|nd|rd|th)?[-\s,]+(\d{2,4})\b/gi;

// Slash numeric: 24/04/2026, 24/4/26
const SLASH_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g;

// Dot numeric: 24.04.2026, 24.4.26 (common in EU + Indian gov. forms)
const DOT_RE = /\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/g;

// Dash numeric: 24-04-2026 (note: distinguish from ISO YYYY-MM-DD by
// year-position — ISO has year first, this has year last)
const DASH_RE = /\b(\d{1,2})-(\d{1,2})-(\d{2,4})\b/g;

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function expand2DigitYear(yy: number): number {
  // 2-digit year heuristic: 00-69 → 2000-2069; 70-99 → 1970-1999.
  // Standard Unix-era convention. Indian gov forms with 2-digit years
  // are almost always recent (post-2000), so this works.
  return yy < 70 ? 2000 + yy : 1900 + yy;
}

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  // Light validation — Feb 30 is wrong but we don't reject it.
  // The Date() constructor rolls invalid days, so check after.
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null; // e.g. Feb 30 → Mar 2; we reject this.
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseNumeric(
  a: number,
  b: number,
  c: number,
  format: "slash-numeric" | "dot-numeric" | "dash-numeric",
): {
  iso: string;
  ambiguous: boolean;
  altIso?: string;
  format: string;
} | null {
  // c is always the year position. Expand 2-digit years.
  const year = c < 100 ? expand2DigitYear(c) : c;

  // Default day-first: a=day, b=month
  const isoDayFirst = toIso(year, b, a);
  // Alternative month-first: a=month, b=day
  const isoMonthFirst = toIso(year, a, b);

  if (!isoDayFirst && !isoMonthFirst) return null;

  // If one fails (e.g. 13/05 — only 13 May works, since 05/13 is invalid
  // calendar-wise), use the valid one.
  if (isoDayFirst && !isoMonthFirst) {
    return { iso: isoDayFirst, ambiguous: false, format };
  }
  if (!isoDayFirst && isoMonthFirst) {
    return { iso: isoMonthFirst, ambiguous: false, format };
  }

  // Both interpretations are valid → genuinely ambiguous.
  // Default to day-first (Indian/EU convention).
  if (a === b) {
    // Same day/month — no ambiguity (4/4/26 is just April 4)
    return { iso: isoDayFirst!, ambiguous: false, format };
  }
  return {
    iso: isoDayFirst!,
    ambiguous: true,
    altIso: isoMonthFirst!,
    format,
  };
}

function captureContext(text: string, idx: number, len: number): string {
  // Take ~40 chars before + matched + ~40 chars after, then trim
  // leading/trailing partial words for cleaner snippets.
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + len + 40);
  let snippet = text.slice(start, end);
  // Collapse whitespace + trim partial words at the edges.
  snippet = snippet.replace(/\s+/g, " ").trim();
  if (start > 0) snippet = "…" + snippet.replace(/^\S*\s/, "");
  if (end < text.length) snippet = snippet.replace(/\s\S*$/, "") + "…";
  return snippet;
}

/**
 * Extract dates from PDF bytes + return structured ExtractedDate[]
 * sorted by frequency (desc) then chronologically.
 */
export async function extractDates(
  bytes: Uint8Array,
): Promise<ExtractDatesResult> {
  const pages = await extractPagesText(bytes);
  const totalText = pages.join(" ").trim();
  const scannedPdfLikely = totalText.length < 50 && pages.length > 0;

  // dedup key: ISO date string. Same date appearing in different raw
  // formats (e.g. "5 May 2026" + "05/05/2026") collapses into one row.
  const dateMap = new Map<
    string,
    {
      raw: string;
      iso: string;
      ambiguous: boolean;
      altIso?: string;
      format: string;
      context: string;
      pages: Set<number>;
      count: number;
    }
  >();

  for (let i = 0; i < pages.length; i++) {
    const pageNum = i + 1;
    const text = pages[i];
    const consumed: Array<[number, number]> = [];

    function tryAdd(
      idx: number,
      matched: string,
      iso: string,
      ambiguous: boolean,
      altIso: string | undefined,
      format: string,
    ) {
      const start = idx;
      const end = idx + matched.length;
      if (consumed.some(([s, e]) => start < e && end > s)) return;
      consumed.push([start, end]);

      const existing = dateMap.get(iso);
      if (existing) {
        existing.pages.add(pageNum);
        existing.count++;
      } else {
        dateMap.set(iso, {
          raw: matched,
          iso,
          ambiguous,
          altIso,
          format,
          context: captureContext(text, idx, matched.length),
          pages: new Set([pageNum]),
          count: 1,
        });
      }
    }

    // ----- ISO -----
    for (const m of text.matchAll(ISO_RE)) {
      if (m.index === undefined) continue;
      const year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      const iso = toIso(year, month, day);
      if (iso) tryAdd(m.index, m[0], iso, false, undefined, "iso");
    }

    // ----- Named month, day-first -----
    for (const m of text.matchAll(NAMED_DAY_FIRST_RE)) {
      if (m.index === undefined) continue;
      const day = Number(m[1]);
      const month = MONTH_NAMES[m[2].toLowerCase()];
      let year = Number(m[3]);
      if (year < 100) year = expand2DigitYear(year);
      const iso = toIso(year, month, day);
      if (iso) tryAdd(m.index, m[0], iso, false, undefined, "named-month-day-first");
    }

    // ----- Named month, month-first -----
    for (const m of text.matchAll(NAMED_MONTH_FIRST_RE)) {
      if (m.index === undefined) continue;
      const month = MONTH_NAMES[m[1].toLowerCase()];
      const day = Number(m[2]);
      let year = Number(m[3]);
      if (year < 100) year = expand2DigitYear(year);
      const iso = toIso(year, month, day);
      if (iso) tryAdd(m.index, m[0], iso, false, undefined, "named-month-month-first");
    }

    // ----- Numeric (slash / dot / dash, day-first default) -----
    const numericPatterns: Array<
      [RegExp, "slash-numeric" | "dot-numeric" | "dash-numeric"]
    > = [
      [SLASH_RE, "slash-numeric"],
      [DOT_RE, "dot-numeric"],
      [DASH_RE, "dash-numeric"],
    ];
    for (const [pattern, format] of numericPatterns) {
      const localRe = new RegExp(pattern.source, pattern.flags);
      for (const m of text.matchAll(localRe)) {
        if (m.index === undefined) continue;
        const a = Number(m[1]);
        const b = Number(m[2]);
        const c = Number(m[3]);
        const parsed = parseNumeric(a, b, c, format);
        if (!parsed) continue;
        tryAdd(m.index, m[0], parsed.iso, parsed.ambiguous, parsed.altIso, parsed.format);
      }
    }
  }

  // Sort: chronological (oldest first) makes more sense for calendar
  // entries than freq-desc (which we use for emails/phones).
  const dates: ExtractedDate[] = [...dateMap.values()]
    .map((v) => ({
      raw: v.raw,
      iso: v.iso,
      ambiguous: v.ambiguous,
      altIso: v.altIso,
      format: v.format,
      context: v.context,
      pages: [...v.pages].sort((a, b) => a - b),
      count: v.count,
    }))
    .sort((a, b) => a.iso.localeCompare(b.iso));

  return { dates, pageCount: pages.length, scannedPdfLikely };
}

// ---------------------------------------------------------------------------
// ICS (iCalendar RFC 5545) generation.
//
// Produces a minimal valid ICS file with one VEVENT per extracted date.
// Each event is all-day (no time component — we don't extract times in
// v1) with the surrounding context as the SUMMARY.
//
// RFC 5545 line folding: lines longer than 75 octets must be folded by
// inserting CRLF + space. We apply this to SUMMARY since contexts can
// be 80+ chars after the snippet logic.
// ---------------------------------------------------------------------------

function escapeIcsText(text: string): string {
  // Per RFC 5545 §3.3.11: backslash, comma, semicolon, newline must be
  // escaped in TEXT-typed properties.
  return text
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");
}

function foldIcsLine(line: string): string {
  // RFC 5545 §3.1: lines > 75 octets MUST be folded with CRLF + space.
  // Use 73 as safety margin since some clients are stricter.
  const MAX = 73;
  if (line.length <= MAX) return line;
  const parts: string[] = [];
  let i = 0;
  while (i < line.length) {
    parts.push(line.slice(i, i + MAX));
    i += MAX;
  }
  return parts.join("\r\n ");
}

function isoToIcsDate(iso: string): string {
  // ICS DATE format is YYYYMMDD (no hyphens) for VALUE=DATE all-day events.
  return iso.replace(/-/g, "");
}

/**
 * Generate ICS file content from extracted dates. Each date becomes
 * a VEVENT with VALUE=DATE (all-day, no time component).
 */
export function generateIcs(
  dates: ExtractedDate[],
  sourceFilename: string,
): string {
  const now = new Date();
  const dtstamp =
    now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "") + "";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//pdfcraft ai//Extract Dates//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    const icsDate = isoToIcsDate(d.iso);
    // Next-day for DTEND — ICS all-day events have non-inclusive end.
    const nextDay = new Date(d.iso);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const icsDateEnd =
      `${nextDay.getUTCFullYear()}${pad2(nextDay.getUTCMonth() + 1)}${pad2(nextDay.getUTCDate())}`;

    // UID must be globally unique. We use date-iso + filename-hash + index.
    const uid = `${icsDate}-${i}-${sourceFilename.replace(/[^a-z0-9]/gi, "")}@pdfcraftai`;

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;VALUE=DATE:${icsDate}`);
    lines.push(`DTEND;VALUE=DATE:${icsDateEnd}`);
    lines.push(foldIcsLine(`SUMMARY:${escapeIcsText(d.context || d.raw)}`));
    lines.push(
      foldIcsLine(
        `DESCRIPTION:Extracted from ${escapeIcsText(sourceFilename)}\\, page${d.pages.length === 1 ? "" : "s"} ${d.pages.join("\\, ")}. Original format: "${escapeIcsText(d.raw)}"${d.ambiguous && d.altIso ? ` (ambiguous — alt: ${d.altIso})` : ""}`,
      ),
    );
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  // RFC 5545 line ending is CRLF.
  return lines.join("\r\n") + "\r\n";
}
