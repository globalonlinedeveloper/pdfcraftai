"use client";

import { useState } from "react";
import { I } from "@/components/icons/Icons";

type Props = {
  q: string;
  a: string;
  defaultOpen?: boolean;
};

export function FaqItem({ q, a, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card" style={{ padding: 0, marginBottom: 8 }}>
      <button
        onClick={() => setOpen(!open)}
        className="row"
        style={{
          width: "100%",
          justifyContent: "space-between",
          padding: "18px 20px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "var(--fg)",
        }}
        aria-expanded={open}
      >
        <span style={{ fontSize: 15, fontWeight: 500 }}>{q}</span>
        <I.ChevronDown
          size={18}
          style={{
            transition: "transform .2s ease",
            transform: open ? "rotate(180deg)" : "rotate(0)",
            flexShrink: 0,
          }}
        />
      </button>
      {open && (
        <div
          className="muted"
          style={{ padding: "0 20px 18px", fontSize: 14, lineHeight: 1.55 }}
        >
          {a}
        </div>
      )}
    </div>
  );
}
