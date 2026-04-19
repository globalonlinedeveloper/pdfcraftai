// Minimal markdown → HTML renderer.
//
// Scope: only what our AI summarizer emits.
//   - H2 / H3 headings (# and ## stripped; we don't use H1 in output)
//   - Paragraphs (blank-line separated)
//   - Unordered lists: "- " or "* "
//   - Blockquotes: "> "
//   - Inline: **bold**, *italic*, `code`, [text](url)
//
// Why not a library: scope is narrow, dependency surface matters, and the
// summaries are produced server-side by our own prompts — we don't need to
// render arbitrary user-authored markdown with GFM extensions.
//
// Security rules:
//   - Escape every source char before interpreting inline markers. The
//     order is: HTML-escape → apply inline → assemble blocks. This
//     prevents <script>, <img onerror=>, etc. in AI output or PDF-extracted
//     text from becoming live HTML.
//   - Link hrefs are URL-scheme-filtered (http/https/mailto only) so
//     `javascript:` links from a weird PDF don't survive.

const BLOCK_BLANK = /^\s*$/;

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";

    // Blank line — separator, just advance.
    if (BLOCK_BLANK.test(line)) {
      i++;
      continue;
    }

    // Heading
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      // Cap at h2..h6 in output; the LLM uses ## as the top level, so h1
      // never appears in summaries anyway.
      const level = Math.max(2, Math.min(6, heading[1]!.length + 1));
      out.push(`<h${level}>${renderInline(heading[2]!)}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote (one or more consecutive "> " lines joined)
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? "")) {
        buf.push((lines[i] ?? "").replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote><p>${renderInline(buf.join(" "))}</p></blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^[-*]\s+/, ""));
        i++;
      }
      out.push(
        `<ul>${items
          .map((item) => `<li>${renderInline(item)}</li>`)
          .join("")}</ul>`
      );
      continue;
    }

    // Paragraph — gather until blank line or block start
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (BLOCK_BLANK.test(l)) break;
      if (/^(#{1,6})\s+/.test(l)) break;
      if (/^[-*]\s+/.test(l)) break;
      if (/^>\s?/.test(l)) break;
      para.push(l);
      i++;
    }
    out.push(`<p>${renderInline(para.join(" "))}</p>`);
  }

  return out.join("\n");
}

// --- inline -----------------------------------------------------------

function renderInline(src: string): string {
  // 1. HTML-escape everything up front.
  let s = escapeHtml(src);

  // 2. Inline code — `code` — protected first so emphasis inside doesn't
  //    eat it. Use a placeholder + restore pass.
  const codeSlots: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_, body: string) => {
    codeSlots.push(body);
    return `\u0000CODE${codeSlots.length - 1}\u0000`;
  });

  // 3. Links: [text](url). URL is the pre-escaped (amp-encoded) form;
  //    we still scheme-check after decoding the escape.
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, href: string) => {
    const safeHref = safeUrl(decodeHtml(href));
    if (!safeHref) return text; // drop the link, keep the text
    return `<a href="${escapeAttr(safeHref)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // 4. Bold (**) before italic (*) — order matters so **x** isn't eaten
  //    as two * * runs.
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");

  // 5. Restore inline code slots.
  s = s.replace(/\u0000CODE(\d+)\u0000/g, (_, idx: string) => {
    const body = codeSlots[parseInt(idx, 10)] ?? "";
    return `<code>${body}</code>`;
  });

  return s;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  // Same as HTML but specifically for attribute context. Already escaped
  // once upstream; double-escaping & is safe (&amp;amp; never happens
  // because we only do it when ampersands are literal — and they
  // shouldn't be by this point).
  return s.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Accept only http / https / mailto URLs. Reject javascript:, data:,
 * vbscript:, etc. Returns the original URL if safe, null otherwise.
 */
function safeUrl(href: string): string | null {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^mailto:/i.test(trimmed)) return trimmed;
  // Relative URLs (no scheme, no // prefix) are safe too — they'd resolve
  // within our own site. But we don't expect those in AI-generated content.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return null; // any other scheme
  return trimmed.startsWith("/") ? trimmed : null;
}
