"use client";

import { useMemo, useState } from "react";
import { I } from "@/components/icons/Icons";
import { HELP_TOPICS } from "@/lib/help-topics";

type Match = { topic: string; article: string };

export function HelpSearch() {
  const [q, setQ] = useState("");

  const matches: Match[] = useMemo(() => {
    if (!q.trim()) return [];
    const qq = q.toLowerCase();
    const out: Match[] = [];
    for (const topic of HELP_TOPICS) {
      for (const art of topic.arts) {
        if (art.toLowerCase().includes(qq)) {
          out.push({ topic: topic.name, article: art });
          if (out.length >= 6) return out;
        }
      }
    }
    return out;
  }, [q]);

  return (
    <div style={{ position: "relative", maxWidth: 640, margin: "0 auto" }}>
      <div
        className="row"
        style={{
          background: "var(--bg-1)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "0 16px",
          gap: 10,
        }}
      >
        <I.Search size={18} />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search articles, topics, or errors…"
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            padding: "16px 0",
            color: "var(--fg)",
            outline: "none",
            fontSize: 15,
          }}
        />
      </div>

      {matches.length > 0 && (
        <div
          className="card"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            right: 0,
            padding: 8,
            zIndex: 20,
            background: "var(--bg-1)",
          }}
        >
          {matches.map((m, i) => (
            <div
              key={`${m.topic}-${m.article}-${i}`}
              className="row"
              style={{
                justifyContent: "space-between",
                padding: "10px 12px",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{m.article}</div>
                <div className="muted" style={{ fontSize: 12 }}>{m.topic}</div>
              </div>
              <I.ArrowRight size={14} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
