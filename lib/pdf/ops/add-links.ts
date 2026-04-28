// lib/pdf/ops/add-links.ts
//
// Tier 6 (2026-04-28): add hyperlink annotations to a PDF page. Each
// link is a rectangle + URL — clicking the rect in any viewer opens
// the URL.
//
// pdf-lib doesn&rsquo;t have a high-level addLinkAnnotation API, so we
// construct the /Link annotation dict manually via context.obj() and
// append it to the page&rsquo;s /Annots array. PDF spec ref: ISO 32000
// §12.5.6.5 (Link annotations) + §12.6.4.7 (URI actions).
//
// 2026-04-28 (#178) bugfixes after a user reported the output PDF
// not carrying the link:
//   1. ALWAYS call node.set(/Annots, annotsArr) — even when reusing
//      an existing array. Pages whose /Annots is reached via an
//      indirect-ref chain or page-tree inheritance can serialize
//      with the OLD reference if we only mutate via push().
//   2. Set /F 4 (Print bit, ISO 32000 §12.5.3) — without it,
//      Chrome's PDF viewer and several browser-embedded viewers
//      suppress the link entirely. Acrobat is forgiving but a lot
//      of users land on the Chrome rail.
//   3. Build the /A action dict with PDFString URI from the start
//      (instead of context.obj + post-patch) so the on-disk shape
//      is unambiguous.
//
// 2026-04-28 (#179) — user reported "link is not displaying" in
// the output PDF. Root cause: /Link annotations are CLICKABLE BUT
// INVISIBLE by default. The link was there and clickable in
// Chrome, but with no visible cue (no underline, no color change,
// no text on the page), users assume nothing happened. Every PDF
// tool that does this (iLovePDF, Smallpdf, Adobe Acrobat's "Add
// Web Link") stamps visible URL text into the page content stream
// so the link is both visible AND clickable. Adopting the same
// pattern: we now drawText the URL inside the rect as blue
// underlined Helvetica, sized to fit, plus the existing /Link
// annotation on top for the click handler.

import {
  PDFDocument,
  PDFArray,
  PDFName,
  PDFString,
  StandardFonts,
  rgb,
  type PDFDict,
  type PDFFont,
} from "pdf-lib";

export interface LinkAnnotation {
  /** X position in PDF user-space points (origin bottom-left). */
  x: number;
  /** Y position in PDF user-space points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
  /** Target URL. http(s):// recommended; mailto: also works. */
  url: string;
}

export interface AddLinksOptions {
  links: LinkAnnotation[];
  /** 0-based page index. Default 0. */
  pageIndex?: number;
}

export interface AddLinksResult {
  bytes: Uint8Array;
  pageCount: number;
  linkCount: number;
}

export async function addLinksPdf(
  bytes: Uint8Array,
  opts: AddLinksOptions,
): Promise<AddLinksResult> {
  if (opts.links.length === 0) {
    throw new Error("Draw at least one link rectangle first.");
  }
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: false,
    updateMetadata: false,
  });
  const pages = doc.getPages();
  if (pages.length === 0) throw new Error("This PDF has no pages.");
  const idx = opts.pageIndex ?? 0;
  if (idx < 0 || idx >= pages.length) {
    throw new Error(`Page ${idx + 1} is outside 1-${pages.length}.`);
  }
  const page = pages[idx];
  const node = page.node;

  // Embed Helvetica once per call — used for the visible URL text
  // stamped inside each link rectangle. StandardFonts.Helvetica is
  // built into pdf-lib (no font-fetching, no CSP impact).
  const helv: PDFFont = await doc.embedFont(StandardFonts.Helvetica);
  // Standard hyperlink blue, slightly muted from pure web blue so it
  // reads against light-cream form backgrounds without being garish.
  const linkBlue = rgb(0.10, 0.40, 0.85);

  // Resolve / create the page&rsquo;s /Annots array. Most pages don&rsquo;t have
  // one; we add it if missing.
  const annotsName = PDFName.of("Annots");
  let annotsArr: PDFArray;
  const existing = node.lookup(annotsName);
  if (existing instanceof PDFArray) {
    annotsArr = existing;
  } else {
    annotsArr = doc.context.obj([]) as PDFArray;
  }

  let added = 0;
  for (const link of opts.links) {
    if (link.width <= 0 || link.height <= 0) continue;
    if (!link.url.trim()) continue;

    // ============================================================
    // (1) Stamp visible URL text into the page content stream so
    //     users SEE the link in the output PDF (not just hover-
    //     discoverable like a bare /Link annotation).
    // ============================================================
    const trimmedUrl = link.url.trim();
    // Font size sized to fit the rect height, capped at 12pt for
    // readability. height * 0.65 leaves room for ascenders/descenders
    // plus a 1.5pt underline gap below.
    const fontSize = Math.min(12, Math.max(6, link.height * 0.65));
    // Truncate the URL to fit the rect width with ellipsis if needed.
    // 4pt padding each side leaves the text breathing room from the
    // clickable rect edge so it doesn't visually clip.
    const maxTextWidth = Math.max(0, link.width - 8);
    let displayUrl = trimmedUrl;
    if (helv.widthOfTextAtSize(displayUrl, fontSize) > maxTextWidth) {
      // Iteratively truncate from the right until URL+ellipsis fits.
      while (
        displayUrl.length > 1 &&
        helv.widthOfTextAtSize(displayUrl + "…", fontSize) > maxTextWidth
      ) {
        displayUrl = displayUrl.slice(0, -1);
      }
      displayUrl = displayUrl + "…";
    }
    const textWidth = helv.widthOfTextAtSize(displayUrl, fontSize);
    // Position the text vertically centered in the rect; baseline
    // sits at link.y + descender offset. Helvetica descender is
    // approximately 20% of font size — adjust the baseline up by
    // that amount so the visible glyph block is centered.
    const descenderAdjust = fontSize * 0.2;
    const textX = link.x + 4;
    const textY = link.y + (link.height - fontSize) / 2 + descenderAdjust;
    page.drawText(displayUrl, {
      x: textX,
      y: textY,
      size: fontSize,
      font: helv,
      color: linkBlue,
    });
    // Underline. Web/print convention; without it links can read as
    // regular blue text and lose their affordance. Position 1pt below
    // the baseline (just under the text descenders).
    page.drawLine({
      start: { x: textX, y: textY - 1 },
      end: { x: textX + textWidth, y: textY - 1 },
      thickness: Math.max(0.4, fontSize * 0.06),
      color: linkBlue,
    });

    // ============================================================
    // (2) Add the /Link annotation so the rect is CLICKABLE and
    //     opens the URL in any conforming PDF viewer.
    // ============================================================

    // Build the /A URI action dict explicitly. Building via
    // context.obj({...}) converts string values to PDFNames, but
    // /URI must be a literal string (PDFString). Constructing the
    // dict and setting each key separately avoids the pitfall.
    const action = doc.context.obj({
      Type: "Action",
      S: "URI",
    }) as PDFDict;
    action.set(PDFName.of("URI"), PDFString.of(link.url.trim()));

    // Build the /Link annotation dict.
    //   /Type /Annot
    //   /Subtype /Link
    //   /Rect [x1 y1 x2 y2]   (lower-left + upper-right corners)
    //   /Border [0 0 0]       (no visible border)
    //   /F 4                   (Print flag — required by Chrome PDF
    //                           viewer and many browser-embedded
    //                           renderers per ISO 32000 §12.5.3)
    //   /A <<...>>             (URI action, set below)
    const annot = doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [
        link.x,
        link.y,
        link.x + link.width,
        link.y + link.height,
      ],
      Border: [0, 0, 0],
      F: 4,
    }) as PDFDict;
    annot.set(PDFName.of("A"), action);

    // Register the annotation as an indirect object — Acrobat is more
    // permissive with inline annotations but other viewers (Apple
    // Preview, some browser renderers) require indirect refs.
    const ref = doc.context.register(annot);
    annotsArr.push(ref);
    added++;
  }

  // ALWAYS write the array reference back to the page node, even when
  // we reused an existing /Annots array. Pages whose /Annots is
  // reached via indirect-ref chain or inherited from the page tree
  // can serialize with the old reference if we only mutate via
  // push() — node.set() ensures the page dict points at the array we
  // just appended to. No-op if it's already pointing at this array.
  node.set(annotsName, annotsArr);

  if (added === 0) {
    throw new Error("All links had zero size or empty URL.");
  }

  const out = await doc.save({ useObjectStreams: true });
  return { bytes: out, pageCount: pages.length, linkCount: added };
}
