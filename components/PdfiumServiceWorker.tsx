"use client";

// components/PdfiumServiceWorker.tsx
//
// M23 (#193, 2026-04-29): registers /pdfium-sw.js on mount.
//
// Mounted from app/layout.tsx so it fires once per page load, but
// kept as a separate component (rather than inline in layout) so
// layout stays a server component. The "use client" directive scopes
// just this tiny registration logic.
//
// Why client-side registration: SW registration must happen in the
// browser. Server-side rendering can't call navigator.serviceWorker.
//
// Failure modes — all silent:
//   - navigator.serviceWorker missing (very old browser): no-op.
//   - Registration throws (rare; usually permission policy): logged
//     to console.warn but doesn't block the page.
//
// We DON'T attempt to handle "SW updated → reload tabs" here. Our
// SW only caches one static file (pdfium.wasm); tab reload is
// unnecessary because the next WASM fetch on this tab will pick up
// the new SW's cache logic naturally (or hit the existing browser
// HTTP cache as fallback).

import { useEffect } from "react";

export function PdfiumServiceWorker(): null {
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Defer registration to idle time so it doesn't compete with the
    // initial paint. requestIdleCallback isn't supported in Safari;
    // fall back to setTimeout(0).
    const schedule =
      typeof window.requestIdleCallback === "function"
        ? (cb: () => void) => window.requestIdleCallback(cb, { timeout: 2000 })
        : (cb: () => void) => setTimeout(cb, 0);
    schedule(() => {
      navigator.serviceWorker
        .register("/pdfium-sw.js", { scope: "/" })
        .catch((err) => {
          // Don't block the page on SW failure — the WASM still loads
          // via direct fetch, just without the cache-first speedup.
          console.warn("PDFium service worker registration failed:", err);
        });
    });
  }, []);

  return null;
}
