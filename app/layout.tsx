import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { MarketingChrome } from "@/components/nav/MarketingChrome";
import { SessionProviderWrapper } from "@/components/providers/SessionProviderWrapper";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://pdfcraftai.com"),
  title: {
    default: "pdfcraft ai — Every PDF tool you need",
    template: "%s · pdfcraft ai",
  },
  description:
    "Merge, split, convert, compress — always free. Chat, summarize, translate, redact with AI — pay only for what you use.",
  openGraph: {
    type: "website",
    siteName: "pdfcraft ai",
    title: "pdfcraft ai — Every PDF tool you need",
    description:
      "Every PDF tool you need. Plus the ones you didn't know existed.",
  },
  twitter: {
    card: "summary_large_image",
    title: "pdfcraft ai",
    description: "Every PDF tool you need. Plus the ones you didn't know existed.",
  },
  icons: {
    icon: "/favicon.ico",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#1a1c24" },
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased">
        {/* Prevent theme flash: apply stored theme before React hydrates */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => { try {
              const s = JSON.parse(localStorage.getItem('pdfcraft_state') || '{}');
              if (s.theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
            } catch (_) {} })();`,
          }}
        />
        <SessionProviderWrapper>
          <MarketingChrome>{children}</MarketingChrome>
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
