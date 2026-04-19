/**
 * Client-only utilities for the Phase 3 PDF tools.
 * All PDF processing happens in the browser via pdf-lib — nothing is uploaded.
 */

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const PDF_MIME = "application/pdf";
export const PDF_ACCEPT = "application/pdf,.pdf";

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function isPdfFile(file: File): boolean {
  return (
    file.type === PDF_MIME ||
    file.type === "" /* some browsers leave it empty */ ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}

/** SHA-256 hex digest of the file's bytes, computed in the browser. */
export async function sha256HexOfFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256HexOfBytes(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer so we're not handing Web Crypto a
  // SharedArrayBuffer (which most runtimes refuse to hash).
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Trigger a browser download for an in-memory byte array. */
export function downloadBytes(bytes: Uint8Array, filename: string, mime = PDF_MIME) {
  // Wrap the Uint8Array in a fresh buffer so Blob gets a regular ArrayBuffer.
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const blob = new Blob([buf], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a beat, then revoke.
  setTimeout(() => URL.revokeObjectURL(url), 4_000);
}

/** Parse a range spec like "1-3, 7, 9-12" into 1-based page arrays. */
export function parsePageRanges(spec: string, totalPages: number): number[][] {
  const groups: number[][] = [];
  const chunks = spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const chunk of chunks) {
    const m = chunk.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw new Error(`Invalid range: "${chunk}"`);
    const start = parseInt(m[1]!, 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    if (start < 1 || end < 1 || start > totalPages || end > totalPages) {
      throw new Error(`Out of bounds: "${chunk}" (document has ${totalPages} pages)`);
    }
    if (end < start) throw new Error(`End before start: "${chunk}"`);
    const arr: number[] = [];
    for (let i = start; i <= end; i++) arr.push(i);
    groups.push(arr);
  }
  if (groups.length === 0) throw new Error("No ranges specified.");
  return groups;
}

/**
 * Derive a safe output filename from an input filename.
 *   input.pdf + "-merged"  → "input-merged.pdf"
 *   input.PDF + "-1-3"     → "input-1-3.pdf"
 */
export function deriveOutputName(originalName: string, suffix: string): string {
  const base = originalName.replace(/\.pdf$/i, "");
  return `${base}${suffix}.pdf`;
}
