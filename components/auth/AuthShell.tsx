import Link from "next/link";
import type { ReactNode } from "react";

export function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "48px 20px" }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <Link href="/" className="logo" style={{ marginBottom: 32, justifyContent: "flex-start" }}>
          <span className="logo-mark">P</span>
          <span>
            pdfcraft<span style={{ color: "var(--accent)" }}>ai</span>
          </span>
        </Link>

        <div className="card" style={{ padding: 28 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>{eyebrow}</div>
          <h1 style={{ fontSize: 28, letterSpacing: "-0.02em", marginBottom: 6 }}>{title}</h1>
          {subtitle && (
            <p className="muted" style={{ fontSize: 14, lineHeight: 1.55, marginBottom: 22 }}>
              {subtitle}
            </p>
          )}
          {children}
        </div>

        {footer && (
          <p className="muted" style={{ fontSize: 13, textAlign: "center", marginTop: 20 }}>
            {footer}
          </p>
        )}
      </div>
    </main>
  );
}
