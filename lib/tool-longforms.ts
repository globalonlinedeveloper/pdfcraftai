// lib/tool-longforms.ts
//
// Build 2 Wave 5 (2026-04-27): per-tool editorial data consumed by
// the shared <ToolRunnerLongform /> component. Closes the
// structural-parity gap — every PDFium-backed tool now has the
// same editorial depth as PDF Inspector and Page Count.
//
// Page Count and PDF Inspector keep their custom longform
// components (PageCountLongform, PdfInspectorLongform) because
// they have unique sections (PDF health checklist, etc.) that
// don't fit the shared shape. Everything else lives here.
//
// Adding a tool: add a new entry keyed by the tool id matching
// lib/tools.ts. The runner page in app/tool/[id]/page.tsx
// auto-renders the longform when an entry exists.

import type { ToolLongformData } from "@/components/marketing/ToolRunnerLongform";

export const TOOL_LONGFORMS: Record<string, ToolLongformData> = {
  // -------- Wave 1: text-export trio --------------------------------
  "pdf-to-text": {
    useCasesTitle: "Why people convert PDFs to text",
    useCasesIntro:
      "A PDF is a layout container. Plain text is a content container. Once it's text, every downstream tool — search, translation, summarization, version-control — works.",
    useCases: [
      {
        icon: "Translate",
        title: "Translation prep",
        text: "Translation services charge by the word. A clean .txt export lets you get an accurate quote and feed the result into any CAT tool without layout interference.",
      },
      {
        icon: "Search",
        title: "Full-text search",
        text: "Drop the .txt into your editor or a search-indexer and find every occurrence across documents instantly. Faster than re-opening each PDF.",
      },
      {
        icon: "Summary",
        title: "AI summarization input",
        text: "Most LLM tools work best with plain text. Extract once, summarize many times — across ChatGPT, Claude, local models, or our own AI · Summarize tool.",
      },
      {
        icon: "Compare",
        title: "Version comparison",
        text: "Diffing two PDFs is painful; diffing two .txt files is one git command. Useful for legal redlines, contract reviews, and academic revisions.",
      },
      {
        icon: "Edit",
        title: "Repurpose content",
        text: "Pull text out of an existing PDF to repost on a blog, paste into a CMS, or use as a starting draft for new material.",
      },
    ],
    howWorksTitle: "How PDF to Text works",
    howWorks: [
      {
        step: "1",
        title: "Drop your PDF",
        text: "Up to 100 MB. Files stay in your browser — never uploaded.",
      },
      {
        step: "2",
        title: "Click Extract text",
        text: "Google PDFium reads every page in reading order, with page-break markers between pages.",
      },
      {
        step: "3",
        title: "Copy or download .txt",
        text: "Plain UTF-8 text. Paste anywhere or save as a .txt file for downstream pipelines.",
      },
    ],
    faqs: [
      {
        q: "What about formatting — headings, lists, tables?",
        a: "Layout is flattened to reading order. PDFium gives us the text in the order it appears on the page. Tables come out as space-separated rows, lists lose their bullet markers, headings lose their style. If layout matters, use PDF to Markdown or PDF to HTML for lightly structured output.",
      },
      {
        q: "Does it work on scanned PDFs?",
        a: "No. Scans are images, so there's no extractable text. Run Make PDF Searchable (AI · OCR) first to overlay invisible text on the scan, then come back here.",
      },
      {
        q: "What's the file size limit?",
        a: "100 MB. Larger files would risk freezing the browser tab during PDFium's parse step. For documents above 100 MB, split first.",
      },
      {
        q: "Is anything uploaded?",
        a: "No. PDFium runs as WebAssembly in your browser. Your file never touches our servers. You can verify in your browser's Network tab — there's no upload request.",
      },
      {
        q: "Why are there random line breaks in the middle of paragraphs?",
        a: "PDF stores text in lines, not paragraphs. PDFium gives back what's there. Most PDF→text tools (including pdftotext) have this artefact. For cleaner paragraph reflow, use PDF to Markdown which adds basic paragraph-merge heuristics.",
      },
    ],
    cta: {
      title: "Want lightly structured output?",
      text: "PDF to Markdown adds page headers and paragraph reflow. PDF to HTML wraps paragraphs in <p> tags. Same engine, more structure preserved.",
      linkHref: "/tool/pdf-to-markdown",
      linkLabel: "Try PDF to Markdown",
    },
  },

  "pdf-to-markdown": {
    useCasesTitle: "Why people convert PDFs to Markdown",
    useCasesIntro:
      "Markdown is the lingua franca of modern writing tools. A PDF→.md export drops cleanly into Notion, Obsidian, GitHub, MkDocs, Hugo, and a hundred other places.",
    useCases: [
      {
        icon: "Edit",
        title: "Notion / Obsidian import",
        text: "Both knowledge tools accept Markdown natively. Convert old PDFs to .md once, then your notes are searchable + linkable inside your second-brain workflow.",
      },
      {
        icon: "Convert",
        title: "GitHub / GitLab docs",
        text: "Static-site generators and repo docs run on Markdown. PDF research papers or design specs become version-controlled .md files in one drop.",
      },
      {
        icon: "Summary",
        title: "AI workflow input",
        text: "LLMs handle Markdown's gentle structure (## headers, **bold**, * lists) better than raw text. Better extractions, better summaries.",
      },
      {
        icon: "Pages",
        title: "Static-site publishing",
        text: "Hugo, Jekyll, Astro, Next.js — all Markdown-friendly. Take a PDF whitepaper, convert to .md, publish as a blog post in minutes.",
      },
      {
        icon: "Book",
        title: "Reading-list archives",
        text: "Save research papers as searchable Markdown for grep + cross-reference. Each page becomes an H2 section so you can navigate quickly.",
      },
    ],
    howWorksTitle: "How PDF to Markdown works",
    howWorks: [
      {
        step: "1",
        title: "Drop your PDF",
        text: "Up to 100 MB. Pure browser-side parse via Google PDFium.",
      },
      {
        step: "2",
        title: "Click Convert to Markdown",
        text: "Each page becomes a `## Page N` H2 section. Paragraphs are merged from PDF text lines — runs of whitespace collapse to single newlines.",
      },
      {
        step: "3",
        title: "Download .md or copy",
        text: "Plain UTF-8 Markdown. Paste into Notion / Obsidian / a Git repo, or save as a .md file.",
      },
    ],
    faqs: [
      {
        q: "Does it preserve headings, lists, and tables?",
        a: "Partially. Page boundaries become ## H2 headers; paragraphs are reflowed cleanly; bullets and tables come out as plain prose. For richer structure recovery, our AI · PDF to Blog Post or PDF to Study Notes tools do heading inference using an LLM.",
      },
      {
        q: "What's different from PDF to Text?",
        a: "Same underlying text extraction (PDFium's getText), different formatting. PDF to Text is one big string per page joined with separators. PDF to Markdown adds H2 headers per page and merges paragraphs by collapsing extra newlines.",
      },
      {
        q: "Does it work on scanned PDFs?",
        a: "No — same constraint as PDF to Text. Scans need OCR first. Run Make PDF Searchable, then convert.",
      },
      {
        q: "Will the output render correctly in my Markdown editor?",
        a: "Yes for standard CommonMark renderers (Notion, Obsidian, GitHub, MkDocs). Some editors interpret the page-break content slightly differently — preview the first page in your editor to confirm before importing 200 pages.",
      },
      {
        q: "Is anything uploaded?",
        a: "No. Pure browser-side via PDFium WebAssembly.",
      },
    ],
    cta: {
      title: "Need HTML instead?",
      text: "PDF to HTML wraps each page in <section> with <h2> + <p> tags — drop directly into a CMS or static-site generator.",
      linkHref: "/tool/pdf-to-html",
      linkLabel: "Try PDF to HTML",
    },
  },

  "pdf-to-html": {
    useCasesTitle: "Why people convert PDFs to HTML",
    useCasesIntro:
      "HTML is the web's native format. Once your PDF is .html, every web tool — CMS imports, search engines, screen readers — works natively.",
    useCases: [
      {
        icon: "Convert",
        title: "CMS / WordPress imports",
        text: "Most CMS tools accept HTML directly. Convert a PDF to .html once, paste into the WYSIWYG editor, ship as a blog post.",
      },
      {
        icon: "Search",
        title: "Web indexing",
        text: "Search engines crawl HTML, not PDF (well, they try, but HTML wins). Convert PDFs to .html for an internal docs site that actually ranks.",
      },
      {
        icon: "Shield",
        title: "Accessibility (a11y)",
        text: "Screen readers handle HTML far better than PDF. Converting old PDFs to clean HTML is the foundation of an accessibility cleanup pass.",
      },
      {
        icon: "Pages",
        title: "Static-site publishing",
        text: "Astro, Hugo, plain Apache — anything that serves HTML serves your converted PDF instantly. No conversion pipeline needed at deploy time.",
      },
      {
        icon: "Edit",
        title: "Email-friendly content",
        text: "Many email tools accept HTML drops. Take a PDF brief, convert to .html, paste into your campaign editor as a starting draft.",
      },
    ],
    howWorksTitle: "How PDF to HTML works",
    howWorks: [
      {
        step: "1",
        title: "Drop your PDF",
        text: "Up to 100 MB. PDFium parses in your browser — never uploaded.",
      },
      {
        step: "2",
        title: "Click Convert to HTML",
        text: "Each page becomes a <section> with an <h2>Page N</h2> header and one <p> per paragraph. UTF-8, properly escaped.",
      },
      {
        step: "3",
        title: "Download .html or copy",
        text: "Self-contained HTML5 doc with <!DOCTYPE>, <html>, <head>, <body>. Drop into any web editor or static host.",
      },
    ],
    faqs: [
      {
        q: "What about CSS and styles?",
        a: "Output is structural HTML only — no inline styles, no <style> block, no external CSS. The point is portability: drop into your CMS or site generator and apply your own styles. If you need styled output, use a layout-preserving converter like Acrobat's HTML export.",
      },
      {
        q: "Does it preserve images, tables, and links?",
        a: "Not yet. The current implementation surfaces text only. Embedded images are skipped (use Extract Images for those); tables come out as flat paragraphs; hyperlinks lose their href targets. Vector graphics, math equations, and form fields aren't converted.",
      },
      {
        q: "Is the HTML semantic and accessible?",
        a: "It's clean structural HTML5 with proper <section>, <h1>, <h2>, <p>. Suitable as a starting point for an accessible page. Adding alt text for images, ARIA labels, and table headers is your job — the converter doesn't infer those from a flat PDF.",
      },
      {
        q: "What's the difference from PDF to Markdown?",
        a: "HTML output is more directly publishable on the web (every browser renders it). Markdown is more portable across writing tools (Notion, Obsidian, GitHub). Same source text, different wrapper.",
      },
      {
        q: "Is anything uploaded?",
        a: "No. Pure browser-side via PDFium WebAssembly.",
      },
    ],
    cta: {
      title: "Want a more portable format?",
      text: "PDF to Markdown gives you the same content with simpler syntax — easier to paste into Notion, Obsidian, or a GitHub README.",
      linkHref: "/tool/pdf-to-markdown",
      linkLabel: "Try PDF to Markdown",
    },
  },

  // -------- Wave 2: rasterizers ------------------------------------
  "pdf-to-jpg": {
    useCasesTitle: "Why people convert PDFs to JPG",
    useCasesIntro:
      "JPG is the universal image format — every viewer, every social platform, every email client supports it. Once your PDF pages are JPGs, they go anywhere.",
    useCases: [
      {
        icon: "Image",
        title: "Email previews",
        text: "Recipients can preview a JPG inline; PDFs require downloading. Convert key pages to JPG to share in newsletter campaigns, signatures, or quick previews.",
      },
      {
        icon: "Convert",
        title: "Social media posts",
        text: "Twitter, LinkedIn, Instagram all accept JPG. Convert a research-paper figure, a chart, or a slide to JPG and post directly.",
      },
      {
        icon: "Pages",
        title: "CMS / blog images",
        text: "Most CMS tools want images, not PDFs. Convert your PDF deck to JPGs, upload as a gallery or carousel.",
      },
      {
        icon: "Sparkle",
        title: "Image-only viewers",
        text: "Older systems, kiosks, e-paper devices, and some printers handle JPG much better than PDF. Convert before sending.",
      },
      {
        icon: "Search",
        title: "Visual indexing",
        text: "Image-search tools (Google Lens, reverse-image search) work on JPGs. Convert PDF figures to JPG for visual discoverability.",
      },
    ],
    howWorksTitle: "How PDF to JPG works",
    howWorks: [
      {
        step: "1",
        title: "Drop your PDF and pick resolution",
        text: "1×, 2×, or 3× (72 / 144 / 216 DPI). 2× is the sweet spot — sharp enough for print previews, small enough to share.",
      },
      {
        step: "2",
        title: "Click Convert to JPG",
        text: "PDFium renders each page to canvas in your browser, then encodes as JPG at quality 0.9 (visually lossless to most eyes).",
      },
      {
        step: "3",
        title: "Download single or zip",
        text: "1-page PDF → one .jpg. Multi-page PDF → all images bundled into a .zip. Or click any thumbnail to download just that page.",
      },
    ],
    faqs: [
      {
        q: "What's the difference between this and Extract Images?",
        a: "Big difference. PDF to JPG renders the WHOLE PAGE as an image (everything you see — text, layout, embedded images). Extract Images pulls out the SOURCE images embedded inside the PDF (just the photos/figures, not the text around them). Different tools for different needs.",
      },
      {
        q: "Should I use 1×, 2×, or 3×?",
        a: "1× = thumbnails / web previews / small files. 2× = balanced (default) — fits most use cases. 3× = print-quality / large displays / when sharpness matters more than file size. Higher scales linearly increase memory and render time.",
      },
      {
        q: "Why JPG vs PNG?",
        a: "JPG is smaller (10–50% the size for typical pages) but lossy. PNG is lossless. Use JPG for photos and dense text where compression artefacts won't be visible. Use PNG (separate tool) for diagrams, charts, screenshots, anything with sharp edges.",
      },
      {
        q: "Does it preserve text searchability?",
        a: "No. JPG is a flat raster — there's no text data, just pixels. If you need searchable output, convert to text instead, or use both (JPG for visual + .txt for search index).",
      },
      {
        q: "Is anything uploaded?",
        a: "No. PDFium and the canvas-based image encoder both run in your browser. Your PDF stays on your device.",
      },
    ],
    cta: {
      title: "Need lossless quality?",
      text: "PDF to PNG renders pages as PNG — better for diagrams, charts, screenshots, and anything with sharp edges. Same scale picker, same gallery.",
      linkHref: "/tool/pdf-to-png",
      linkLabel: "Try PDF to PNG",
    },
  },

  "pdf-to-png": {
    useCasesTitle: "Why people convert PDFs to PNG",
    useCasesIntro:
      "PNG is lossless — what you see on the PDF page is exactly what lands in the PNG. Better than JPG for diagrams, charts, screenshots, and anything with sharp edges.",
    useCases: [
      {
        icon: "Sparkle",
        title: "Diagrams and charts",
        text: "JPG compression smudges thin lines and crisp edges. PNG preserves every pixel — essential for technical diagrams, line charts, schematics.",
      },
      {
        icon: "Pages",
        title: "Screenshots / UI mockups",
        text: "Designers and product folks share UI mockups. PNG preserves the typography and gridline crispness that JPG would soften.",
      },
      {
        icon: "Edit",
        title: "Documentation images",
        text: "Software docs, API references, runbooks. Convert PDF pages to PNG for embedding in tutorials where text legibility matters.",
      },
      {
        icon: "Image",
        title: "Logo and brand assets",
        text: "Logos saved as PDF need lossless conversion. PNG preserves transparency-edge quality (though our converter renders on opaque white).",
      },
      {
        icon: "Convert",
        title: "Web images that need transparency",
        text: "PNG supports alpha channels. JPG doesn't. If you need crisp edges over a varying background, PNG is the only option.",
      },
    ],
    howWorksTitle: "How PDF to PNG works",
    howWorks: [
      {
        step: "1",
        title: "Drop your PDF and pick resolution",
        text: "1×, 2×, or 3× (72 / 144 / 216 DPI). PNGs are larger than JPGs — be conservative on multi-page docs at 3×.",
      },
      {
        step: "2",
        title: "Click Convert to PNG",
        text: "PDFium renders each page to canvas. We read it back as PNG (lossless) — every pixel preserved.",
      },
      {
        step: "3",
        title: "Download single or zip",
        text: "1-page PDF → one .png. Multi-page → all PNGs zipped together. Or click any thumbnail to download just that page.",
      },
    ],
    faqs: [
      {
        q: "Why is PNG larger than JPG?",
        a: "PNG is lossless. JPG drops information to save space (the 'compression artefact' you sometimes see in low-quality JPGs). For typical PDF pages, PNGs are 5–10× larger. Worth it when sharpness matters; switch to JPG for photo-heavy pages where size matters more.",
      },
      {
        q: "Does the PNG preserve transparency?",
        a: "Not really — PDFium renders pages on an opaque white background by default. If you need transparent backgrounds (e.g. for compositing logos), the source PDF needs to be designed for it, and even then post-processing in an image editor is usually the cleaner path.",
      },
      {
        q: "What's the difference vs Extract Images?",
        a: "PDF to PNG renders the WHOLE PAGE (everything you see). Extract Images pulls out the SOURCE images embedded in the PDF (just the photos, no surrounding text). Use this for full-page captures; use Extract Images to grab just the figures.",
      },
      {
        q: "Should I use 1×, 2×, or 3×?",
        a: "1× = web previews. 2× = balanced (default). 3× = print quality. PNG file sizes grow roughly linearly with pixel count, so 3× = ~9× the file size of 1×.",
      },
      {
        q: "Is anything uploaded?",
        a: "No. PDFium WASM + browser canvas, all on your device.",
      },
    ],
    cta: {
      title: "Want smaller files instead?",
      text: "PDF to JPG produces files 10–50% the size of PNG, with quality usually indistinguishable for text and photos.",
      linkHref: "/tool/pdf-to-jpg",
      linkLabel: "Try PDF to JPG",
    },
  },

  // -------- Wave 3 ------------------------------------------------
  "pdf-search": {
    useCasesTitle: "Why people search inside PDFs",
    useCasesIntro:
      "PDF readers' built-in search is fine for one document. When you need fast results across pages, with surrounding context, in your browser without opening Acrobat — that's this tool.",
    useCases: [
      {
        icon: "Search",
        title: "Research literature review",
        text: "Find every mention of a term across a 200-page paper without scrolling. The context window shows where each match lives so you don't have to flip back to the source.",
      },
      {
        icon: "Shield",
        title: "Compliance and audit",
        text: "Searching contracts, policies, or regulatory filings for specific clauses. Whole-word + case-sensitive options narrow results to exact matches that matter for legal review.",
      },
      {
        icon: "Book",
        title: "Textbook / manual lookup",
        text: "Manuals are long. Knowing the term is on page 247 and reading the surrounding sentence is faster than scrolling to find it.",
      },
      {
        icon: "Edit",
        title: "Editing and copy review",
        text: "Find every typo, every brand-name misspelling, every outdated reference across a draft. Faster than manually re-reading.",
      },
      {
        icon: "Sparkle",
        title: "Citation / quote verification",
        text: "Confirm a quote you want to use is actually in the source. Whole-word matching narrows ambiguous queries to exact phrases.",
      },
    ],
    howWorksTitle: "How Search in PDF works",
    howWorks: [
      {
        step: "1",
        title: "Drop your PDF",
        text: "Up to 100 MB. PDFium extracts the text per page in your browser.",
      },
      {
        step: "2",
        title: "Type your query",
        text: "Word or phrase. Toggle case-sensitive or whole-word if you want narrower matches. Press Enter.",
      },
      {
        step: "3",
        title: "Read results in context",
        text: "Each match shows ~50 chars before and after, plus the page number. Click 'New search' to refine without re-uploading.",
      },
    ],
    faqs: [
      {
        q: "Does it work on scanned PDFs?",
        a: "Only if the scan has an OCR text layer. Image-only scans have no extractable text — run Make PDF Searchable first to OCR the document, then come back here.",
      },
      {
        q: "How many matches can I get?",
        a: "Up to 200 per query. Beyond that, the page becomes unwieldy and the user should refine. Whole-word matching usually trims results meaningfully when a query is too broad.",
      },
      {
        q: "Does it search bookmarks, comments, or metadata?",
        a: "No, just the page text. For bookmarks, use the PDF Outline Viewer. For metadata (title, author, etc.), use PDF Inspector.",
      },
      {
        q: "What's the difference vs AI · Semantic Search?",
        a: "This tool finds literal text matches. AI · Semantic Search finds passages by meaning — even if the query words don't appear verbatim in the document. Different tools for different intents. This one's free; semantic search uses credits.",
      },
      {
        q: "Is anything uploaded?",
        a: "No. PDFium runs as WebAssembly in your browser. Verify in your browser's Network panel.",
      },
    ],
    cta: {
      title: "Need search by meaning, not just literal matches?",
      text: "AI · Semantic Search finds passages even when the query words don't appear verbatim. Useful for research and exploratory questions.",
      linkHref: "/tool/ai-semantic-search",
      linkLabel: "Try AI · Semantic Search",
    },
  },

  "extract-images": {
    useCasesTitle: "Why people extract images from PDFs",
    useCasesIntro:
      "Sometimes you need just the figures, not the page they're embedded in. Extracting images at native resolution preserves source quality — which page-rendering can't.",
    useCases: [
      {
        icon: "Image",
        title: "Reusing figures",
        text: "Author wants to reuse a chart or photo from an old PDF. Extract gives you the original at native resolution; rendering the page would shrink the image to fit the page bounds.",
      },
      {
        icon: "Search",
        title: "Asset audits",
        text: "Marketing teams checking which logos / brand assets a PDF deck uses. Extract lists every embedded image — easy to spot wrong logos or rights issues.",
      },
      {
        icon: "Edit",
        title: "Re-purpose for the web",
        text: "PDF figures often work better as standalone web images than re-renders. Extract, optimize, embed in HTML.",
      },
      {
        icon: "Book",
        title: "Research material extraction",
        text: "Pull figures from research papers for presentations or annotations. The original resolution is preserved, so they print sharp.",
      },
      {
        icon: "Shield",
        title: "Compliance review",
        text: "Auditors checking what raster images a PDF contains — sometimes you need to confirm which images are present without opening the file in Acrobat.",
      },
    ],
    howWorksTitle: "How Extract Images works",
    howWorks: [
      {
        step: "1",
        title: "Drop your PDF",
        text: "Up to 100 MB. PDFium walks every page in your browser.",
      },
      {
        step: "2",
        title: "Click Extract images",
        text: "We find every embedded raster image and decode it to PNG at original resolution.",
      },
      {
        step: "3",
        title: "Download",
        text: "Single image → one .png. Multi-image → bundled as .zip. Or click any thumbnail to download just that one.",
      },
    ],
    faqs: [
      {
        q: "What's the difference vs PDF to PNG?",
        a: "PDF to PNG renders the WHOLE PAGE as an image (everything: text, layout, embedded images). Extract Images pulls out just the SOURCE images embedded inside the PDF (no surrounding text). Use Extract for figures; use PDF to PNG for full-page captures.",
      },
      {
        q: "What about vector graphics?",
        a: "Vectors aren't extracted — they're path objects, not images. Only raster images (JPG, PNG, raw bitmaps embedded in the PDF) come out. PDFs that are entirely vector return zero images.",
      },
      {
        q: "Why are some images missing?",
        a: "Rare codecs (JBIG2 under encryption, etc.) can fail to decode. We log and skip them rather than failing the whole extraction. Common formats — JPEG, PNG, raw bitmaps — work fine.",
      },
      {
        q: "What format does it output?",
        a: "PNG. We don't know the source format and re-encoding to lossy JPEG would drop fidelity. PNG keeps the original pixels intact.",
      },
      {
        q: "Is anything uploaded?",
        a: "No. PDFium and canvas-based decoding both run in your browser.",
      },
    ],
    cta: {
      title: "Need full-page renders instead?",
      text: "PDF to PNG renders the whole page as an image (text + layout + embedded images together).",
      linkHref: "/tool/pdf-to-png",
      linkLabel: "Try PDF to PNG",
    },
  },

  // -------- Wave 4 ------------------------------------------------
  "pdf-outline": {
    useCasesTitle: "Why people view PDF outlines",
    useCasesIntro:
      "An outline (bookmarks tree) is a PDF's table of contents. Seeing it before you open the document tells you whether it's worth opening — and where to start.",
    useCases: [
      {
        icon: "Book",
        title: "Long-doc previews",
        text: "Research papers, textbooks, government filings. Skim the outline first to decide which chapters to actually read. Saves opening a 400-page PDF just to find the right section.",
      },
      {
        icon: "Search",
        title: "Citation lookup",
        text: "When citing a chapter or section number, extract the outline to confirm the section exists at the page you're claiming. Especially useful for legal exhibits.",
      },
      {
        icon: "Convert",
        title: "Re-publishing prep",
        text: "Before reformatting a PDF as a website or blog series, exporting its outline gives you the editorial map — what sections to keep, what to merge, what to drop.",
      },
      {
        icon: "Shield",
        title: "Compliance + audit",
        text: "Confirming a regulatory filing's structure matches the prescribed table of contents. The outline export shows nesting depth + page refs at a glance.",
      },
      {
        icon: "Edit",
        title: "TOC documentation",
        text: "Generating a documentation page that lists all chapters of a PDF manual with page numbers — useful for ops runbooks and indexed knowledge bases.",
      },
    ],
    howWorksTitle: "How PDF Outline Viewer works",
    howWorks: [
      {
        step: "1",
        title: "Drop your PDF",
        text: "Up to 100 MB. We parse the outline tree directly from the PDF bytes — no PDFium engine needed.",
      },
      {
        step: "2",
        title: "Click View outline",
        text: "We walk the outline tree, decode each title (handling Unicode + escape sequences), and resolve destinations to 1-based page numbers.",
      },
      {
        step: "3",
        title: "Copy or export",
        text: "Copy as indented text, or export as JSON for programmatic use.",
      },
    ],
    faqs: [
      {
        q: "What if the PDF has no bookmarks?",
        a: "We tell you clearly. Many PDFs (especially scanned or auto-generated ones) have no outline tree. For those, try PDF Inspector for high-level stats or Search in PDF to find specific text.",
      },
      {
        q: "Are nested bookmarks shown?",
        a: "Yes, with proper indent depth. The export preserves the hierarchy — JSON has a depth field; copied text uses two-space indent per level.",
      },
      {
        q: "Why is no page number shown for some entries?",
        a: "PDF allows two destination styles: direct page refs and named destinations (an extra dereference). We resolve direct refs cleanly; named destinations show the title without a page number. Most modern PDFs use direct refs.",
      },
      {
        q: "Does it handle PDFs with cross-reference streams (PDF 1.5+)?",
        a: "Mostly no. Cross-reference streams hide objects in compressed object streams that our byte parser can't follow. We return 'unsupported' clearly when this happens.",
      },
      {
        q: "Is anything uploaded?",
        a: "No. Pure byte-stream parsing in your browser.",
      },
    ],
    cta: {
      title: "Want full document stats too?",
      text: "PDF Inspector adds page count, dimensions, word count, metadata, and more — same in-browser, in one drop.",
      linkHref: "/tool/pdf-inspector",
      linkLabel: "Try PDF Inspector",
    },
  },

  "pdf-forms": {
    useCasesTitle: "Why people inspect PDF forms",
    useCasesIntro:
      "Fillable PDFs collect data. Knowing which fields exist, what type, and what's filled in is a real workflow concern for HR, legal, finance, and ops.",
    useCases: [
      {
        icon: "Pen",
        title: "Form completion verification",
        text: "Before submitting a 30-field form, audit which fields are filled and which required fields are empty. Faster than tabbing through the PDF.",
      },
      {
        icon: "Convert",
        title: "Data extraction for pipelines",
        text: "Bulk-extract field values from filled-in PDFs to feed into spreadsheets, ATS systems, or databases. CSV export goes straight into your pipeline.",
      },
      {
        icon: "Shield",
        title: "Audit and compliance",
        text: "Confirming that the form fields collected match the data spec. Useful for KYC forms, tax returns, government submissions where the field set is regulated.",
      },
      {
        icon: "Edit",
        title: "Form template review",
        text: "Designers and product owners reviewing a fillable PDF template. The inspector shows every field's name, type, and flags so review happens against actual data not guesses.",
      },
      {
        icon: "Search",
        title: "Schema documentation",
        text: "Documenting an existing PDF form's schema for downstream tooling — what field names exist, what types, what flags. JSON export gives a clean machine-readable schema.",
      },
    ],
    howWorksTitle: "How PDF Form Inspector works",
    howWorks: [
      {
        step: "1",
        title: "Drop your fillable PDF",
        text: "Up to 100 MB. Our byte parser walks the AcroForm dictionary — no PDFium engine needed.",
      },
      {
        step: "2",
        title: "Click Inspect form fields",
        text: "Every field with a name and type is surfaced — text inputs, checkboxes, radios, choice lists, signatures.",
      },
      {
        step: "3",
        title: "Export",
        text: "Copy as JSON for pipelines, or download as CSV for spreadsheets. Field names use dotted-path notation (Parent.Child) for nested forms.",
      },
    ],
    faqs: [
      {
        q: "Does it fill the form for me?",
        a: "No, this tool inspects only — it tells you what fields exist and their current values. To fill in fields, use the Fill PDF Forms tool.",
      },
      {
        q: "What field types does it recognize?",
        a: "All four AcroForm types: Tx (text inputs), Btn (buttons — checkbox, radio, pushbutton), Ch (choice — list/combo box), Sig (signature). Plus a flags column showing required, read-only, multiline, password.",
      },
      {
        q: "Why are some fields blank?",
        a: "Either they haven't been filled in, or the value is in a non-string format we don't yet decode (e.g. complex dictionaries). The required + readonly flags still show correctly even if the value is empty.",
      },
      {
        q: "Does it handle nested fields?",
        a: "Yes. Parent fields are walked first; their /Kids subfields show with dotted-path names like 'Address.Street' or 'Address.City'. The hierarchy is preserved.",
      },
      {
        q: "Is anything uploaded?",
        a: "No. Byte-stream parser runs in your browser.",
      },
    ],
    cta: {
      title: "Want to fill the form, not just inspect it?",
      text: "Fill PDF Forms lets you click into each field, type your values, and download the filled PDF.",
      linkHref: "/tool/fill-forms",
      linkLabel: "Try Fill PDF Forms",
    },
  },

  "pdf-attachments": {
    useCasesTitle: "Why people list PDF attachments",
    useCasesIntro:
      "PDFs can secretly carry embedded files — datasets, source documents, working notes. For compliance audits and security review, knowing what's hidden inside matters.",
    useCases: [
      {
        icon: "Shield",
        title: "Security review",
        text: "Embedded executables, macros, or unexpected file types in a PDF can be a security concern. List the attachments to confirm what's actually there.",
      },
      {
        icon: "Search",
        title: "Compliance audit",
        text: "Regulatory filings often include supporting docs. Auditors need to confirm the exact set of attachments matches the submission spec.",
      },
      {
        icon: "Book",
        title: "Research artefacts",
        text: "Technical reports often embed datasets, scripts, or supplementary material. Listing the attachments is the first step to retrieving them.",
      },
      {
        icon: "Sparkle",
        title: "PDF/A validation",
        text: "PDF/A archive standards restrict embedded file types. Listing attachments helps validators confirm compliance before submission to repositories.",
      },
      {
        icon: "Convert",
        title: "Document deconstruction",
        text: "Designers checking what assets are bundled into a PDF deliverable — fonts, source files, working layers — that they need to manage separately.",
      },
    ],
    howWorksTitle: "How PDF Attachments Lister works",
    howWorks: [
      {
        step: "1",
        title: "Drop your PDF",
        text: "Up to 100 MB. Byte parser walks the /Names tree in your browser.",
      },
      {
        step: "2",
        title: "Click List attachments",
        text: "We surface every Filespec dict from /EmbeddedFiles — Unicode filenames preferred, MIME types decoded.",
      },
      {
        step: "3",
        title: "Copy or export",
        text: "Copy as text (filename + size + description), or export as JSON.",
      },
    ],
    faqs: [
      {
        q: "Does it download the actual file bytes?",
        a: "Not yet. We list metadata (name, MIME, size) but extracting the streams requires handling FlateDecode and other compression filters — separate work. For now, open the PDF in Acrobat or Preview to save individual attachments.",
      },
      {
        q: "Why does this matter for compliance?",
        a: "Embedded files can leak PII, source documents, or working notes. Auditors need to know what's hiding inside. PDF/A validators also care — the spec restricts embedded file types.",
      },
      {
        q: "What if no attachments exist?",
        a: "We tell you clearly. Most PDFs don't have any. Common cases that DO: technical reports with embedded datasets, regulatory filings with supporting docs, archive PDFs with source files.",
      },
      {
        q: "Does it handle nested name trees?",
        a: "Yes. PDFs with many attachments use a /Kids subtree structure. The parser walks it depth-first and flattens to a single list.",
      },
      {
        q: "Is anything uploaded?",
        a: "No. Pure byte-stream parsing in your browser.",
      },
    ],
    cta: {
      title: "Want full document overview?",
      text: "PDF Inspector adds page count, dimensions, word count, fonts, metadata, and more — same in-browser, one drop.",
      linkHref: "/tool/pdf-inspector",
      linkLabel: "Try PDF Inspector",
    },
  },

  "pdf-fonts": {
    useCasesTitle: "Why people inspect PDF fonts",
    useCasesIntro:
      "Non-embedded fonts get substituted at the printer with whatever's installed. The result is visibly wrong glyphs and inconsistent spacing. Print shops and designers need to know what's embedded BEFORE sending to print.",
    useCases: [
      {
        icon: "Edit",
        title: "Print prep",
        text: "Print shops require all fonts embedded. Confirm before sending to ensure the printer doesn't substitute glyphs and ruin the layout.",
      },
      {
        icon: "Sparkle",
        title: "PDF/A and PDF/X compliance",
        text: "Archive (PDF/A) and print (PDF/X) standards mandate font embedding. Validators check this exact thing — knowing in advance saves a re-export.",
      },
      {
        icon: "Shield",
        title: "Brand consistency",
        text: "Marketing teams confirming brand fonts are embedded in deliverables. Substituted fonts visibly break brand standards on customer-facing materials.",
      },
      {
        icon: "Book",
        title: "Academic submissions",
        text: "Many journals and theses require font embedding for archival. Verify before submitting to avoid a 'please re-export' email weeks later.",
      },
      {
        icon: "Convert",
        title: "Forensic analysis",
        text: "Fonts can be a forensic signal — what software produced the PDF, when, on what platform. The font list narrows down the source.",
      },
    ],
    howWorksTitle: "How PDF Font Inspector works",
    howWorks: [
      {
        step: "1",
        title: "Drop your PDF",
        text: "Up to 100 MB. Byte parser walks every page's font resources.",
      },
      {
        step: "2",
        title: "Click Inspect fonts",
        text: "We dedupe fonts by object number, check the FontDescriptor for /FontFile* refs (embedded), and detect subsetted fonts via the 6-letter prefix pattern.",
      },
      {
        step: "3",
        title: "Review and export",
        text: "Color-coded badges for embedded vs not. Page list per font. Copy as JSON or download as CSV.",
      },
    ],
    faqs: [
      {
        q: "Why does font embedding matter?",
        a: "Non-embedded fonts get substituted at the printer with whatever's installed. Result: visibly wrong glyphs, inconsistent spacing, sometimes complete unreadability. Print shops universally require embedded fonts. PDF/A and PDF/X compliance also require it.",
      },
      {
        q: "What does 'subsetted' mean?",
        a: "Modern PDFs often embed only the glyphs actually used — saves file size dramatically. The PDF spec marks subsetted fonts with a 6-letter random prefix (e.g. ABCDEF+TimesNewRoman). Subsetted fonts are still embedded — the prefix just signals the optimization.",
      },
      {
        q: "What if the inspector shows non-embedded fonts?",
        a: "Use a tool like Acrobat Pro to embed them, or re-export the source document with 'Embed all fonts' checked. The standard 14 PDF fonts (Helvetica, Times, Courier etc.) are technically allowed unembedded but most modern workflows embed everything for safety.",
      },
      {
        q: "Why are some fonts shown only on a subset of pages?",
        a: "PDF references fonts per page. A small font (a sidebar caption font, say) might only appear on a few pages while the body text font appears on all. The page list per font reflects exactly that.",
      },
      {
        q: "Is anything uploaded?",
        a: "No. Byte-stream parser runs in your browser.",
      },
    ],
    cta: {
      title: "Want full document overview?",
      text: "PDF Inspector adds page count, dimensions, word count, metadata, and more — same in-browser, one drop.",
      linkHref: "/tool/pdf-inspector",
      linkLabel: "Try PDF Inspector",
    },
  },
};
