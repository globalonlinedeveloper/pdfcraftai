import type { Metadata } from "next";
import Link from "next/link";
import { I } from "@/components/icons/Icons";
import { API_ENDPOINTS, API_QUICKSTART } from "@/lib/api-endpoints";

export const metadata: Metadata = {
  title: "API — pdfcraft ai",
  description:
    "Build with PDFs like you build with Stripe. REST endpoints, webhooks, typed SDKs, and a free tier for hobby projects.",
  alternates: { canonical: "/api" },
  openGraph: {
    title: "API — pdfcraft ai",
    description: "Build with PDFs like you build with Stripe.",
    url: "/api",
    type: "website",
  },
};

export default function ApiPage() {
  return (
    <main>
      {/* Hero */}
      <section style={{ paddingTop: 80, paddingBottom: 40 }}>
        <div className="container-x" style={{ padding: "0 28px" }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            API
          </div>
          <h1
            style={{
              fontSize: 48,
              letterSpacing: "-0.03em",
              marginBottom: 16,
              maxWidth: 760,
            }}
          >
            Build with PDFs like you build with Stripe.
          </h1>
          <p
            className="muted"
            style={{ fontSize: 17, lineHeight: 1.55, maxWidth: 640, marginBottom: 28 }}
          >
            REST endpoints, webhooks, and typed SDKs. Free tier for hobby projects; pay only for
            AI-powered operations. No surprises.
          </p>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <Link href="#api-reference" className="btn btn-primary btn-lg">
              View endpoints
              <I.ArrowRight size={14} />
            </Link>
            <a
              href="mailto:support@pdfcraftai.com?subject=API%20access"
              className="btn btn-outline btn-lg"
            >
              Get an API key
            </a>
          </div>
        </div>
      </section>

      {/* Quickstart */}
      <section style={{ paddingTop: 32, paddingBottom: 64 }}>
        <div className="container-x" style={{ padding: "0 28px" }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            QUICKSTART
          </div>
          <h2 style={{ fontSize: 28, letterSpacing: "-0.02em", marginBottom: 24 }}>
            Summarize a PDF in under 2 minutes.
          </h2>
          <div
            className="card"
            style={{
              padding: 0,
              overflow: "hidden",
              background: "var(--bg-2)",
            }}
          >
            <div
              className="row"
              style={{
                padding: "14px 20px",
                borderBottom: "1px solid var(--border)",
                justifyContent: "space-between",
                background: "var(--bg-1)",
              }}
            >
              <span className="mono subtle" style={{ fontSize: 11, letterSpacing: "0.1em" }}>
                QUICKSTART.SH
              </span>
              <span className="chip chip-free">Node.js</span>
            </div>
            <pre
              className="mono"
              style={{
                margin: 0,
                padding: 24,
                overflowX: "auto",
                fontSize: 13,
                lineHeight: 1.65,
                color: "var(--fg)",
                whiteSpace: "pre",
              }}
            >
              <code>{API_QUICKSTART}</code>
            </pre>
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <section style={{ paddingBottom: 64 }}>
        <div className="container-x" style={{ padding: "0 28px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 16,
            }}
          >
            <FeatureCard
              icon="Code"
              title="Typed SDKs"
              body="Node, Python, Go. Full TypeScript types for every endpoint, with IntelliSense in your editor."
            />
            <FeatureCard
              icon="Flow"
              title="Webhooks"
              body="Async long jobs ping you back. HMAC-signed deliveries, automatic retries, and a replay dashboard."
            />
            <FeatureCard
              icon="Shield"
              title="Zero-retention"
              body="Flip one header and your files are deleted after processing. AI prompts never touch our logs."
            />
            <FeatureCard
              icon="Zap"
              title="Generous free tier"
              body="10,000 free operations/month for non-AI tools. Great for hobby projects and side apps."
            />
          </div>
        </div>
      </section>

      {/* Endpoints table */}
      <section id="api-reference" style={{ paddingTop: 16, paddingBottom: 120, scrollMarginTop: 96 }}>
        <div className="container-x" style={{ padding: "0 28px" }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            REFERENCE
          </div>
          <h2 style={{ fontSize: 28, letterSpacing: "-0.02em", marginBottom: 24 }}>
            Endpoints
          </h2>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "90px minmax(220px, 1fr) minmax(200px, 1.5fr) 140px",
                padding: "14px 20px",
                background: "var(--bg-1)",
                borderBottom: "1px solid var(--border)",
                fontSize: 11,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--fg-subtle)",
                fontWeight: 600,
              }}
              className="mono"
            >
              <span>Method</span>
              <span>Path</span>
              <span>Description</span>
              <span style={{ textAlign: "right" }}>Price</span>
            </div>
            {API_ENDPOINTS.map((ep, i) => (
              <div
                key={ep.path}
                style={{
                  display: "grid",
                  gridTemplateColumns: "90px minmax(220px, 1fr) minmax(200px, 1.5fr) 140px",
                  padding: "16px 20px",
                  borderTop: i === 0 ? "none" : "1px solid var(--border)",
                  alignItems: "center",
                  fontSize: 14,
                }}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.05em",
                    color: "var(--accent)",
                    fontWeight: 600,
                  }}
                >
                  {ep.method}
                </span>
                <span className="mono" style={{ fontSize: 13 }}>
                  {ep.path}
                </span>
                <span className="muted" style={{ fontSize: 13 }}>
                  {ep.desc}
                </span>
                <span
                  className="mono subtle"
                  style={{
                    fontSize: 11,
                    textAlign: "right",
                    letterSpacing: "0.05em",
                  }}
                >
                  {ep.price}
                </span>
              </div>
            ))}
          </div>

          <p className="muted" style={{ fontSize: 13, marginTop: 16, textAlign: "center" }}>
            Full reference docs, auth guide, and rate limits ship with Phase 2. Email{" "}
            <a
              href="mailto:support@pdfcraftai.com"
              style={{ color: "var(--accent)", textDecoration: "none" }}
            >
              support@pdfcraftai.com
            </a>{" "}
            for early access.
          </p>
        </div>
      </section>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: keyof typeof I;
  title: string;
  body: string;
}) {
  const Icon = I[icon];
  return (
    <div className="card" style={{ padding: 24 }}>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: "var(--accent-soft)",
          color: "var(--accent)",
          display: "grid",
          placeItems: "center",
          marginBottom: 14,
        }}
      >
        {Icon ? <Icon size={18} /> : null}
      </div>
      <h3 style={{ fontSize: 16, marginBottom: 6 }}>{title}</h3>
      <p className="muted" style={{ fontSize: 13, lineHeight: 1.55, margin: 0 }}>
        {body}
      </p>
    </div>
  );
}
