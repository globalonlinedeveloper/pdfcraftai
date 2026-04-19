import type { Metadata } from "next";
import Link from "next/link";
import { I } from "@/components/icons/Icons";

export const metadata: Metadata = {
  title: "API Keys",
  robots: { index: false, follow: false },
};

export default function ApiKeysPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 820 }}>
      <header>
        <div className="eyebrow" style={{ marginBottom: 6 }}>API KEYS</div>
        <h1 style={{ fontSize: 28, letterSpacing: "-0.02em" }}>API keys</h1>
        <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
          Create keys to call pdfcraft ai from your own code.
        </p>
      </header>

      <div
        className="card"
        style={{
          padding: 32,
          textAlign: "center",
          borderStyle: "dashed",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: "var(--bg-2)",
            display: "grid",
            placeItems: "center",
            margin: "0 auto 12px",
            color: "var(--fg-subtle)",
          }}
        >
          <I.Key size={18} />
        </div>
        <p style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>
          API access is coming soon
        </p>
        <p className="muted" style={{ fontSize: 13, marginTop: 6, maxWidth: 440, margin: "6px auto 16px" }}>
          We're finalizing scopes, rate limits, and the developer SDK. The public API will launch with keys, webhooks, and typed clients for TypeScript and Python.
        </p>
        <Link href="/api" className="btn btn-ghost btn-sm">
          Preview API docs
        </Link>
      </div>
    </div>
  );
}
