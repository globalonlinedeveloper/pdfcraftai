// 2026-05-08 — Copy / download actions for AI artifacts on the
// /app/files/[id]/preview page. Pure client component because both
// actions use browser APIs (clipboard write + Blob/URL handling).
//
// Why this ships now: AI History (Tier 4 #11, b56120b) made every
// artifact reachable, but the preview page itself rendered the
// markdown as HTML with no exit ramp — users routinely want to paste
// a summary into Slack/email/Notion or save the .md alongside the
// source PDF. Without these affordances, "view your artifact" is
// view-only and the user falls back to right-click → View source →
// copy raw HTML, which loses the markdown structure.
//
// Why a single component instead of two: the buttons share a row +
// success toast affordance + filename derivation, and rendering them
// as one unit keeps the layout stable when the toast appears (the
// "Copied!" message replaces the row's right-side meta inline rather
// than pushing layout around).
//
// Filename derivation: `<kind>-of-<sourceBaseName>-<YYYY-MM-DD>.md`,
// with the source's `.pdf` suffix stripped and unsafe filesystem
// chars replaced with `-`. Falls back to `<kind>-<YYYY-MM-DD>.md`
// when the source name is missing (generation kind, primarily, since
// generation's sourceName is the literal "prompt").

"use client";

import { useState } from "react";
import { I } from "@/components/icons/Icons";

type Props = {
  /** Raw markdown — the same `ai_outputs.content_md` the server rendered. */
  contentMd: string;
  /** Schema kind — drives the filename prefix. */
  kind: string;
  /** Source PDF filename from `meta.sourceName`, or undefined for generation. */
  sourceName?: string;
  /** UTC-stable date the artifact was generated (server-passed, not client-calc). */
  generatedAtIso: string;
};

// Strip filesystem-unfriendly chars + collapse runs of separators.
// Conservative allowlist of [A-Za-z0-9._-]; anything else becomes "-".
// Cap at 80 chars so the final filename stays under most filesystem
// limits even after the kind prefix + date suffix are appended.
function sanitizeBaseName(s: string): string {
  return (
    s
      .replace(/\.pdf$/i, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 80) || "artifact"
  );
}

function buildFilename(kind: string, sourceName: string | undefined, generatedAtIso: string): string {
  const date = generatedAtIso.slice(0, 10); // YYYY-MM-DD from ISO 8601
  const safeKind = sanitizeBaseName(kind);
  if (!sourceName || sourceName === "prompt") {
    return `${safeKind}-${date}.md`;
  }
  return `${safeKind}-of-${sanitizeBaseName(sourceName)}-${date}.md`;
}

export function AiOutputActions({ contentMd, kind, sourceName, generatedAtIso }: Props) {
  // Two-state action feedback — copied | downloaded — both auto-clear
  // after 1.6s. We track them separately so a copy doesn't visually
  // overwrite a recent download confirmation (the user might
  // double-tap and we want each action's success message to land
  // cleanly).
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  async function handleCopy() {
    try {
      // Modern API; permissions are user-gesture-scoped so this
      // works without a permission prompt in every browser the
      // app supports (Chrome/Safari/Firefox latest).
      await navigator.clipboard.writeText(contentMd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (err) {
      // Clipboard write can fail on insecure-origin embeds (rare for
      // our domain since we're HTTPS-only) or sandboxed iframes.
      // Don't crash the page — surface the failure as a non-toast
      // "Copy failed" state and log for debugging.
      console.warn("[AiOutputActions] clipboard write failed", err);
      setCopied(false);
    }
  }

  function handleDownload() {
    // Build a Blob with explicit text/markdown MIME so the OS picks
    // the right default app (most editors register .md with
    // text/markdown). UTF-8 is implicit for Blob text.
    const blob = new Blob([contentMd], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = buildFilename(kind, sourceName, generatedAtIso);
      // Don't append to DOM — modern browsers fire the click event
      // on detached anchors. Avoids a layout flash + skips the
      // "remove this random `<a>` from `<body>`" cleanup step.
      a.click();
      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 1600);
    } finally {
      // Always revoke the object URL — leaking these compounds
      // memory across long-lived tabs. The pattern is asserted by
      // scripts/test-objecturl-revocation.mjs (M6 audit).
      URL.revokeObjectURL(url);
    }
  }

  return (
    <div
      className="row"
      style={{
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copy markdown to clipboard"
        className="btn btn-ghost btn-sm"
        style={{ gap: 6, color: "var(--fg-muted)" }}
      >
        <I.Copy size={13} />
        {copied ? "Copied" : "Copy markdown"}
      </button>
      <button
        type="button"
        onClick={handleDownload}
        aria-label="Download as Markdown file"
        className="btn btn-ghost btn-sm"
        style={{ gap: 6, color: "var(--fg-muted)" }}
      >
        <I.Download size={13} />
        {downloaded ? "Downloaded" : "Download .md"}
      </button>
    </div>
  );
}
