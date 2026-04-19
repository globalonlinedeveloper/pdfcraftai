"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { I } from "@/components/icons/Icons";

type NavLink = { href: string; label: string; accent?: boolean; eyebrow?: React.ReactNode };

const NAV: NavLink[] = [
  { href: "/agent", label: "Agent", accent: true, eyebrow: <I.Sparkle size={12} /> },
  { href: "/tools", label: "Tools" },
  { href: "/macros", label: "Macros" },
  { href: "/pricing", label: "Pricing" },
  { href: "/blog", label: "Blog" },
  { href: "/help", label: "Help" },
  { href: "/api", label: "API" },
];

export function TopNav() {
  const pathname = usePathname() ?? "/";
  const { data: session, status } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href === "/macros") return pathname === "/macros" || pathname.startsWith("/studio");
    return pathname === href || pathname.startsWith(href + "/");
  };

  const user = session?.user;
  const loggedIn = status === "authenticated" && !!user;
  const initial = (user?.name?.[0] ?? user?.email?.[0] ?? "?").toUpperCase();

  return (
    <header className="topnav">
      <Link href="/" className="logo">
        <span className="logo-mark">P</span>
        <span>
          pdfcraft<span style={{ color: "var(--accent)" }}>ai</span>
        </span>
      </Link>
      <nav>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={isActive(item.href) ? "active" : ""}
            style={item.accent ? { color: "var(--accent)" } : undefined}
          >
            {item.eyebrow && (
              <span style={{ verticalAlign: "middle", marginRight: 4, display: "inline-flex" }}>
                {item.eyebrow}
              </span>
            )}
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="spacer" />
      <div className="actions">
        {status === "loading" ? (
          // Reserve space to prevent layout shift while session loads
          <div style={{ width: 160, height: 32 }} aria-hidden />
        ) : loggedIn ? (
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="btn btn-sm btn-ghost"
              style={{ padding: "4px 10px 4px 4px", gap: 8 }}
            >
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: "var(--accent-soft)",
                  color: "var(--accent)",
                  display: "inline-grid",
                  placeItems: "center",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {initial}
              </span>
              <span style={{ fontSize: 13 }}>
                {user?.name?.split(" ")[0] ?? "Account"}
              </span>
              <I.ChevronDown size={12} />
            </button>

            {menuOpen && (
              <div
                role="menu"
                onMouseLeave={() => setMenuOpen(false)}
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  right: 0,
                  minWidth: 200,
                  background: "var(--bg-1)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  boxShadow: "var(--shadow)",
                  padding: 4,
                  zIndex: 50,
                }}
              >
                <div style={{ padding: "8px 10px 10px", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.2 }}>
                    {user?.name ?? "Account"}
                  </div>
                  <div className="subtle" style={{ fontSize: 11, lineHeight: 1.2, marginTop: 2 }}>
                    {user?.email}
                  </div>
                </div>
                <Link href="/app/dashboard" role="menuitem" onClick={() => setMenuOpen(false)} style={menuItem}>
                  Dashboard
                </Link>
                <Link href="/app/files" role="menuitem" onClick={() => setMenuOpen(false)} style={menuItem}>
                  Files
                </Link>
                <Link href="/app/settings" role="menuitem" onClick={() => setMenuOpen(false)} style={menuItem}>
                  Settings
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => signOut({ callbackUrl: "/" })}
                  style={{ ...menuItem, background: "transparent", border: "none", width: "100%", textAlign: "left", cursor: "pointer" }}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <Link href="/login" className="btn btn-sm btn-ghost">
              Log in
            </Link>
            <Link href="/register" className="btn btn-sm btn-primary">
              Get started
            </Link>
          </>
        )}
      </div>
    </header>
  );
}

const menuItem: React.CSSProperties = {
  display: "block",
  padding: "8px 10px",
  fontSize: 13,
  color: "var(--fg-muted)",
  textDecoration: "none",
  borderRadius: "var(--radius-sm)",
};
