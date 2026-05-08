// 2026-05-08 — Item #8 from the improvement analysis: inline tool
// explainers. Most tool runners had only the name + tagline; users
// who wanted to know "what does this actually do?" had to bounce
// to /help or back to /tools. Inline expandable explainer fixes
// that without adding visual weight to the runner.
//
// Rendered as a native <details>/<summary> for two reasons:
//   1. No JS/state needed — open/close handled by the browser,
//      keyboard-accessible by default, screen readers announce
//      "expanded/collapsed" automatically.
//   2. Default-collapsed so it doesn't push the actual tool UI
//      below the fold. Users who want context expand it; users who
//      don't ignore it.
//
// Why a shared component vs inline JSX per tool: there are 30+
// tool runners. Centralizing the layout + collapse semantics keeps
// them consistent and lets us evolve the explainer pattern (e.g.
// add a "watch a 30s demo" link later) in one place.

import { I } from "@/components/icons/Icons";

export interface ToolHowItWorksProps {
  /** 3-step procedure shown when expanded. Each step gets a numbered
   *  badge + title + body. Three steps is the canonical form across
   *  the SEO landing pages — keep it consistent. */
  steps: Array<{ title: string; body: string }>;
  /** Optional privacy reassurance line shown below the steps. Should
   *  be tool-specific (free tools say "browser-only", AI tools say
   *  "in-memory, zero retention"). */
  privacyNote?: string;
}

export function ToolHowItWorks({ steps, privacyNote }: ToolHowItWorksProps) {
  return (
    <details
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-1)",
        fontSize: 13,
      }}
    >
      <summary
        style={{
          padding: "10px 14px",
          cursor: "pointer",
          color: "var(--fg-muted)",
          listStyle: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <I.Info size={14} />
        How it works
      </summary>
      <div
        style={{
          padding: "0 16px 16px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {steps.map((step, i) => (
          <div
            key={step.title}
            style={{ display: "flex", gap: 10, alignItems: "flex-start" }}
          >
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                width: 22,
                height: 22,
                borderRadius: 11,
                background: "var(--accent-soft)",
                color: "var(--accent)",
                display: "grid",
                placeItems: "center",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {i + 1}
            </span>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 2 }}>
                {step.title}
              </div>
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                {step.body}
              </div>
            </div>
          </div>
        ))}
        {privacyNote ? (
          <p
            className="subtle"
            style={{
              fontSize: 11,
              lineHeight: 1.45,
              margin: "4px 0 0",
              fontStyle: "italic",
            }}
          >
            {privacyNote}
          </p>
        ) : null}
      </div>
    </details>
  );
}
