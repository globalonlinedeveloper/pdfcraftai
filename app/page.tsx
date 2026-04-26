import type { Metadata } from "next";
import Link from "next/link";
import { I } from "@/components/icons/Icons";
import { TOOL_STATS } from "@/lib/tools";
import { HeroDemo } from "@/components/landing/HeroDemo";
import { ToolsShowcase } from "@/components/landing/ToolsShowcase";
import {
  AgentPromo,
  MacrosPromo,
  HowItWorks,
  Audience,
  Security,
  FinalCTA,
} from "@/components/landing/LandingSections";

// Title + description + OG/twitter come from the root layout's metadata
// (it sets the site-level defaults). We only need to pin the canonical to
// `/` here — without this, `/` is the only route in the app that ships no
// `<link rel="canonical">`, which the 2026-04-20 audit flagged as SEV-3.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <main>
      {/* ===== Hero ===== */}
      <section style={{ position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, opacity: 0.4 }} className="grid-bg" />
        <div
          style={{
            position: "absolute",
            top: "-20%",
            left: "50%",
            transform: "translateX(-50%)",
            width: 900,
            height: 500,
            background:
              "radial-gradient(ellipse, color-mix(in oklab, var(--accent) 20%, transparent), transparent 70%)",
            pointerEvents: "none",
          }}
        />

        <div
          className="container-x"
          style={{ position: "relative", padding: "120px 28px 80px", textAlign: "center" }}
        >
          <div className="row" style={{ justifyContent: "center", marginBottom: 28 }}>
            <span className="chip chip-new">
              <span
                style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }}
              />{" "}
              New: AI Redact v2 · Live now
            </span>
          </div>

          <h1 className="hero-jumbo" style={{ maxWidth: 900, margin: "0 auto" }}>
            Every PDF tool you need.
            <br />
            <span
              style={{
                background:
                  "linear-gradient(110deg, var(--accent), oklch(0.70 0.16 300) 60%, var(--blue))",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              Plus the ones you didn&apos;t know existed.
            </span>
          </h1>

          <p
            className="muted"
            style={{ fontSize: 20, maxWidth: 640, margin: "28px auto 0", lineHeight: 1.5 }}
          >
            Merge, split, convert, compress — always free. Chat, summarize, translate, redact with AI —
            pay only for what you use.
          </p>

          <div className="row" style={{ justifyContent: "center", gap: 12, marginTop: 40 }}>
            <Link href="/tools" className="btn btn-lg btn-primary">
              Try it now — no signup <I.ArrowRight size={16} />
            </Link>
            <Link href="/pricing" className="btn btn-lg btn-outline">
              View pricing
            </Link>
          </div>

          <div
            className="row"
            style={{
              justifyContent: "center",
              gap: 24,
              marginTop: 24,
              color: "var(--fg-subtle)",
              fontSize: 13,
            }}
          >
            <span className="row" style={{ gap: 6 }}>
              <I.Check size={14} /> {TOOL_STATS.total} tools
            </span>
            <span className="row" style={{ gap: 6 }}>
              <I.Check size={14} /> {TOOL_STATS.free} free forever
            </span>
            <span className="row" style={{ gap: 6 }}>
              <I.Check size={14} /> BYOK on Pro+
            </span>
          </div>

          <HeroDemo />
        </div>
      </section>

      {/* ===== Tools showcase ===== */}
      <ToolsShowcase />

      {/* ===== Agent promo ===== */}
      <AgentPromo />

      {/* ===== Macros / Workflow Studio promo ===== */}
      <MacrosPromo />

      {/* ===== How credits work ===== */}
      <HowItWorks />

      {/* ===== Built for ===== */}
      <Audience />

      {/* ===== Security ===== */}
      <Security />

      {/* ===== Final CTA ===== */}
      <FinalCTA />
    </main>
  );
}
