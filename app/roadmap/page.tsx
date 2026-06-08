import Link from "next/link";
import { MarketingHero } from "@/components/marketing/MarketingHero";
import { I } from "@/components/icons/Icons";
import { pageMetadata } from "@/lib/page-metadata";

export const metadata = pageMetadata({
  title: "Roadmap",
  description:
    "What we're building next at pdfcraft ai — an honest, public roadmap. Now, Next, and Later. Built in the open by one person.",
  canonical: "/roadmap",
});

type Item = { title: string; body: string };
type Column = { label: string; icon: keyof typeof I; tone: string; items: Item[] };

// Honest direction, not dated promises. Keep in sync with the changelog as
// items ship (move them to /changelog and add a fresh Next item).
const COLUMNS: Column[] = [
  {
    label: "Now",
    icon: "Zap",
    tone: "var(--accent)",
    items: [
      { title: "Faster AI", body: "Streaming responses for chat and long summaries so results start appearing immediately." },
      { title: "Account lifecycle", body: "Welcome, receipt, and low-credit emails so nothing important happens silently." },
      { title: "Live payments", body: "Real card/UPI checkout the moment our payment gateway approval lands (test mode today)." },
    ],
  },
  {
    label: "Next",
    icon: "ArrowRight",
    tone: "var(--blue)",
    items: [
      { title: "International payments", body: "Card payments for customers outside India, on the same gateway." },
      { title: "Referral rewards", body: "Invite a friend, you both get credits — fully wired, not just a code." },
      { title: "More tools", body: "PDF compression and Office (Word/Excel/PPT) conversions back in the catalog." },
      { title: "In-app notifications", body: "Consistent toasts and a 'what's new' feed across the workspace." },
    ],
  },
  {
    label: "Later",
    icon: "Globe",
    tone: "var(--green)",
    items: [
      { title: "Hindi (then more)", body: "A localized interface for our India-first audience, starting with the top flows." },
      { title: "Team features", body: "Shared credits, roles, and a team workspace." },
      { title: "Deeper integrations", body: "Bring your documents in from the places you already keep them." },
    ],
  },
];

export default function RoadmapPage() {
  return (
    <main>
      <MarketingHero
        chip={{ label: "Built in the open", tone: "new" }}
        eyebrow="ROADMAP"
        title="Where pdfcraft ai is headed."
        subtitle="An honest, public roadmap — directions, not dated promises. Made by one person, shipped continuously. See what's already live on the changelog."
        primaryCta={{ href: "/changelog", label: "What's shipped" }}
        secondaryCta={{ href: "/tools", label: "Browse tools" }}
      />

      <section className="section">
        <div className="container-x">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
              gap: 16,
              alignItems: "start",
            }}
          >
            {COLUMNS.map((col) => {
              const Ic = I[col.icon];
              return (
                <div key={col.label} className="card" style={{ padding: 24 }}>
                  <div className="row" style={{ gap: 10, marginBottom: 16 }}>
                    <span
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: "var(--bg-2)",
                        display: "grid",
                        placeItems: "center",
                        color: col.tone,
                      }}
                    >
                      <Ic size={16} />
                    </span>
                    <h2 style={{ fontSize: 22, margin: 0 }}>{col.label}</h2>
                  </div>
                  <div className="col" style={{ gap: 14 }}>
                    {col.items.map((it) => (
                      <div key={it.title}>
                        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 2 }}>{it.title}</div>
                        <p className="muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>{it.body}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="muted" style={{ textAlign: "center", marginTop: 32, fontSize: 13 }}>
            Something you need that isn&apos;t here?{" "}
            <Link href="/contact" style={{ color: "var(--accent)", textDecoration: "underline" }}>
              Tell us
            </Link>{" "}
            — solo-built means feedback moves fast.
          </p>
        </div>
      </section>
    </main>
  );
}
