import Link from "next/link";
import { I } from "@/components/icons/Icons";
import type { LegalDoc, LegalSlug } from "@/lib/legal-docs";
import { LEGAL_SLUGS, LEGAL_DOCS } from "@/lib/legal-docs";

export function LegalPage({ slug, doc }: { slug: LegalSlug; doc: LegalDoc }) {
  return (
    <main>
      <section style={{ paddingTop: 80, paddingBottom: 24 }}>
        <div
          className="container-x"
          style={{ maxWidth: 820, padding: "0 28px" }}
        >
          {/* Legal nav pills */}
          <nav
            className="row"
            style={{
              gap: 8,
              marginBottom: 28,
              flexWrap: "wrap",
            }}
            aria-label="Legal documents"
          >
            {LEGAL_SLUGS.map((s) => {
              const active = s === slug;
              return (
                <Link
                  key={s}
                  href={`/${s}`}
                  className="chip"
                  style={{
                    textDecoration: "none",
                    background: active ? "var(--accent-soft)" : "var(--bg-1)",
                    color: active ? "var(--accent)" : "var(--fg-subtle)",
                    borderColor: active ? "transparent" : "var(--border)",
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  {LEGAL_DOCS[s].title}
                </Link>
              );
            })}
          </nav>

          <div className="eyebrow" style={{ marginBottom: 8 }}>
            LEGAL
          </div>
          <h1
            style={{
              fontSize: 44,
              letterSpacing: "-0.03em",
              marginBottom: 12,
            }}
          >
            {doc.title}
          </h1>
          <div
            className="mono subtle"
            style={{ fontSize: 11, letterSpacing: "0.1em", marginBottom: 24 }}
          >
            LAST UPDATED · {doc.updated.toUpperCase()}
          </div>

          <p
            className="muted"
            style={{ fontSize: 17, lineHeight: 1.6, marginBottom: 24 }}
          >
            {doc.intro}
          </p>

          {doc.disclaimer && (
            <div
              className="card"
              style={{
                padding: 16,
                background: "var(--accent-soft)",
                borderColor: "transparent",
                marginBottom: 32,
              }}
            >
              <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
                <I.Shield size={16} />
                <div style={{ fontSize: 13, lineHeight: 1.55 }}>
                  <strong style={{ fontWeight: 600 }}>Note:</strong> {doc.disclaimer}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <section style={{ paddingBottom: 120 }}>
        <div
          className="container-x"
          style={{ maxWidth: 820, padding: "0 28px" }}
        >
          {doc.sections.map((section, i) => (
            <div
              key={section.h}
              style={{
                paddingTop: i === 0 ? 8 : 28,
                paddingBottom: 4,
                borderTop: i === 0 ? "1px solid var(--border)" : "1px solid var(--border)",
                marginTop: i === 0 ? 8 : 0,
              }}
            >
              <h2
                style={{
                  fontSize: 22,
                  letterSpacing: "-0.015em",
                  marginTop: 18,
                  marginBottom: 12,
                }}
              >
                {section.h}
              </h2>
              <p
                className="muted"
                style={{ fontSize: 15, lineHeight: 1.7, marginBottom: 20 }}
              >
                {section.p}
              </p>
            </div>
          ))}

          <div
            className="card"
            style={{
              marginTop: 40,
              padding: 24,
              textAlign: "center",
            }}
          >
            <p className="muted" style={{ fontSize: 14, margin: 0 }}>
              Questions about this document? Email{" "}
              <a
                href="mailto:support@pdfcraftai.com"
                style={{ color: "var(--accent)", textDecoration: "none" }}
              >
                support@pdfcraftai.com
              </a>
              .
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
