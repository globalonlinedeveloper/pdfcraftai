// Shared sub-navigation across the three billing-area pages (2026-06-07,
// upgrade plan #6). A safe, zero-route-change way to make Billing / Credits /
// Receipts feel like one section without merging the routes (a full merge on
// revenue-adjacent pages was deemed too risky for this pass). Server-rendered.

import Link from "next/link";

const TABS = [
  { key: "billing", label: "Billing", href: "/app/billing" },
  { key: "credits", label: "Credits", href: "/app/credits" },
  { key: "receipts", label: "Receipts", href: "/app/receipts" },
] as const;

export function BillingNav({ active }: { active: "billing" | "credits" | "receipts" }) {
  return (
    <nav
      className="row"
      aria-label="Billing sections"
      style={{ gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 4, flexWrap: "wrap" }}
    >
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={on ? "page" : undefined}
            style={{
              padding: "8px 14px",
              fontSize: 14,
              fontWeight: on ? 600 : 500,
              color: on ? "var(--fg)" : "var(--fg-muted)",
              textDecoration: "none",
              borderBottom: on ? "2px solid var(--accent)" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
