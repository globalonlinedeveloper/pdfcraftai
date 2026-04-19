// MacroBar — Phase 6.1 UI primitive.
//
// A compact chip row above an AI tool's params that lets users save the
// current params as a named preset, re-apply a saved preset with one
// click, and delete presets they no longer want.
//
// Design choices:
//   - Pure presentational component. No data fetching. The parent tool
//     component passes `macros`, the apply/save/delete callbacks, and
//     the currently-matching macro id (for highlighting). This keeps
//     MacroBar reusable across summarize / translate / any future tool
//     with parameters, because each tool's params shape lives in the
//     parent, not here.
//   - The "save current" action opens an inline name prompt rather than
//     a modal — one fewer layer, and the tool pages are already dense
//     enough. Enter commits, Escape / click-outside cancels.
//   - Rendering a deleted chip with opacity 0 → display:none via CSS
//     transition would be nicer, but that's a polish item. For now we
//     just drop it from the list (the parent rebuilds state).
//   - We intentionally don't render the macro's params inline (e.g.
//     `"Spanish translations · es"`). The macro name is the contract;
//     users pick names they understand, the code doesn't second-guess.
//
// Disabled state:
//   - When `disabled` is true (e.g. the tool is busy running), the chip
//     row greys out and buttons stop responding. Apply while busy would
//     race with the in-flight request — safer to block.
//   - When `macros` is empty AND the user hasn't signed in, we hide the
//     save-current button entirely (no point — they can't persist).
//
// Accessibility:
//   - Each chip is a <button type="button"> so keyboard nav works.
//   - The inline name prompt is labelled and grabs focus on open.

"use client";

import { useEffect, useRef, useState } from "react";

import { I } from "@/components/icons/Icons";

export type MacroBarItem = {
  id: string;
  name: string;
  /** Free-form per-tool params; parent narrows on apply. */
  params: Record<string, unknown>;
};

type MacroBarProps = {
  /** Macros for the current tool, in display order (most recent first). */
  macros: MacroBarItem[];
  /** True while the parent tool is running — chip row goes non-interactive. */
  disabled?: boolean;
  /** True when the signed-in-user check passed; false hides the save button. */
  canSave: boolean;
  /** ID of the macro whose params exactly match the tool's current state,
   *  or null if no match. Drives the "selected" chip styling. */
  activeId?: string | null;
  /** User clicked a chip → apply its params to the tool's form state. */
  onApply: (macro: MacroBarItem) => void;
  /** User typed a name + submitted → create a new macro from current state. */
  onSave: (name: string) => Promise<void> | void;
  /** User clicked the trash on a chip → remove it. */
  onDelete: (id: string) => Promise<void> | void;
};

export function MacroBar({
  macros,
  disabled = false,
  canSave,
  activeId = null,
  onApply,
  onSave,
  onDelete,
}: MacroBarProps) {
  const [naming, setNaming] = useState(false);
  const [pendingName, setPendingName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (naming) inputRef.current?.focus();
  }, [naming]);

  // Nothing to show and no way to save → render nothing at all. Tool
  // pages shouldn't have a ghost empty chip row.
  if (macros.length === 0 && !canSave) return null;

  const commitSave = async () => {
    const name = pendingName.trim();
    if (!name) {
      setError("Give this macro a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(name);
      setNaming(false);
      setPendingName("");
    } catch (err) {
      // Parent is expected to throw for DB/validation failures; we show
      // the message inline so the user can correct and retry without
      // losing the typed name.
      setError(err instanceof Error ? err.message : "Couldn't save macro.");
    } finally {
      setSaving(false);
    }
  };

  const cancelSave = () => {
    setNaming(false);
    setPendingName("");
    setError(null);
  };

  return (
    <div
      aria-label="Saved presets"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        padding: "6px 0",
      }}
    >
      {macros.map((m) => {
        const active = m.id === activeId;
        return (
          <span
            key={m.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              border: "1px solid var(--border)",
              borderColor: active ? "var(--accent)" : "var(--border)",
              background: active ? "var(--accent-soft)" : "var(--bg-1)",
              borderRadius: 999,
              padding: "3px 4px 3px 10px",
              fontSize: 12,
              opacity: disabled ? 0.5 : 1,
              transition: "border-color 120ms, background 120ms",
            }}
          >
            <button
              type="button"
              onClick={() => !disabled && onApply(m)}
              disabled={disabled}
              title={active ? "Currently applied" : `Apply "${m.name}"`}
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                color: "inherit",
                font: "inherit",
                cursor: disabled ? "not-allowed" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              {active ? (
                <I.Check size={12} />
              ) : (
                <I.Star size={12} />
              )}
              <span>{m.name}</span>
            </button>
            <button
              type="button"
              onClick={() => !disabled && onDelete(m.id)}
              disabled={disabled}
              aria-label={`Delete ${m.name}`}
              title="Delete"
              style={{
                background: "transparent",
                border: "none",
                padding: 2,
                color: "var(--fg-subtle)",
                cursor: disabled ? "not-allowed" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                borderRadius: 999,
              }}
            >
              <I.X size={11} />
            </button>
          </span>
        );
      })}

      {canSave && !naming && (
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => setNaming(true)}
          disabled={disabled}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "3px 10px",
            fontSize: 12,
            borderRadius: 999,
          }}
        >
          <I.Plus size={12} />
          Save current…
        </button>
      )}

      {naming && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            border: "1px solid var(--border)",
            borderRadius: 999,
            padding: "2px 4px 2px 10px",
            background: "var(--bg-1)",
          }}
        >
          <input
            ref={inputRef}
            type="text"
            placeholder="Name this preset"
            value={pendingName}
            maxLength={80}
            onChange={(e) => {
              setPendingName(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commitSave();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelSave();
              }
            }}
            disabled={saving || disabled}
            aria-label="Macro name"
            style={{
              border: "none",
              outline: "none",
              background: "transparent",
              font: "inherit",
              fontSize: 12,
              width: 140,
              padding: 0,
            }}
          />
          <button
            type="button"
            onClick={() => void commitSave()}
            disabled={saving || disabled || !pendingName.trim()}
            aria-label="Save macro"
            title="Save"
            style={{
              background: "transparent",
              border: "none",
              padding: 2,
              color:
                pendingName.trim() && !saving
                  ? "var(--accent)"
                  : "var(--fg-subtle)",
              cursor:
                saving || !pendingName.trim() ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <I.Check size={12} />
          </button>
          <button
            type="button"
            onClick={cancelSave}
            disabled={saving}
            aria-label="Cancel"
            title="Cancel"
            style={{
              background: "transparent",
              border: "none",
              padding: 2,
              color: "var(--fg-subtle)",
              cursor: saving ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <I.X size={11} />
          </button>
        </span>
      )}

      {error && (
        <span
          role="alert"
          style={{
            fontSize: 11,
            color: "var(--danger, #c53030)",
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
