"use client";

import { usePathname } from "next/navigation";
import { TopNav } from "./TopNav";
import { Footer } from "./Footer";

/**
 * Conditionally renders the marketing TopNav + Footer.
 * Authenticated app routes (/app/*) and auth pages (login/register/signup/
 * forgot-password) render their own chrome inside their own layout, so we
 * hide the marketing chrome there.
 */
const HIDDEN_EXACT = new Set([
  "/login",
  "/register",
  "/signup",
  "/forgot-password",
]);
const HIDDEN_PREFIXES = ["/app"];

/**
 * Routes that keep the TopNav but suppress the Footer.
 * Empty after H8 — /studio (the macros canvas) was deleted, and was the
 * only route that needed full-bleed treatment.
 */
const NO_FOOTER_EXACT = new Set<string>();
const NO_FOOTER_PREFIXES: string[] = [];

export function MarketingChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";

  const isAppRoute =
    HIDDEN_EXACT.has(pathname) ||
    HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (isAppRoute) {
    return <>{children}</>;
  }

  const hideFooter =
    NO_FOOTER_EXACT.has(pathname) ||
    NO_FOOTER_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  return (
    <>
      <TopNav />
      <div className="page fade-in">{children}</div>
      {!hideFooter && <Footer />}
    </>
  );
}
