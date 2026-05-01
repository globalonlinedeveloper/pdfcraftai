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

/**
 * 2026-05-01 — added the `isAI` prop. Until today this component was
 * shared across free + AI tool runners with one hardcoded set of
 * "What makes pdfcraft ai different" bullets that were true for free
 * tools but false for AI tools (the bullets claim "100% local
 * processing... never touches our infrastructure" and "no signup, no
 * daily limit" — both flatly untrue for AI ops, which POST the file to
 * OpenAI/Anthropic via /api/ai/* and require auth + credits). Branching
 * by isAI lets the AI suite ship a differentiator block that matches
 * what the AI suite actually does. Free tools default to isAI=false
 * via the optional prop, so this change is fully backward-compatible
 * with existing free-tool call sites that don't pass it.
 */
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

/**
 * "What makes pdfcraft ai different" — two parallel content sets,
 * one for free tools and one for AI tools. Defining both here keeps
 * the copy in lockstep within each audience.
 *
 * The two lists deliberately don't share entries. Free tools
 * differentiate on local PDFium processing, BSD/Apache licensing,
 * and unlimited usage. AI tools differentiate on citation grounding,
 * pay-as-you-go pricing, multi-provider routing, retention, and
 * model-limit transparency. Mixing the two lists would re-introduce
 * the dishonesty problem this fix exists to solve.
 *
 * Each entry: [title, body]. Keep titles to ~3-5 words and bodies
 * to one or two sentences — these render as a 5-bullet checklist,
 * not a wall of text.
 */
const FREE_DIFFERENTIATORS: Array<[string, string]> = [
  ["Same engine Chrome uses", "PDFium is Google's PDF engine — the one that powers Chrome's built-in PDF viewer. We compile it to WebAssembly so it runs in your browser at near-native speed."],
  ["100% local processing", "Most free PDF tools upload your file to a server, process it, and stream the result back. We don't. Your file lives in your browser tab and never touches our infrastructure. Verifiable in your browser's Network panel."],
  ["No watermark, no signup, no daily limit", "Convert 1 PDF or 1,000. We don't gate on volume because there's nothing to gate on — the engine runs on your machine."],
  ["Honest about limitations", "When something the tool can't do (encrypted PDFs, cross-reference streams), we tell you clearly instead of failing silently. Same for partial results: sampled vs exact, embedded vs not."],
  ["Open standards, free engines", "PDFium is BSD/Apache licensed (free for any use). We don't pay vendor license fees and pass that savings on to you (and to ourselves) as a free, ad-supported tool with no upgrade-to-pro pressure."],
];

const AI_DIFFERENTIATORS: Array<[string, string]> = [
  ["Citations on every claim", "Every AI summary, answer, and translation links back to the page it came from. You can verify the source before relying on the output. Hallucination is bounded, not blind."],
  ["Pay only for what you use", "No subscription. Credits never expire. Cancel anytime. Each call costs 3-15 credits depending on the tool — typically a few cents — with the cost shown before you run."],
  ["Multi-provider routing, no vendor lock-in", "We route between Anthropic and OpenAI per call to balance cost and quality. If one provider has an outage, the next call automatically tries the other. You're not bound to a single vendor's pricing or downtime."],
  ["Files deleted in 60 minutes", "Your PDF lives on our servers only as long as the API call needs it, then it's gone. We don't fine-tune models on your data. Verifiable in your dashboard's audit log."],
  ["Honest about model limits", "When a doc exceeds the model's context window we surface that the output was truncated (we render result.wasTruncated in every AI tool's UI). When a number can't be verified from the source we flag it. No silent failures."],
];

export function ToolRunnerLongform({
  data,
  isAI = false,
}: {
  data: ToolLongformData;
  /** When true, swaps the shared differentiators block + the
   *  how-it-works subtitle to AI-suite-appropriate copy. Defaults to
   *  false so existing free-tool call sites that don't pass the prop
   *  keep their current rendering unchanged. */
  isAI?: boolean;
}) {
  const differentiators = isAI ? AI_DIFFERENTIATORS : FREE_DIFFERENTIATORS;
  // The "Three steps, no signup, no uploads" line was a free-tool
  // promise. AI tools require a signed-in account and the file IS
  // uploaded to our server (then forwarded to the AI provider, then
  // deleted). The AI-specific subtitle reflects what actually happens.
  const howWorksSubtitle = isAI
    ? "Three steps. Sign in to run, files deleted in 60 minutes."
    : "Three steps, no signup, no uploads.";
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
          {howWorksSubtitle}
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
          {differentiators.map(([title, body]) => (
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
