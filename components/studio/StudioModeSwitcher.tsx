"use client";

// Phase 6.3 — Studio mode switcher.
//
// Small client shell that owns the Batch ↔ Smart toggle state and swaps
// between the two runner components. The page above us (app/app/studio)
// stays a server component so auth redirects keep their quick path; all
// interactive state lives here.
//
// Design notes:
//   - The toggle is a visual segmented control, but internally it's a
//     pair of radio buttons for keyboard/a11y correctness (arrow keys
//     navigate between options, Space selects).
//   - We preserve each sub-component's own local state by always keeping
//     both mounted and toggling `hidden` via CSS — otherwise flipping
//     back to Batch mid-drag would wipe the user's queue. This is cheap
//     because neither component subscribes to global events until its
//     first interaction.
//   - Default mode is Batch. Smart is the new surface and we don't want
//     to surprise returning users with a different layout.

import { useCallback, useState } from "react";

import { StudioRunner } from "./StudioRunner";
import { AgentSmartMode } from "./AgentSmartMode";

type Mode = "batch" | "smart";

export function StudioModeSwitcher() {
  const [mode, setMode] = useState<Mode>("batch");

  const pick = useCallback((next: Mode) => {
    setMode(next);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ModeToggle mode={mode} onChange={pick} />

      <div hidden={mode !== "batch"}>
        <StudioRunner />
      </div>
      <div hidden={mode !== "smart"}>
        <AgentSmartMode />
      </div>
    </div>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (next: Mode) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Studio mode"
      style={{
        display: "inline-flex",
        alignSelf: "flex-start",
        padding: 3,
        borderRadius: 10,
        background: "var(--bg-subtle, #f5f5f5)",
        border: "1px solid var(--border, #e5e5e5)",
        gap: 2,
      }}
    >
      <ToggleOption
        label="Batch"
        hint="One tool × many files"
        selected={mode === "batch"}
        onSelect={() => onChange("batch")}
      />
      <ToggleOption
        label="Smart"
        hint="Describe the job, agent plans"
        selected={mode === "smart"}
        onSelect={() => onChange("smart")}
        badge="NEW"
      />
    </div>
  );
}

function ToggleOption({
  label,
  hint,
  selected,
  onSelect,
  badge,
}: {
  label: string;
  hint: string;
  selected: boolean;
  onSelect: () => void;
  badge?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        // Radio-group arrow semantics: Left/Up → previous; Right/Down → next.
        // Since we only have two options, both arrows just flip.
        if (
          e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "ArrowUp" ||
          e.key === "ArrowDown"
        ) {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        borderRadius: 8,
        border: "none",
        cursor: "pointer",
        background: selected ? "var(--bg, #ffffff)" : "transparent",
        boxShadow: selected ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
        color: selected ? "var(--fg, #111111)" : "var(--fg-muted, #555555)",
        fontSize: 14,
        fontWeight: selected ? 600 : 500,
        transition: "background 120ms ease, color 120ms ease",
      }}
    >
      <span>{label}</span>
      <span
        className="muted"
        style={{
          fontSize: 12,
          fontWeight: 400,
          color: selected ? "var(--fg-muted, #666666)" : "var(--fg-subtle, #888888)",
        }}
      >
        — {hint}
      </span>
      {badge ? (
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.04em",
            padding: "2px 6px",
            borderRadius: 4,
            background: "var(--accent-soft, #eef4ff)",
            color: "var(--accent, #2563eb)",
          }}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}
