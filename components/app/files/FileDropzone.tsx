"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { registerFileAction } from "@/lib/files-actions";
import { I } from "@/components/icons/Icons";

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB
const ACCEPT = ["application/pdf"];

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function FileDropzone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFiles(list: FileList | File[]) {
    setError(null);
    const files = Array.from(list);
    if (files.length === 0) return;

    for (const file of files) {
      if (!ACCEPT.includes(file.type) && !file.name.toLowerCase().endsWith(".pdf")) {
        setError(`"${file.name}" — only PDF files are supported right now.`);
        return;
      }
      if (file.size > MAX_SIZE) {
        setError(`"${file.name}" exceeds the 50 MB metadata limit.`);
        return;
      }
    }

    setBusy(true);
    try {
      for (const file of files) {
        const hash = await sha256Hex(file);
        const fd = new FormData();
        fd.set("name", file.name);
        fd.set("mime", file.type || "application/pdf");
        fd.set("sizeBytes", String(file.size));
        fd.set("sha256", hash);
        const res = await registerFileAction(undefined, fd);
        if (!res.ok) {
          setError(res.error ?? "Upload failed.");
          break;
        }
      }
      router.refresh();
    } catch (err) {
      console.error(err);
      setError("Something went wrong while processing the file.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        style={{
          border: `2px dashed ${dragOver ? "var(--accent)" : "var(--border-strong)"}`,
          borderRadius: "var(--radius-lg)",
          padding: "40px 24px",
          textAlign: "center",
          background: dragOver ? "var(--accent-soft)" : "var(--bg-1)",
          cursor: busy ? "wait" : "pointer",
          transition: "background 150ms, border-color 150ms",
          opacity: busy ? 0.6 : 1,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: "var(--bg-2)",
            display: "grid",
            placeItems: "center",
            margin: "0 auto 12px",
            color: dragOver ? "var(--accent)" : "var(--fg-subtle)",
          }}
        >
          <I.Upload size={20} />
        </div>
        <p style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>
          {busy ? "Processing…" : "Drop a PDF here or click to browse"}
        </p>
        <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          Up to 50 MB. We register the file metadata only — bytes stay on your device during this preview.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
          }}
        />
      </div>

      {error && (
        <p role="alert" style={{ color: "var(--red)", fontSize: 13, marginTop: 12 }}>
          {error}
        </p>
      )}
    </div>
  );
}
