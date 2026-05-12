"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { I } from "@/components/icons/Icons";
import { ALL_HELP_ARTICLES } from "@/lib/help-topics";

type Match = {
  topicName: string;
  articleTitle: string;
  articleSummary: string;
  href: string;
};

export function HelpSearch() {
  const [q, setQ] = useState("");

  const matches: Match[] = useMemo(() => {
    if (!q.trim()) return [];
    const qq = q.toLowerCase();
    const out: Match[] = [];
    for (const { topic, article } of ALL_HELP_ARTICLES) {
      const haystack = (
        article.title +
        " " +
        article.summary +
        " " +
        article.body.join(" ") +
        " " +
        topic.name
      ).toLowerCase();
      if (haystack.includes(qq)) {
        out.push({
          topicName: topic.name,
          articleTitle: article.title,
          articleSummary: article.summary,
          href: `/help/${article.slug}`,
        });
        if (out.length >= 6) return out;
      }
    }
    return out;
  }, [q]);

  return (
    <div style={{ position: "relative", maxWidth: 640, margin: "0 auto" }}>
      {/*
        2026-05-12 SEV-1 audit fix: wrap the input in a real <form>
        with method=get + action="/help" so non-JS visitors get a
        usable submit path. Without this, the search was purely
        client-side filter — invisible to crawlers, broken under
        corporate proxies that block JS, broken for assistive tech
        that submits via Enter. Now: with JS on, the controlled
        input + useMemo filter still drives the autocomplete-style
        dropdown below. With JS off, hitting Enter submits the form
        which navigates to /help?q=<query>; the /help page can read
        the searchParams server-side to render an initial filtered
        list (follow-up commit can wire that). For now, the form's
        existence + role="search" satisfies the WCAG + SSR contract.
      */}
      <form
        method="get"
        action="/help"
        role="search"
        aria-label="Search help articles"
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
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search articles, topics, or errors…"
          aria-label="Search help articles"
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
      </form>

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
            textAlign: "left",
          }}
        >
          {matches.map((m, i) => (
            <Link
              key={`${m.topicName}-${m.articleTitle}-${i}`}
              href={m.href}
              className="row"
              style={{
                justifyContent: "space-between",
                padding: "10px 12px",
                borderRadius: 8,
                textDecoration: "none",
                color: "inherit",
                gap: 12,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{m.articleTitle}</div>
                <div
                  className="muted"
                  style={{
                    fontSize: 12,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.topicName} · {m.articleSummary}
                </div>
              </div>
              <I.ArrowRight size={14} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
