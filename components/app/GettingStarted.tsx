"use client";

// First-run onboarding checklist (2026-06-07, upgrade plan #5). A dismissible
// "getting started" card on the dashboard that drives the three activation
// actions. Step state is computed server-side from data the dashboard already
// has (no new queries); this client wrapper only owns dismissal (localStorage)
// and self-hides once every step is done — so returning users never see it.

import Link from "next/link";
import { useEffect, useState } from "react";
import { I } from "@/components/icons/Icons";

const DISMISS_KEY = "pdfcraft_onboarding_dismissed";

export function GettingStarted({
  emailVerified,
  ranAiTool,
  hasFiles,
}: {
  emailVerified: boolean;
  ranAiTool: boolean;
  hasFiles: boolean;
}) {
  // Default hidden until mount so dismissed/returning users never see a flash.
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const steps = [
    { label: "Verify your email", href: "/app/settings", cta: "Verify", done: emailVerified },
    { label: "Run your first AI tool", href: "/tools?filter=ai", cta: "Pick a tool", done: ranAiTool },
    { label: "Open a file in the app", href: "/app/files", cta: "Go to Files", done: hasFiles },
  ];
  const allDone = steps.every((s) => s.done);
  if (dismissed || allDone) return null;
  const completed = steps.filter((s) => s.done).length;

  return (
    <section className="card" style={{ padding: 20 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
        <h2 style={{ fontSize: 16, letterSpacing: "-0.01em", margin: 0 }}>Getting started</h2>
        <button
          type="button"
          aria-label="Dismiss getting started"
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, "1");
            } catch {
              /* private mode — just hide for this session */
            }
            setDismissed(true);
          }}
          style={{ display: "inline-flex", background: "transparent", border: "none", color: "var(--fg-subtle)", cursor: "pointer", padding: 4 }}
        >
          <I.X size={16} />
        </button>
      </div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        {completed} of {steps.length} done
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {steps.map((s, i) => (
          <div key={s.label} className="row" style={{ gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
            <span className="row" style={{ gap: 10, minWidth: 0 }}>
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  flexShrink: 0,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 12,
                  fontWeight: 600,
                  background: s.done ? "var(--accent-soft)" : "var(--bg-2)",
                  color: s.done ? "var(--accent)" : "var(--fg-subtle)",
                }}
              >
                {s.done ? <I.Check size={13} /> : i + 1}
              </span>
              <span style={{ fontSize: 14, textDecoration: s.done ? "line-through" : "none", color: s.done ? "var(--fg-subtle)" : "var(--fg)" }}>
                {s.label}
              </span>
            </span>
            {!s.done && (
              <Link href={s.href} className="btn btn-outline btn-sm">
                {s.cta}
              </Link>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
