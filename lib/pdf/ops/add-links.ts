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
    node.set(annotsName, annotsArr);
  }

  let added = 0;
  for (const link of opts.links) {
    if (link.width <= 0 || link.height <= 0) continue;
    if (!link.url.trim()) continue;

    // Build the /Link annotation dict.
    //   /Type /Annot
    //   /Subtype /Link
    //   /Rect [x1 y1 x2 y2]   (lower-left + upper-right corners)
    //   /Border [0 0 0]       (no visible border)
    //   /A << /Type /Action /S /URI /URI (https://...) >>
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
      A: {
        Type: "Action",
        S: "URI",
        // context.obj treats strings as PDFName; for the actual URL
        // string we need PDFString. Build the Action dict via
        // context.obj first, then overwrite the URI key.
      },
    }) as PDFDict;
    // Now patch the /A subdict with a real URL string. context.obj
    // converted nested literals to PDFNames; the URI must be a string.
    const action = annot.lookup(PDFName.of("A")) as PDFDict;
    action.set(PDFName.of("URI"), PDFString.of(link.url.trim()));

    // Register the annotation as an indirect object — Acrobat is more
    // permissive with inline annotations but other viewers (Apple
    // Preview, some browser renderers) require indirect refs.
    const ref = doc.context.register(annot);
    annotsArr.push(ref);
    added++;
  }

  if (added === 0) {
    throw new Error("All links had zero size or empty URL.");
  }

  const out = await doc.save({ useObjectStreams: true });
  return { bytes: out, pageCount: pages.length, linkCount: added };
}
