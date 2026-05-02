import { I } from "@/components/icons/Icons";

export function HeroDemo() {
  return (
    <div style={{ maxWidth: 1040, margin: "72px auto 0", position: "relative" }}>
      <div
        style={{
          background: "var(--bg-1)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          boxShadow: "var(--shadow-lg)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-2)",
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f57" }} />
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#febc2e" }} />
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#28c840" }} />
          <div
            style={{
              marginLeft: 16,
              fontSize: 12,
              color: "var(--fg-muted)",
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
            }}
          >
            pdfcraftai.com / chat-with-pdf
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", minHeight: 440 }}>
          <div style={{ borderRight: "1px solid var(--border)", padding: 20, background: "var(--bg)" }}>
            <div className="eyebrow" style={{ marginBottom: 16 }}>
              Source document
            </div>
            <div className="placeholder" style={{ aspectRatio: "0.77/1", marginBottom: 12 }}>
              Q3-Report.pdf
              <br />
              32 pages
            </div>
            <div className="col" style={{ gap: 6 }}>
              <div className="row" style={{ justifyContent: "space-between", fontSize: 12 }}>
                <span className="muted">Indexed</span>
                <span className="mono">32 / 32</span>
              </div>
              <div style={{ height: 4, background: "var(--bg-2)", borderRadius: 2 }}>
                <div
                  style={{ height: "100%", width: "100%", background: "var(--green)", borderRadius: 2 }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", padding: 24, gap: 16 }}>
            <div
              style={{
                background: "var(--bg-2)",
                borderRadius: 10,
                padding: "12px 14px",
                alignSelf: "flex-end",
                maxWidth: "70%",
                fontSize: 14,
              }}
            >
              What drove the 23% revenue jump last quarter?
            </div>
            <div style={{ alignSelf: "flex-start", maxWidth: "85%" }}>
              <div
                className="row"
                style={{ gap: 8, marginBottom: 6, color: "var(--fg-muted)", fontSize: 12 }}
              >
                <I.Sparkle size={14} style={{ color: "var(--accent)" }} />
                <span className="mono">ANALYZING...</span>
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.6 }}>
                The jump came from three drivers: <b>(1) enterprise expansion</b> up 41%{" "}
                <span style={{ color: "var(--accent)" }}>[p.8]</span>,{" "}
                <b>(2) net revenue retention</b> at 128%{" "}
                <span style={{ color: "var(--accent)" }}>[p.14]</span>, and <b>(3) the APAC launch</b>{" "}
                contributing $2.1M <span style={{ color: "var(--accent)" }}>[p.22]</span>.
              </div>
              <div className="row" style={{ marginTop: 16, gap: 6 }}>
                {["[p.8]", "[p.14]", "[p.22]"].map((c) => (
                  <span key={c} className="chip" style={{ color: "var(--accent)" }}>
                    {c}
                  </span>
                ))}
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "10px 12px",
                display: "flex",
                gap: 10,
                alignItems: "center",
                background: "var(--bg)",
              }}
            >
              <I.Paperclip size={16} style={{ color: "var(--fg-subtle)" }} />
              <div style={{ flex: 1, color: "var(--fg-subtle)", fontSize: 14 }}>
                Ask anything about this document…
              </div>
              <span className="chip chip-ai" style={{ fontSize: 10 }}>
                </span>
              <button className="btn btn-sm btn-accent" aria-label="Send">
                <I.Send size={12} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
