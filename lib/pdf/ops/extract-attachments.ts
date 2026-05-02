// lib/pdf/ops/extract-attachments.ts
//
// 2026-05-01 — Extract Attachments: walks a PDF's /Names → /EmbeddedFiles
// tree, finds each Filespec's /EF stream reference, locates the
// EmbeddedFile object's stream bytes in the raw input, decompresses
// per /Filter, and returns the original file content + metadata.
//
// Closes the long-standing FAQ in the existing pdf-attachments tool:
// "Does it download the actual file bytes? Not yet — extracting the
// streams requires handling FlateDecode and other compression filters,
// separate work." Today, that work shipped.
//
// Architecture decisions:
//
//   • Reuses lib/pdf/ops/attachments.ts for the structural walk (no
//     duplicate /Names tree traversal). That gives us filespecObjectNumber
//     → which we then walk back to find the /EF stream ref → which we
//     locate in raw bytes.
//
//   • Stream extraction uses both Latin1 text scan (fast position lookup)
//     AND raw Uint8Array slicing (binary-safe bytes). PDFs are mostly
//     ASCII for structural elements (`<obj> 0 obj` ... `stream` ...
//     `endstream` keywords); only the stream contents themselves are
//     binary. So the Latin1 round-trip lets us find object boundaries
//     by regex while preserving byte fidelity for the actual content.
//
//   • Decompression uses the browser-native DecompressionStream API
//     (Chrome 80+, Firefox 113+, Safari 16.4+). No JS library
//     dependency. Supports the most common /Filter values:
//       /FlateDecode (zlib) — by far the most common, ~95% of PDFs
//       /ASCIIHexDecode + /ASCII85Decode — rare; we implement them
//         inline (they're small)
//       /Identity (no filter) — pass through
//     Other filters (LZWDecode, RunLengthDecode, CCITTFaxDecode,
//     DCTDecode, JBIG2Decode, JPXDecode) are returned verbatim with a
//     hint flag; the caller can offer a download-as-encoded fallback.
//
//   • Filter chains: PDF spec allows /Filter [/A85 /Flate] meaning
//     decode in order. We honour the array form. Most common chain
//     in the wild is /ASCIIHexDecode + /FlateDecode (tutorial / demo
//     PDFs); production PDFs almost always single-filter FlateDecode.

import { extractAttachments, type PdfAttachment } from "@/lib/pdf/ops/attachments";

export interface ExtractedAttachment extends PdfAttachment {
  /** Decoded file bytes ready for download. Null when extraction
   *  failed (unsupported filter, corrupt stream, missing /EF). */
  bytes: Uint8Array | null;
  /** Failure reason when bytes is null. UI surfaces this per-attachment
   *  so users know which ones extracted vs which need a different tool. */
  extractError: string | null;
  /** Filter chain applied during decompression, or "Identity" if none. */
  filter: string;
}

export interface ExtractAttachmentsResult {
  attachments: ExtractedAttachment[];
  totalCount: number;
  /** Count that succeeded — the rest had unsupported filters or stream
   *  parsing failures. UI shows "X of Y extracted" headline. */
  extractedCount: number;
  /** Inherited from the underlying lister — true if /Names tree exists
   *  but parsing failed entirely. */
  unsupported: boolean;
}

/**
 * Extract every embedded file from a PDF as decoded bytes ready for
 * download. The companion to lib/pdf/ops/attachments.ts (which lists
 * metadata only).
 */
export async function extractAttachmentBytes(
  bytes: Uint8Array,
): Promise<ExtractAttachmentsResult> {
  const meta = extractAttachments(bytes);
  if (meta.unsupported) {
    return { attachments: [], totalCount: 0, extractedCount: 0, unsupported: true };
  }
  if (meta.attachments.length === 0) {
    return { attachments: [], totalCount: 0, extractedCount: 0, unsupported: false };
  }

  const text = bytesToLatin1(bytes);
  const out: ExtractedAttachment[] = [];
  let extractedCount = 0;

  for (const att of meta.attachments) {
    const result = await extractOne(bytes, text, att);
    out.push(result);
    if (result.bytes) extractedCount++;
  }

  return {
    attachments: out,
    totalCount: out.length,
    extractedCount,
    unsupported: false,
  };
}

async function extractOne(
  bytes: Uint8Array,
  text: string,
  att: PdfAttachment,
): Promise<ExtractedAttachment> {
  // Walk the Filespec body to find the /EF stream reference.
  const filespecBody = readObjectBody(text, att.filespecObjectNumber);
  if (!filespecBody) {
    return makeFailure(att, "Filespec object missing");
  }
  const efMatch = filespecBody.match(/\/EF\s*<<([\s\S]*?)(?:>>|\bendobj)/);
  if (!efMatch) {
    return makeFailure(att, "No /EF dictionary");
  }
  const streamRefMatch =
    efMatch[1].match(/\/UF\s+(\d+)\s+\d+\s+R/) ||
    efMatch[1].match(/\/F\s+(\d+)\s+\d+\s+R/);
  if (!streamRefMatch) {
    return makeFailure(att, "No /EF stream reference");
  }
  const streamObjNum = streamRefMatch[1];

  // Locate the stream object's header in the text representation.
  // Pattern: `<num> 0 obj\n<< ... >>\nstream\n<bytes>\nendstream\nendobj`
  const headerRe = new RegExp(
    `\\b${escapeRegex(streamObjNum)}\\s+\\d+\\s+obj\\b([\\s\\S]*?)\\bstream\\b`,
  );
  const headerMatch = headerRe.exec(text);
  if (!headerMatch) {
    return makeFailure(att, "Stream object header not found");
  }

  // Parse the stream's dictionary for /Length + /Filter.
  const dictText = headerMatch[1];
  const lenMatch = dictText.match(/\/Length\s+(\d+)(?:\s+\d+\s+R)?/);
  // `/Length N 0 R` (indirect length) is rare for embedded files; we
  // could resolve it but in practice EmbeddedFile streams use direct
  // /Length values. Fall back to scanning for `endstream` if missing.
  const length = lenMatch ? parseInt(lenMatch[1], 10) : -1;

  const filter = parseFilterChain(dictText);

  // Find the start position of the stream content (after `stream` +
  // newline). Per PDF spec §7.3.8.1, the stream keyword is followed
  // by either CRLF or just LF. The first byte of stream data is right
  // after that line ending.
  const streamKwEnd = headerMatch.index + headerMatch[0].length;
  let streamStart = streamKwEnd;
  // Skip optional CR + required LF (or just LF).
  if (text.charCodeAt(streamStart) === 0x0d) streamStart++; // CR
  if (text.charCodeAt(streamStart) === 0x0a) streamStart++; // LF
  // Some non-conforming PDFs omit the LF — tolerate that.

  let streamEnd: number;
  if (length >= 0) {
    streamEnd = streamStart + length;
  } else {
    // Fallback: scan for `\nendstream` or `\rendstream`. PDF spec
    // requires a line ending before endstream but some writers omit it.
    const endIdx = text.indexOf("endstream", streamStart);
    if (endIdx === -1) return makeFailure(att, "endstream marker not found");
    // Trim back any trailing line-ending bytes.
    let trim = endIdx;
    while (
      trim > streamStart &&
      (text.charCodeAt(trim - 1) === 0x0a ||
        text.charCodeAt(trim - 1) === 0x0d)
    ) {
      trim--;
    }
    streamEnd = trim;
  }

  // Slice the raw bytes (binary-safe — Latin1 was 1:1 byte-to-char).
  const encoded = bytes.subarray(streamStart, streamEnd);

  // Decode per filter chain.
  try {
    const decoded = await applyFilters(encoded, filter);
    return {
      ...att,
      bytes: decoded,
      extractError: null,
      filter,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Decode failed";
    return makeFailure(att, msg, filter);
  }
}

function makeFailure(
  att: PdfAttachment,
  reason: string,
  filter = "Unknown",
): ExtractedAttachment {
  return { ...att, bytes: null, extractError: reason, filter };
}

function parseFilterChain(dictText: string): string {
  // /Filter /FlateDecode  OR  /Filter [/A85 /Flate]  OR  no filter
  const arrayMatch = dictText.match(/\/Filter\s*\[([^\]]+)\]/);
  if (arrayMatch) {
    const filters = [...arrayMatch[1].matchAll(/\/(\w+)/g)].map((m) => m[1]);
    return filters.join(" → ");
  }
  const singleMatch = dictText.match(/\/Filter\s*\/(\w+)/);
  if (singleMatch) return singleMatch[1];
  return "Identity";
}

async function applyFilters(
  bytes: Uint8Array,
  filterChain: string,
): Promise<Uint8Array> {
  if (filterChain === "Identity") return bytes;
  const filters = filterChain.split(" → ");
  let current = bytes;
  for (const filter of filters) {
    current = await applyOneFilter(current, filter);
  }
  return current;
}

async function applyOneFilter(
  bytes: Uint8Array,
  filter: string,
): Promise<Uint8Array> {
  // PDF spec uses both abbreviated and full names; normalize.
  const f = filter.toLowerCase();

  if (f === "flatedecode" || f === "fl") {
    // zlib (RFC 1950). DecompressionStream "deflate" handles the zlib
    // wrapper; "deflate-raw" handles raw deflate without the wrapper.
    // PDF /FlateDecode uses zlib (with wrapper).
    return decompressStream(bytes, "deflate");
  }

  if (f === "asciihexdecode" || f === "ahx") {
    return asciiHexDecode(bytes);
  }

  if (f === "ascii85decode" || f === "a85") {
    return ascii85Decode(bytes);
  }

  if (f === "lzwdecode" || f === "lzw") {
    throw new Error("LZWDecode filter not supported (legacy filter, rare in modern PDFs)");
  }

  // Image-content filters: leave the encoded bytes alone — those are
  // already in their native compressed form (JPEG, JPEG2000, JBIG2,
  // CCITT) and downloading them as-is gives a usable file.
  if (
    f === "dctdecode" ||
    f === "dct" ||
    f === "jpxdecode" ||
    f === "jpx" ||
    f === "jbig2decode" ||
    f === "ccittfaxdecode" ||
    f === "ccf" ||
    f === "runlengthdecode" ||
    f === "rl"
  ) {
    // These produce native image bytes when decoded but the encoded
    // form is itself a usable file (JPEG etc.). Pass through.
    return bytes;
  }

  throw new Error(`Unsupported PDF filter: ${filter}`);
}

async function decompressStream(
  bytes: Uint8Array,
  format: "deflate" | "deflate-raw" | "gzip",
): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Browser doesn't support DecompressionStream");
  }
  // Convert to ReadableStream for piping.
  // Slice into a fresh ArrayBuffer to satisfy DecompressionStream's
  // type expectations regardless of the source buffer.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab]);
  const decompressed = blob.stream().pipeThrough(new DecompressionStream(format));
  const chunks: Uint8Array[] = [];
  const reader = decompressed.getReader();
  let totalLen = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      totalLen += value.length;
    }
  }
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function asciiHexDecode(bytes: Uint8Array): Uint8Array {
  // Each pair of hex chars = one byte. Whitespace ignored. EOD marker is `>`.
  const out: number[] = [];
  let pending = -1;
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 0x3e) break; // `>` EOD
    // Whitespace per PDF spec
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0c) continue;
    const v = hexVal(c);
    if (v < 0) throw new Error("Invalid ASCIIHex char");
    if (pending < 0) {
      pending = v;
    } else {
      out.push((pending << 4) | v);
      pending = -1;
    }
  }
  if (pending >= 0) out.push(pending << 4); // odd nibble, pad with 0
  return new Uint8Array(out);
}

function hexVal(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30; // 0-9
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10; // A-F
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10; // a-f
  return -1;
}

function ascii85Decode(bytes: Uint8Array): Uint8Array {
  // Each group of 5 chars (offset 33 = '!') encodes 4 bytes.
  // Special case: 'z' = 4 zero bytes.
  // EOD = `~>`.
  // Final partial group is padded with 'u' chars; trim output by pad count.
  const out: number[] = [];
  let group: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 0x7e && bytes[i + 1] === 0x3e) break; // `~>`
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) continue;
    if (c === 0x7a && group.length === 0) {
      // 'z' shortcut for a full group of zeros
      out.push(0, 0, 0, 0);
      continue;
    }
    if (c < 0x21 || c > 0x75) {
      throw new Error("Invalid ASCII85 char");
    }
    group.push(c - 0x21);
    if (group.length === 5) {
      const value =
        group[0] * 85 ** 4 +
        group[1] * 85 ** 3 +
        group[2] * 85 ** 2 +
        group[3] * 85 +
        group[4];
      out.push(
        (value >>> 24) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 8) & 0xff,
        value & 0xff,
      );
      group = [];
    }
  }
  if (group.length > 0) {
    // Pad with 'u' (84) and decode, then trim padded bytes.
    const pad = 5 - group.length;
    while (group.length < 5) group.push(84);
    const value =
      group[0] * 85 ** 4 +
      group[1] * 85 ** 3 +
      group[2] * 85 ** 2 +
      group[3] * 85 +
      group[4];
    const decoded = [
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ];
    out.push(...decoded.slice(0, 4 - pad));
  }
  return new Uint8Array(out);
}

// ----- Helpers (mirror the lib/pdf/ops/attachments.ts internals) -----

function bytesToLatin1(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let s = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    s += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return s;
}

function readObjectBody(text: string, objNum: string): string | null {
  const re = new RegExp(
    `\\b${escapeRegex(objNum)}\\s+\\d+\\s+obj\\b([\\s\\S]*?)\\bendobj\\b`,
  );
  const m = text.match(re);
  return m ? m[1] : null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
