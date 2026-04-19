import Link from "next/link";

export default function NotFound() {
  return (
    <main className="container-x" style={{ padding: "120px 28px", textAlign: "center" }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        ERROR · 404
      </div>
      <h1 style={{ fontSize: 56 }}>This page hasn&apos;t been ported yet.</h1>
      <p className="muted" style={{ fontSize: 18, maxWidth: 540, margin: "16px auto 32px" }}>
        We&apos;re migrating the prototype into Next.js phase-by-phase. Head home or browse tools.
      </p>
      <div className="row" style={{ justifyContent: "center", gap: 12 }}>
        <Link href="/" className="btn btn-lg btn-primary">
          Back home
        </Link>
        <Link href="/tools" className="btn btn-lg btn-outline">
          Browse tools
        </Link>
      </div>
    </main>
  );
}
