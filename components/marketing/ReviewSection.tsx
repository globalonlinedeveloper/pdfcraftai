// SEO Ship #7 (2026-04-25): review/quote section used on landing pages
// for social proof. Renders 3 curated quotes as cards; emits no
// AggregateRating JSON-LD yet (intentional — we don't have enough
// public review volume to claim a global rating without crossing the
// line into fabrication).

import { reviewsForTopic } from "@/lib/reviews";

export function ReviewSection({ topic }: { topic?: string }) {
  const reviews = reviewsForTopic(topic, 3);
  return (
    <section style={{ padding: "60px 0", background: "var(--bg-1)" }}>
      <div className="container-x" style={{ padding: "0 28px", maxWidth: 1080 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          WHAT USERS SAY
        </div>
        <h2 style={{ fontSize: 28, letterSpacing: "-0.02em", marginBottom: 24 }}>
          From people who switched
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {reviews.map((r, i) => (
            <div key={i} className="card" style={{ padding: 24 }}>
              <div
                aria-label="5 stars"
                style={{
                  letterSpacing: 2,
                  color: "#FFB400",
                  fontSize: 14,
                  marginBottom: 12,
                }}
              >
                ★★★★★
              </div>
              <blockquote
                style={{
                  fontSize: 14,
                  lineHeight: 1.6,
                  margin: 0,
                  marginBottom: 12,
                  fontStyle: "italic",
                }}
              >
                &ldquo;{r.text}&rdquo;
              </blockquote>
              <div className="muted" style={{ fontSize: 12, fontWeight: 500 }}>
                — {r.attribution}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
