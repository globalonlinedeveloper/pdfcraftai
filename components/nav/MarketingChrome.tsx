"use client";

import { usePathname } from "next/navigation";
import { TopNav } from "./TopNav";
import { Footer } from "./Footer";

/**
 * Conditionally renders the marketing TopNav + Footer.
 * Authenticated app routes (/app/*) and auth pages (/login, /register)
 * render their own chrome inside their own layout, so we hide the
 * marketing chrome there.
 */
const HIDDEN_PREFIXES = ["/app", "/login", "/register"];

export function MarketingChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const isAppRoute = HIDDEN_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  if (isAppRoute) {
    return <>{children}</>;
  }

  return (
    <>
      <TopNav />
      <div className="page fade-in">{children}</div>
      <Footer />
    </>
  );
}
