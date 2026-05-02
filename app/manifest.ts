import type { MetadataRoute } from "next";

// 2026-05-02: PWA web app manifest. Today's production audit found
// /manifest.json and /manifest.webmanifest both returning 404, which
// meant the site was not "installable" — users couldn't Add to Home
// Screen with a custom name + icon. This file uses Next.js App Router
// conventions; the framework auto-emits it at /manifest.webmanifest
// (correct MIME type) and emits a `<link rel="manifest">` tag in
// every page's <head>.
//
// Conservative install scope: name + short_name + icons + display +
// theme/background colors. We deliberately skip:
//   - shortcuts (would need icon variants per shortcut, low ROI)
//   - share_target (lets the OS share files into the PWA, but our
//     single-file PDF tools work without it)
//   - protocol_handlers (specialized; not relevant to this product)
//
// Brand colors mirror app/icon.svg: #0066ff primary, white text on
// blue rounded-rect.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "pdfcraft ai — Every PDF tool you need",
    short_name: "pdfcraft ai",
    description:
      "Free PDF tools (merge, split, convert, compress) and AI-powered PDF tools (summarize, translate, OCR, redact). India-friendly INR pricing.",
    start_url: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#0066ff",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
    categories: ["productivity", "utilities"],
    lang: "en",
  };
}
