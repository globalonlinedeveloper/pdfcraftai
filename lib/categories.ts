// SEO Ship #8 (2026-04-25): tool category landings.
// One page per ToolGroup, listing every tool in that category with
// per-category editorial intro. Targets queries like "PDF organize
// tools", "PDF conversion tools" — broader than tool-specific landings.

export type CategorySlug =
  | "organize"
  | "convert"
  | "edit"
  | "optimize"
  | "security"
  | "ai";

export type CategoryData = {
  slug: CategorySlug;
  /** Matches the ToolGroup string in lib/tools.ts. */
  group: string;
  h1: string;
  sub: string;
  /** ~150 word intro shown above the tool grid. */
  intro: string;
  /** ~250 word "when to reach for this category" body. */
  body: string;
  /** Quick-pick top tools in this category. */
  topTools: string[];
};

export const CATEGORIES: Record<CategorySlug, CategoryData> = {
  organize: {
    slug: "organize",
    group: "Organize",
    h1: "PDF organize tools — merge, split, rotate, reorder",
    sub: "The basics for restructuring PDFs: combining files, separating pages, fixing orientations.",
    intro:
      "Organize tools are the most-used category in any PDF suite. Most jobs start here: someone hands you 12 separate files and you need one; one big file needs to be 12 small ones; pages came in sideways and need to be rotated. These are the tools that make a PDF behave like a document instead of a stack of paper.",
    body:
      "If you're new to pdfcraft ai, start with the organize tools. They run entirely in your browser — your file never uploads — so privacy is built in for the basics. They're free without daily caps. They handle 100 MB files. And they preserve everything: bookmarks reconcile correctly across merges, page orientations stay independent, password-protected inputs are unlocked when you provide the password. The output works in every PDF reader from Acrobat 7 onward, opens cleanly in browsers and the Preview app, and prints byte-identically on every printer. The shape of these tools has been stable since the PDF format was published in 1993 — what changes is the speed and the privacy story. Both are good here.",
    topTools: ["merge", "split", "rotate", "extract-pages", "delete-pages", "sort-pages"],
  },
  convert: {
    slug: "convert",
    group: "Convert",
    h1: "PDF convert tools — to and from Word, Excel, JPG, PNG, HTML",
    sub: "Move documents in and out of PDF without losing layout, fonts, or table structure.",
    intro:
      "Conversion is the second-most-used category. PDFs come from somewhere (Word, Excel, web pages, scanners) and go somewhere (back to Word for editing, to Excel for analysis, to images for embedding). The right conversion tool depends on what you're trying to preserve — layout fidelity, editability, or table structure.",
    body:
      "Picking the right conversion tool matters more than people realize. PDF-to-Word is the right call when you'll edit the result; PDF-to-Excel is the right call for tables; PDF-to-JPG is right when you want a static image of a specific page. Conversion direction matters too: Word-to-PDF locks the layout for sending; PDF-to-HTML lets you embed a page in a website. We separate these into distinct tools rather than one giant 'convert' button so each pipeline can be tuned for its specific output. AI Table Extract is paired with PDF-to-Excel because tables embedded in narrative-heavy PDFs need different handling than clean tabular files. Most conversions are free; OCR-required jobs (scans-to-anything) use 2 credits per page after a 20-page free allowance.",
    topTools: ["pdf-to-office", "to-pdf", "pdf-to-jpg", "ai-table", "ai-ocr", "pdf-to-text"],
  },
  edit: {
    slug: "edit",
    group: "Edit",
    h1: "PDF edit tools — text, images, annotations, page numbers",
    sub: "Edit a PDF in place: add text, swap images, highlight, sign, number pages, redact.",
    intro:
      "Editing PDFs has a reputation for being hard, and most of that reputation comes from desktop tools that cost $20+/month. The web tools in this category cover 80% of real editing jobs — fix a typo, swap a logo, add a missing paragraph, sign a contract — without an install or a subscription.",
    body:
      "What you actually need to edit a PDF depends on the job. For typo-fixing in existing text, use Edit PDF — it preserves the original font when embedded. For adding new content, Add Text Box gives you a new layer to work on. For annotations during review, Highlight PDF and Free Draw match what you'd do with a pen on paper. Page-level changes (rotate, reorder, delete) live in the Organize category. For high-stakes editing where you need cryptographic signing or full PDF/UA accessibility, Adobe Acrobat is still the better fit — we don't pretend to compete on those specific use cases. Free Edit PDF works for any PDF up to 100 MB. The same in-browser, no-upload privacy story applies as for the organize tools.",
    topTools: ["edit-pdf", "add-text-box", "highlight-pdf", "page-numbers", "sign-pdf-free", "redact-free"],
  },
  optimize: {
    slug: "optimize",
    group: "Optimize",
    h1: "PDF optimize tools — compress, repair, flatten, resize",
    sub: "Make PDFs smaller, faster, and more reliable without losing quality.",
    intro:
      "Optimization is the unsexy category that saves more time than the others. A compressed PDF emails through. A repaired PDF opens. A flattened PDF stops surprising recipients with editable form fields. Each tool here solves a specific problem that wastes someone's day when ignored.",
    body:
      "Compress is the most-used optimize tool — and the most often misused. The right level depends on the destination: Light for print, Balanced for email, Strong for upload caps. Use the target-size mode ('get under 5 MB') instead of guessing levels. Repair fixes corrupted PDFs that won't open — common after partial uploads, interrupted exports, or generation by buggy software. Flatten removes form fields and annotations from a working file so the recipient can't accidentally edit it. Resize changes page size (Letter ↔ A4) without scaling content. Each runs in your browser for free; targets, levels, and per-tool options sit in each tool's expanded panel so the defaults work for typical jobs.",
    topTools: ["compress", "repair-pdf", "flatten-pdf", "resize-pdf", "remove-metadata"],
  },
  security: {
    slug: "security",
    group: "Security",
    h1: "PDF security tools — protect, unlock, redact",
    sub: "Add or remove passwords, redact PII, strip metadata before sharing.",
    intro:
      "Security tools are about what's in (and what's out of) a PDF that goes to someone else. The wrong content ships when 'redacted' rectangles can be copy-pasted through. The wrong password lock makes a file unusable for the recipient. The wrong metadata reveals things you didn't intend.",
    body:
      "Real redaction permanently removes content from the file's bytes — search-find-it-impossible. Most online tools that say 'redact' actually just draw a black rectangle on top of text that's still there. Use AI Redact for auto-detection of PII (names, emails, phone numbers, SSNs, addresses) plus manual passes for context-specific redactions. Combine with metadata strip so author names don't leak. Protect adds password-based access control; Unlock removes it (you provide the password — we don't crack PDFs). For high-stakes legal redaction, run search-and-redact on every PII term and verify by copy-paste before sharing.",
    topTools: ["protect", "ai-redact", "redact-free", "remove-metadata", "flatten-pdf"],
  },
  ai: {
    slug: "ai",
    group: "AI",
    h1: "AI PDF tools — chat, summarize, translate, redact, compare",
    sub: "Use language models on your PDFs: question-answering, summarization, translation, redaction, and more.",
    intro:
      "AI tools are the newest category in the PDF world, and where pdfcraft ai differs most from the established competitors. iLovePDF, Smallpdf, PDF24, and Sejda each have a few AI features; we have 50+. The point isn't quantity for its own sake — it's that PDFs are where most language work lives, and a real AI suite means you don't have to copy text out, run it through ChatGPT, and copy results back.",
    body:
      "The two highest-leverage AI tools are Chat with PDF (questions about the document with page citations) and Summarize PDF (11 formats from executive bullets to study notes). After that, Translate (90+ languages, layout preserved), AI OCR (with structure detection), AI Redact (auto-detect PII), and AI Compare (with severity classification) cover most of what someone needs day-to-day. Everything else — rewriting tone, generating PDFs from prompts, extracting tables that aren't on a clean grid, mind-mapping concepts, generating flashcards — sits in this category as specialized tools. AI ops have a generous free tier (try anything 5 times free) and pay-as-you-go pricing thereafter. The Pro plan is $4/month if you use AI features regularly.",
    topTools: ["ai-chat", "ai-summarize", "ai-translate", "ai-ocr", "ai-redact", "ai-compare", "ai-table", "ai-sign"],
  },
};

export const CATEGORY_SLUGS = Object.keys(CATEGORIES) as CategorySlug[];
