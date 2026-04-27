// components/marketing/ToolRunnerLongform.tsx
//
// Build 2 Wave 5 (2026-04-27): shared longform component for all
// PDFium-backed tool runner pages. Replaces ~280 LOC per-tool
// components with one renderer that takes a data object.
//
// The two existing bespoke longforms (PdfInspectorLongform,
// PageCountLongform) stay as-is — they have unique sections like
// "PDF health checklist" that don't fit the shared shape. New
// longforms for tools that match the standard pattern use this.
//
// Standard pattern (5 sections):
//   1. Why people use X — N use-case cards with icons
//   2. How X works — 3 steps
//   3. What makes pdfcraft ai different — 5 shared bullets
//      (constant — same content across the brand)
//   4. Frequently asked questions — N collapsible Q&As
//   5. CTA — link card to a related tool
//
// Per-tool content lives in lib/tool-longforms.ts as a Record
// keyed by tool id. The dispatch in app/tool/[id]/page.tsx checks
// that map and renders <ToolRunnerLongform data={...} /> when an
// entry exists.

import Link from "next/link";
import { I, type IconName } from "@/components/icons/Icons";

export interface ToolLongformData {
  /** Section title for use-cases. e.g. "Why people use PDF to JPG". */
  useCasesTitle: string;
  /** 1–2 sentence intro under the use-cases title. */
  useCasesIntro: string;
  /** Use-case cards (3–6 items). */
  useCases: Array<{
    icon: IconName;
    title: string;
    text: string;
  }>;
  /** Section title for how-it-works. e.g. "How PDF to JPG works". */
  howWorksTitle: string;
  /** 3 steps — keep step text short. */
  howWorks: Array<{
    step: string;
    title: string;
    text: string;
  }>;
  /** Visible FAQ. Array of Q&A. Also feeds the FAQPage JSON-LD via
   *  the runner page's PER_TOOL_FAQ map (see app/tool/[id]/page.tsx). */
  faqs: Array<{ q: string; a: string }>;
  /** CTA card at the bottom of the longform. */
  cta: {
    title: string;
    text: string;
    linkHref: string;
    linkLabel: string;
  };
}

/** Shared "What makes pdfcraft ai different" content — identical
 *  across the brand. Defining once here keeps copy in lockstep. */
const DIFFERENTIATORS: Array<[string, string]> = [
  ["Same engine Chrome uses", "PDFium is Google's PDF engine — the one that powers Chrome's built-in PDF viewer. We compile it to WebAssembly so it runs in your browser at near-native speed."],
  ["100% local processing", "Most free PDF tools upload your file to a server, process it, and stream the result back. We don't. Your file lives in your browser tab and never touches our infrastructure. Verifiable in your browser's Network panel."],
  ["No watermark, no signup, no daily limit", "Convert 1 PDF or 1,000. We don't gate on volume because there's nothing to gate on — the engine runs on your machine."],
  ["Honest about limitations", "When something the tool can't do (encrypted PDFs, cross-reference streams), we tell you clearly instead of failing silently. Same for partial results: sampled vs exact, embedded vs not."],
  ["Open standards, free engines", "PDFium is BSD/Apache licensed (free for any use). We don't pay vendor license fees and pass that savings on to you (and to ourselves) as a free, ad-supported tool with no upgrade-to-pro pressure."],
];

export function ToolRunnerLongform({ data }: { data: ToolLongformData }) {
  return (
    <>
      {/* Use cases */}
      <section style={{ marginTop: 48 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 8px" }}>
          {data.useCasesTitle}
        </h2>
        <p
          className="muted"
          style={{ fontSize: 14, marginTop: 0, marginBottom: 24 }}
        >
          {data.useCasesIntro}
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 14,
          }}
        >
          {data.useCases.map((c) => {
            const Ic =
              (I as Record<string, React.FC<{ size?: number }>>)[c.icon] ??
              I.Sparkle;
            return (
              <div
                key={c.title}
                className="card"
                style={{ padding: 16, background: "var(--bg-1)" }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                    display: "grid",
                    placeItems: "center",
                    marginBottom: 10,
                  }}
                >
                  <Ic size={14} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                  {c.title}
                </div>
                <div
                  className="muted"
                  style={{ fontSize: 13, lineHeight: 1.55 }}
                >
                  {c.text}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* How it works */}
      <section style={{ marginTop: 48 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 8px" }}>
          {data.howWorksTitle}
        </h2>
        <p
          className="muted"
          style={{ fontSize: 14, marginTop: 0, marginBottom: 24 }}
        >
          Three steps, no signup, no uploads.
        </p>
        <ol
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
            paddingLeft: 0,
            margin: 0,
            listStyle: "none",
          }}
        >
          {data.howWorks.map((s) => (
            <li
              key={s.step}
              className="card"
              style={{ padding: 16, background: "var(--bg-1)" }}
            >
              <div
                className="mono subtle"
                style={{
                  fontSize: 11,
                  marginBottom: 6,
                  letterSpacing: "0.05em",
                }}
              >
                STEP {s.step}
              </div>
              <div
                style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}
              >
                {s.title}
              </div>
              <div
                className="muted"
                style={{ fontSize: 13, lineHeight: 1.55 }}
              >
                {s.text}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* What makes us different — shared content. */}
      <section style={{ marginTop: 48 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 16px" }}>
          What makes pdfcraft ai different
        </h2>
        <ul
          style={{
            paddingLeft: 0,
            margin: 0,
            listStyle: "none",
            display: "grid",
            gap: 12,
          }}
        >
          {DIFFERENTIATORS.map(([title, body]) => (
            <li
              key={title}
              className="row"
              style={{ gap: 12, alignItems: "flex-start" }}
            >
              <span
                style={{
                  color: "var(--accent)",
                  marginTop: 2,
                  flexShrink: 0,
                }}
              >
                <I.Check size={16} />
              </span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
                <div
                  className="muted"
                  style={{ fontSize: 13, lineHeight: 1.55, marginTop: 2 }}
                >
                  {body}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* FAQ */}
      <section style={{ marginTop: 48 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 16px" }}>
          Frequently asked questions
        </h2>
        <div style={{ display: "grid", gap: 8 }}>
          {data.faqs.map((f) => (
            <details
              key={f.q}
              className="card"
              style={{ padding: 0, background: "var(--bg-1)" }}
            >
              <summary
                style={{
                  padding: "14px 16px",
                  cursor: "pointer",
                  fontWeight: 500,
                  fontSize: 14,
                  listStyle: "none",
                }}
              >
                {f.q}
              </summary>
              <div
                className="muted"
                style={{
                  padding: "0 16px 14px",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                {f.a}
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{ marginTop: 48 }}>
        <div
          className="card"
          style={{
            padding: 24,
            textAlign: "center",
            background: "var(--bg-1)",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
            {data.cta.title}
          </h3>
          <p
            className="muted"
            style={{ fontSize: 14, marginTop: 8, marginBottom: 16 }}
          >
            {data.cta.text}
          </p>
          <Link href={data.cta.linkHref} className="btn btn-outline">
            {data.cta.linkLabel} <I.ArrowRight size={14} />
          </Link>
        </div>
      </section>
    </>
  );
}
