import type { Metadata } from "next";
import Link from "next/link";
import { I } from "@/components/icons/Icons";
import { ToolFilter } from "@/components/marketing/ToolFilter";
import { TOOL_STATS } from "@/lib/tools";

const META_DESC_SHORT = `Every PDF tool you need. ${TOOL_STATS.free} free forever, ${TOOL_STATS.ai} AI-powered.`;
const META_DESC_LONG = `Every PDF tool you need — ${TOOL_STATS.free} free forever, ${TOOL_STATS.ai} AI-powered. Merge, split, compress, convert, chat, summarize, translate, redact.`;

export const metadata: Metadata = {
  title: "All tools",
  description: META_DESC_LONG,
  alternates: { canonical: "/tools" },
  openGraph: {
    title: "All tools",
    description: META_DESC_SHORT,
    url: "/tools",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "All tools",
    description: META_DESC_SHORT,
  },
};

export default function ToolsPage() {
  return (
    <main>
      <section style={{ paddingTop: 80 }}>
        <div className="container-x" style={{ padding: "0 28px" }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            ALL TOOLS
          </div>
          <h1 style={{ fontSize: 40, marginBottom: 24 }}>Pick a tool, drop a file.</h1>

          {/* Bulk mode promo */}
          <Link
            href="/bulk"
            className="card card-hover"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              padding: 24,
              marginBottom: 32,
              borderColor: "var(--accent-soft)",
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 10,
                background: "var(--accent-soft)",
                color: "var(--accent)",
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
              }}
            >
              <I.Layers size={22} />
            </div>
            <div style={{ flex: 1 }}>
              <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                <span style={{ fontWeight: 500, fontSize: 15 }}>
                  Bulk mode — run any tool on many files
                </span>
                <span className="chip chip-new">NEW</span>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                Drop up to 500 PDFs, pick a tool, get a zip back. Works with every AI and free tool.
              </div>
            </div>
            <I.ArrowRight size={16} />
          </Link>

          <ToolFilter />
        </div>
      </section>

      <div style={{ padding: "80px 0" }} />
    </main>
  );
}
