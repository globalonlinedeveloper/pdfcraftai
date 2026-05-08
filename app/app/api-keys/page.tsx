// /app/api-keys — API key management surface (Tier 1 #1, 2026-05-08).
//
// Replaces the prior placeholder ("API access is coming soon").
// Real mint/revoke/list flow shipped here. The actual x-api-key
// header verification middleware that wires keys into AI route
// auth is a follow-up commit — this page surfaces the management
// loop standalone first so users can mint + revoke keys against
// the schema even before the verify middleware lands.

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { listKeys } from "@/lib/api-keys";
import { ApiKeyManager } from "./ApiKeyManager";

export const metadata: Metadata = {
  title: "API Keys",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ApiKeysPage() {
  const session = await auth();
  const userId = session?.user
    ? (session.user as { id?: string }).id
    : undefined;
  if (typeof userId !== "string") {
    redirect("/login?callbackUrl=/app/api-keys");
  }

  const keys = await listKeys(userId);
  // Server-side serialization: convert Date → ISO string for the
  // client component (Server-to-Client transfer requires
  // serializable values).
  const initialKeys = keys.map((k) => ({
    id: k.id,
    label: k.label,
    prefix: k.prefix,
    lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
    createdAt: k.createdAt.toISOString(),
  }));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        maxWidth: 820,
      }}
    >
      <header>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          API KEYS
        </div>
        <h1 style={{ fontSize: 28, letterSpacing: "-0.02em" }}>
          API keys
        </h1>
        <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
          Create keys to call pdfcraft ai from your own code or
          automation.
        </p>
      </header>

      {/* Usage instructions — keys are now usable for programmatic
          access on /api/ai/* via the x-api-key header. */}
      <div
        role="status"
        style={{
          padding: "12px 16px",
          borderRadius: 6,
          background: "var(--bg-2)",
          fontSize: 12,
          lineHeight: 1.6,
        }}
      >
        <strong>Usage:</strong> send your key in the{" "}
        <code style={{ fontSize: 11 }}>x-api-key</code> header on
        any <code style={{ fontSize: 11 }}>/api/ai/*</code> endpoint.
        Same per-user credit balance + daily cost ceiling apply as
        when calling from the browser. Example:
        <pre
          style={{
            marginTop: 8,
            padding: "8px 10px",
            background: "var(--bg)",
            borderRadius: 4,
            fontSize: 11,
            overflowX: "auto",
            lineHeight: 1.5,
          }}
        >
          {`curl https://pdfcraftai.com/api/ai/summarize \\
  -H "x-api-key: pck_..." \\
  -F "file=@document.pdf"`}
        </pre>
      </div>

      <ApiKeyManager initialKeys={initialKeys} />
    </div>
  );
}
