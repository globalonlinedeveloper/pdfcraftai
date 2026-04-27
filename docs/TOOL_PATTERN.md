# Tool Pattern — canonical structure for new tools

This is the contract every new tool on pdfcraft.ai should follow.
The PDF Inspector saga (P0–P9, commits `0039bbe`…`41e4bff`) hardened
this pattern; treat that toolset (`/tool/page-count` and
`/tool/pdf-inspector`) as the reference implementations.

If you can answer "yes" to every checkbox below, the tool is ready
to ship.

---

## 1. Tool registry — `lib/tools.ts`

- [ ] Tool entry added with `id`, `name`, `desc`, `icon`, `free`,
      `cost`, `group`.
- [ ] **`name` matches the URL slug** (lowercase-hyphenated of the
      visible name). Example: id `page-count` → name `Page Count`,
      not `Page Counter`. iLovePDF / Smallpdf maintain this strict
      alignment; we do too.
- [ ] `desc` is a single sentence ≤ 130 chars, no marketing fluff.

## 2. Routing — `app/tool/[id]/page.tsx`

- [ ] Tool id added to `LIVE_TOOL_IDS` set.
- [ ] Dispatch case added in the `switch (id)` that maps id to the
      runner component.
- [ ] If the tool uses PDFium WASM, id added to
      `PDFIUM_BACKED_TOOLS` set so the WASM preload `<link>` fires.
- [ ] If the tool ships its own bespoke longform component
      (`<XLongform />`), conditional render added below the AdSlot
      and above `<RelatedTools>`.
- [ ] If the tool has bespoke FAQ that should win over the SEO
      landing's FAQ, add an entry to `PER_TOOL_FAQ`.

## 3. Runner component — `components/tools/<Tool>Tool.tsx`

Every runner MUST:

- [ ] Be a `"use client"` component.
- [ ] Capture the GA4 tracker: `const tracker = useTrackToolView(id, group)`.
      **Don't discard the return value** — the four-event funnel
      requires it.
- [ ] Fire `tracker.upload(file)` when a file is accepted (intent
      capture, even if the user abandons before running).
- [ ] Fire `tracker.success({ creditCost, pageCount, processingMs })`
      on completion. Use `performance.now()` for `processingMs`.
- [ ] Fire `tracker.error({ errorCode })` on failure. Classify the
      error coarsely (`"engine_load"` vs `"parse_failed"` etc) so
      analytics aggregates cleanly.
- [ ] Enforce a sensible file-size cap (100 MB convention for PDF
      tools) and return a friendly error before any heavy parse.
- [ ] Render the result card with `role="status"`, `aria-live="polite"`,
      and a descriptive `aria-label` so screen-reader users hear the
      outcome.
- [ ] Render the busy/loading card with `role="status"`,
      `aria-live="polite"`, `aria-busy="true"`.
- [ ] After a successful result, the primary action button changes
      from a quiet ghost "Reset" to a primary "Do another X" CTA —
      encourages repeat use rather than feeling terminal.
- [ ] All copy-to-clipboard buttons are wrapped in a try/catch (HTTPS
      + user-gesture requirements vary by browser).
- [ ] Errors are surfaced via `<p role="alert" />`.

Optional but encouraged:

- [ ] **JSON export** for tools where the output is structured data
      (Inspector ships this; Page Count doesn't because the output
      is one number). Schema includes `generated_by`, `generated_at`,
      `schema_version` for downstream stability.
- [ ] **Cross-promo** to a richer or simpler sibling tool when the
      user's intent might overshoot or undershoot the current tool.
      Inspector ↔ Page Count is the canonical example.

## 4. Tool intro — `lib/tool-intros.ts`

- [ ] `TOOL_INTROS[<id>]` entry with `text` (1–2 sentences, "What
      you'll get") and optional `related` cross-tool link.
- [ ] **Don't end the text with "try"** or expect Markdown
      continuation — the framework auto-appends
      ` For another use, try [related.label].` after the text.

## 5. SEO landing — `lib/seo-pages.ts` + `app/<slug>/page.tsx`

- [ ] Slug added to `SeoPageSlug` union in `lib/seo-pages.ts`.
- [ ] `SEO_PAGES[<slug>]` entry with `tool`, `h1`, `sub`, `canonical`,
      `howTo`, `faq`, `related`.
- [ ] Route file at `app/<slug>/page.tsx` — 14-line wrapper that
      pulls from SEO_PAGES and passes to `<SeoLandingPage data={...} />`.
      Sitemap auto-includes via `SEO_SLUGS` derive from
      `Object.keys(SEO_PAGES)`.

If the tool wants two landings (one for each search intent — e.g.
`/pdf-page-count` and `/pdf-inspector` both run /tool/page-count or
/tool/pdf-inspector respectively), the two SEO entries should have
**substantively different** H1, sub, howTo phrasing, and FAQ — Google
will classify near-duplicates as canonical-collision.

## 6. JSON-LD schemas (auto-emitted)

`app/tool/[id]/page.tsx` already emits four JSON-LD blocks for every
runner page. You don't have to do anything — but you should know:

- `SoftwareApplication` — applicationCategory + offers + aggregateRating
- `BreadcrumbList` — Home › Tools › Tool Name (derives from URL)
- `HowTo` — generic 4-step "drop, click, download" template
- `FAQPage` — from `PER_TOOL_FAQ[id]` if present, else from the SEO
  landing's `faq[]`, else omitted

For the FAQPage to appear, either ship a SEO landing with a `faq[]`
that maps to your tool's id, or add an entry to `PER_TOOL_FAQ`.

## 7. Bespoke longform (optional)

For high-value tools, ship a `components/marketing/<Tool>Longform.tsx`
component with editorial copy. Patterns the Inspector longform
demonstrates:

- "Why people use X" — 6 use-case cards
- "How X works" — 3-step explainer
- "What makes pdfcraft ai different" — 5 differentiators
- "Health checklist" — domain-specific QA framework (optional)
- FAQ — visible `<details>/<summary>` that doubles as the
  `FAQPage` JSON-LD source via a re-exported array
  (`PDF_INSPECTOR_FAQ` is the reference)

Render conditionally in `app/tool/[id]/page.tsx` between the AdSlot
and the Related Tools row.

## 8. Op layer — `lib/pdf/ops/<op>.ts`

If the tool's behavior is non-trivial:

- [ ] Implement the engine call in `lib/pdf/ops/<op>.ts` so it can be
      reused by sibling tools (Page Count + Inspector both call
      `inspectPdf()` in `inspect.ts`).
- [ ] The op file must NOT import from `components/` or `app/`.
- [ ] If parsing PDF bytes directly (vs through the PDFium wrapper),
      put the byte parser in its own module under `lib/pdf/ops/` and
      wrap the top level in try/catch — never throw upward.

## 9. Pre-ship checklist

- [ ] `./node_modules/.bin/tsc --noEmit` is clean.
- [ ] Sitemap includes the new tool runner URL (auto from
      `lib/tools.ts` via `app/sitemap.ts`).
- [ ] Sitemap includes the SEO landing URL (auto from
      `lib/seo-pages.ts`).
- [ ] Manual smoke: drop a PDF, see results, copy / export, reset,
      run again. No console errors.
- [ ] Mobile viewport sanity (375×667). Result card stacks, buttons
      don't overlap.
- [ ] Hard-refresh after deploy to confirm Hostinger CDN cleared.

## 10. Reference commits

The Inspector saga is the canonical worked example. If you're unsure
how a piece of the pattern lands, read these commits in order:

- `0039bbe` — P1: longform + JSON-LD + WASM preload
- `1ca0ccd` — P3: tool split (URL/title alignment + sibling tools)
- `0b3eac0` — P4: result-card polish (a11y, scan warning, "another" CTA)
- `7e63916` — P5: byte-stream metadata extractor
- `27aec73` — P6: GA4 funnel + aria-live
- `d4158eb` — P7: JSON export
- `eb9cefe` — P8: per-page detection
- `41e4bff` — P9: educational longform section

---

**This document is the source of truth.** When the Inspector pattern
evolves, update this file in the same commit so the next tool ships
with the new defaults baked in.
