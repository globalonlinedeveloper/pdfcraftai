"use client";

// components/tools/HandoffSuggestions.tsx
//
// M9 part 2 (#193, 2026-04-29): shared "Open this output in: [Tool]
// [Tool] [Tool]" panel for tool success cards. Extracted from
// PageEditorTool's inline JSX so PageGridTool / PdfSplitTool /
// PdfMergeTool / PdfSimpleOpsTool / PdfSortPagesTool can all render
// the same panel with one import.
//
// Why a component (not a hook): the suggestions panel is pure JSX
// with no state, no effects, no per-consumer customization. A
// component is the simplest expression of "render this shape with
// these props."

import { I } from "@/components/icons/Icons";
import { registerHandoff, handoffUrl } from "@/lib/client/handoff";
import { suggestionsFor } from "@/lib/client/tool-suggestions";
import { toolById } from "@/lib/tools";

export interface HandoffSuggestionsProps {
  /** ID of the tool whose success card is rendering this panel.
   *  Used to look up the suggestion list and label the source on
   *  the registered handoff. Must match an id in lib/tools.ts. */
  sourceToolId: string;
  /** Output bytes to register for handoff. Each click on a suggestion
   *  button creates a fresh Blob from these bytes (so back-button
   *  re-registers also work). */
  outputBytes: Uint8Array;
  /** Filename for the output (used by the target tool's onFiles). */
  outputFileName: string;
  /** Visual mode. "border" adds a top border and uses the panel as
   *  a section of a parent card; "card" wraps the panel in its own
   *  card (for runners that don't already have a result card). */
  variant?: "border" | "card";
}

export function HandoffSuggestions({
  sourceToolId,
  outputBytes,
  outputFileName,
  variant = "border",
}: HandoffSuggestionsProps) {
  const targets = suggestionsFor(sourceToolId).slice(0, 3);
  if (targets.length === 0) return null;

  const wrapperStyle: React.CSSProperties =
    variant === "card"
      ? {
          padding: "12px 16px",
          background: "var(--bg-1)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
        }
      : {
          marginTop: 14,
          paddingTop: 14,
          borderTop: "1px solid var(--border)",
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
        };

  return (
    <div style={wrapperStyle}>
      <span className="subtle" style={{ fontSize: 12, marginRight: 4 }}>
        Open this output in:
      </span>
      {targets.map((targetId) => {
        const target = toolById(targetId);
        if (!target) return null;
        return (
          <a
            key={targetId}
            href={handoffUrl(targetId, "")}
            onClick={(e) => {
              e.preventDefault();
              const blob = new Blob([outputBytes], { type: "application/pdf" });
              const key = registerHandoff(blob, outputFileName, sourceToolId);
              window.location.href = handoffUrl(targetId, key);
            }}
            className="btn btn-sm btn-ghost"
            style={{ fontSize: 12, padding: "4px 10px" }}
          >
            {target.name} <I.ArrowRight size={11} />
          </a>
        );
      })}
    </div>
  );
}
