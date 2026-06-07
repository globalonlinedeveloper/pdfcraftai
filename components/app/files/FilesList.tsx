"use client";

// Client-side findability + bulk actions for /app/files.
//   - search-by-name + sort + source filter over the server-loaded rows
//   - honest "{shown} of {total}" with a cap note when total > loaded
//   - multi-select + bulk delete (upgrade plan #6)

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { I } from "@/components/icons/Icons";
import { toolById } from "@/lib/tools";
import { DeleteFileButton } from "@/components/app/files/DeleteFileButton";
import { OpenInChatButton } from "@/components/app/files/OpenInChatButton";
import { deleteFilesAction } from "@/lib/files-actions";

const AI_PREVIEWABLE_TOOL_IDS = new Set<string>([
  "ai-summarize",
  "ai-translate",
  "ai-compare",
  "ai-ocr",
]);

export type FileRow = {
  id: string;
  name: string;
  mime: string | null;
  sizeBytes: number;
  source: "upload" | "tool" | null;
  toolId: string | null;
  createdAt: string; // ISO — serialized across the RSC boundary
};

type SortKey = "newest" | "oldest" | "name" | "size";
type SourceFilter = "all" | "upload" | "tool";

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilesList({ rows, total }: { rows: FileRow[]; total: number }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [source, setSource] = useState<SourceFilter>("all");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (source === "upload" && r.source === "tool") return false;
      if (source === "tool" && r.source !== "tool") return false;
      if (needle && !r.name.toLowerCase().includes(needle)) return false;
      return true;
    });
    out = [...out].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "size") return b.sizeBytes - a.sizeBytes;
      const ta = Date.parse(a.createdAt), tb = Date.parse(b.createdAt);
      return sort === "oldest" ? ta - tb : tb - ta;
    });
    return out;
  }, [rows, q, sort, source]);

  const searching = q.trim().length > 0 || source !== "all";
  const FILTERS: { key: SourceFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "upload", label: "Uploads" },
    { key: "tool", label: "Tool outputs" },
  ];

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const exitSelect = () => { setSelectMode(false); setSelected(new Set()); };
  const bulkDelete = () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} file${ids.length === 1 ? "" : "s"}? This can't be undone.`)) return;
    startTransition(async () => {
      await deleteFilesAction(ids);
      exitSelect();
      router.refresh();
    });
  };

  return (
    <section>
      {/* Toolbar */}
      <div className="row" style={{ gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div
          className="row"
          style={{ flex: "1 1 240px", minWidth: 0, height: 38, background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: 10, padding: "0 12px", gap: 8 }}
        >
          <I.Search size={15} style={{ color: "var(--fg-subtle)", flexShrink: 0 }} />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search files by name…"
            aria-label="Search files by name"
            style={{ flex: 1, minWidth: 0, height: "100%", background: "transparent", border: "none", padding: 0, color: "var(--fg)", outline: "none", fontSize: 14 }}
          />
          {searching && (
            <button type="button" aria-label="Clear filters" onClick={() => { setQ(""); setSource("all"); }} style={{ background: "transparent", border: "none", color: "var(--fg-subtle)", cursor: "pointer", display: "flex", padding: 0 }}>
              <I.X size={15} />
            </button>
          )}
        </div>
        <div className="row" style={{ gap: 3, height: 38, boxSizing: "border-box", background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: 10, padding: "0 4px" }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setSource(f.key)}
              aria-pressed={source === f.key}
              className="btn"
              style={{ height: 30, padding: "0 12px", background: source === f.key ? "var(--bg-2)" : "transparent", border: "none", color: source === f.key ? "var(--fg)" : "var(--fg-subtle)", fontSize: 13 }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="row" style={{ height: 38, boxSizing: "border-box", gap: 8, background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: 10, padding: "0 12px" }}>
          <span className="mono" style={{ fontSize: 11, color: "var(--fg-subtle)", letterSpacing: "0.04em" }}>SORT</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort files" style={{ background: "transparent", border: "none", color: "var(--fg)", fontSize: 13, cursor: "pointer", outline: "none" }}>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name">Name (A–Z)</option>
            <option value="size">Size</option>
          </select>
        </label>
      </div>

      {/* Count + select controls */}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 16, letterSpacing: "-0.01em", margin: 0 }} role="status" aria-live="polite">
          {selectMode ? `${selected.size} selected` : searching ? `${view.length} of ${rows.length} shown` : `${total} file${total === 1 ? "" : "s"}`}
        </h2>
        <div className="row" style={{ gap: 8 }}>
          {!searching && !selectMode && total > rows.length && (
            <span className="subtle" style={{ fontSize: 12 }}>showing the {rows.length} most recent — search to find older</span>
          )}
          {view.length > 0 && !selectMode && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelectMode(true)}>Select</button>
          )}
          {selectMode && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={exitSelect}>Cancel</button>
              <button type="button" className="btn btn-sm" disabled={pending || selected.size === 0} onClick={bulkDelete} style={{ background: "var(--red)", color: "#fff", border: "none", opacity: selected.size === 0 ? 0.5 : 1 }}>
                {pending ? "Deleting…" : `Delete ${selected.size || ""}`.trim()}
              </button>
            </>
          )}
        </div>
      </div>

      {view.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: "center", borderStyle: "dashed" }}>
          <p className="muted" style={{ fontSize: 14, margin: 0 }}>
            {searching ? "No files match your filters." : "Files you register above will show up here."}
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {view.map((f, i) => {
            const isSel = selected.has(f.id);
            return (
              <div
                key={f.id}
                onClick={selectMode ? () => toggle(f.id) : undefined}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderTop: i === 0 ? "none" : "1px solid var(--border)", cursor: selectMode ? "pointer" : "default", background: isSel ? "var(--accent-soft)" : "transparent" }}
              >
                {selectMode && (
                  <input type="checkbox" checked={isSel} readOnly aria-label={`Select ${f.name}`} style={{ flexShrink: 0, width: 16, height: 16, accentColor: "var(--accent)" }} />
                )}
                <span style={{ color: "var(--fg-subtle)" }}><I.File size={16} /></span>
                <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                  <div style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={f.name}>{f.name}</div>
                  <div className="subtle" style={{ fontSize: 12 }}>{humanSize(f.sizeBytes)} · {new Date(f.createdAt).toLocaleString()}</div>
                </div>
                {!selectMode && (
                  <>
                    <SourceChip source={f.source} toolId={f.toolId} />
                    {f.source === "tool" && f.toolId && AI_PREVIEWABLE_TOOL_IDS.has(f.toolId) ? (
                      <Link href={`/app/files/${f.id}/preview`} aria-label="View" title="View" className="btn btn-ghost btn-sm" style={{ padding: 6, color: "var(--fg-muted)" }}>
                        <I.Eye size={14} />
                      </Link>
                    ) : null}
                    {f.mime === "application/pdf" ? <OpenInChatButton fileId={f.id} fileName={f.name} /> : null}
                    <DeleteFileButton id={f.id} />
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SourceChip({ source, toolId }: { source: FileRow["source"]; toolId: string | null }) {
  if (source === "tool" && toolId) {
    const tool = toolById(toolId);
    const label = tool ? tool.name : toolId;
    return (
      <span className="chip" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent)" }} title={`Produced by the ${label} tool`}>
        {label}
      </span>
    );
  }
  return (
    <span className="chip" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", background: "var(--bg-2)", color: "var(--fg-subtle)", borderColor: "var(--border)" }}>
      Upload
    </span>
  );
}
