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

import {
  PDFDocument,
  PDFArray,
  PDFName,
  PDFString,
  type PDFDict,
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
