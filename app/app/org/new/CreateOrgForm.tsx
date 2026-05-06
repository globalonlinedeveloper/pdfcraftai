// Client form for /app/org/new. Calls a Server Action that wraps
// lib/orgs/writers.ts:recordOrgCreate. Server Action lets us write
// to the cookies / redirect on success without an API route + fetch
// dance.

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createOrgAction } from "./actions";

export function CreateOrgForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [billingMode, setBillingMode] = useState<
    "central" | "per_seat" | "credit_pool"
  >("central");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createOrgAction({ name, billingMode });
      if (result.ok) {
        // Future Phase F-2 part 2 builds /app/org/<slug>; until
        // then route back to dashboard with a query param so the
        // dashboard can show a "your org was created" toast.
        router.push(`/app/dashboard?org_created=${encodeURIComponent(result.slug)}`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="card" style={{ padding: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <label
          htmlFor="org-name"
          style={{
            display: "block",
            fontWeight: 600,
            fontSize: 14,
            marginBottom: 6,
          }}
        >
          Organization name
        </label>
        <input
          id="org-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Corp"
          required
          maxLength={255}
          disabled={pending}
          style={{
            width: "100%",
            padding: "10px 12px",
            fontSize: 14,
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--fg)",
          }}
        />
        <div
          className="muted"
          style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}
        >
          The URL slug is generated from the name. For instance,
          &ldquo;Acme Corp&rdquo; becomes <code>acme-corp</code>.
        </div>
      </div>

      <fieldset
        style={{
          marginBottom: 16,
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: 12,
        }}
      >
        <legend
          style={{
            padding: "0 6px",
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          Billing
        </legend>
        <div style={{ display: "grid", gap: 8 }}>
          {(
            [
              {
                value: "central" as const,
                title: "Central (recommended)",
                desc: "Owner pays. All members consume from one shared credit balance.",
              },
              {
                value: "per_seat" as const,
                title: "Per seat",
                desc: "Each member has their own credit pool. Org gets aggregate visibility.",
              },
              {
                value: "credit_pool" as const,
                title: "Shared pool",
                desc: "Shared balance across members, with per-member usage tracking for chargeback.",
              },
            ]
          ).map((opt) => (
            <label
              key={opt.value}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: 8,
                borderRadius: 4,
                cursor: pending ? "not-allowed" : "pointer",
                background:
                  billingMode === opt.value
                    ? "color-mix(in oklab, var(--accent) 8%, transparent)"
                    : "transparent",
              }}
            >
              <input
                type="radio"
                name="billingMode"
                value={opt.value}
                checked={billingMode === opt.value}
                onChange={() => setBillingMode(opt.value)}
                disabled={pending}
                style={{ marginTop: 3 }}
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {opt.title}
                </div>
                <div className="muted" style={{ fontSize: 12, lineHeight: 1.4 }}>
                  {opt.desc}
                </div>
              </div>
            </label>
          ))}
        </div>
        <div
          className="muted"
          style={{
            fontSize: 11,
            marginTop: 10,
            padding: 8,
            background: "var(--bg-2)",
            borderRadius: 4,
          }}
        >
          Note: today&rsquo;s foundation reserves all three modes in
          the schema but does not yet route credit_ledger entries
          based on the choice — Phase F-2 wires the billing
          enforcement.
        </div>
      </fieldset>

      {error ? (
        <div
          role="alert"
          className="card"
          style={{
            padding: "10px 12px",
            borderColor: "#c00",
            background: "color-mix(in oklab, #c00 6%, transparent)",
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={pending || name.trim().length === 0}
        >
          {pending ? "Creating…" : "Create organization"}
        </button>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => router.push("/app/dashboard")}
          disabled={pending}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
