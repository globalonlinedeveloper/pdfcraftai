# Tool Improvement Plan — pdfcraftai

_Audit + improvement roadmap for all 111 tools (53 AI + 58 free). Drafted 2026-05-04 after end-to-end smoke + Chrome MCP walkthrough._

## 1. Current state — by the numbers

### Inventory
- **111 total tools** (53 AI + 58 free)
- **6 groups:** AI (53), Organize (23), Edit (20), Convert (11), Security (3), Optimize (1)
- **74 component files** for 110 unique tools = strong code reuse via shared base components
- **All 30 sampled live URLs return 200** ✅
- **Aggregator:** 4466 tests across 78 suites

### Code reuse (shared base components)
| Base | Tools served | Pattern |
|---|---|---|
| `PageEditorTool` | 13 | Visual editors with click-to-place + ghost preview |
| `PageGridTool` | 9 | Thumbnail grid with multi-select (extract/delete/sort/rotate) |
| `PdfSimpleOpsTool` | 11 | Single-shot pdf-lib operations (rotate, unlock, etc) |
| `PdfReadOpsTool` | 13 | Read-only inspectors with slot-fill (parser + headline + body) |
| `ToolRunner` | All 110 | Per-tool dispatcher with code-split chunks |

### Coverage gaps (from M-series sweeps)
| Feature | Wired | Total | Coverage |
|---|---|---|---|
| First-page preview (M18) | 22 | 110 | **20%** ⚠️ |
| Handoff suggestions (M9) | 17 | 110 | **15%** ⚠️ |
| AI fetch-with-retry | 18 | 53 AI tools | **34%** ⚠️ |
| Estimator badge (Gap #3) | 9 | 9 AI tools | **100%** ✅ |
| Out-of-credits alert (Day 6.5) | 9 | 9 AI tools | **100%** ✅ |

### Largest tool components (refactor candidates)
1. `SummarizeVariantTool.tsx` — 1,090 lines (used by ~30 AI variant tools — high reuse but complex)
2. `SignPdfTool.tsx` — 952 lines
3. `PdfSplitTool.tsx` — 926 lines
4. `PageGridTool.tsx` — 874 lines
5. `PdfAddLinksTool.tsx` — 862 lines

Each >900-line file is a complexity hotspot worth a focused refactor session.

---

## 2. Findings from end-to-end test (this session)

### Critical bugs found + fixed
- **CSP missing Turnstile origin** — caused all credentials registrations to fail post-activation. Fixed live via `.htaccess` SSH edit + snapshot committed to repo. (commit `383793a` + `35abd8c` + SSH edit)

### Real product gaps discovered
- **`/compress-pdf` advertises a non-existent tool** — SEO landing has full marketing copy ("20-75% smaller, three levels") but the tool was never built (pdf-lib limitation, intentional per Day 1 catalog comment). Currently redirects users to a generic `/tools` listing. **Visitors arriving from Google get a confusing bait-and-switch.**

### Architecture observations
- 22/110 tools have first-page preview = 80% of tools don't show users what they uploaded before processing
- 17/110 tools have handoff suggestions = users frequently can't continue work in another tool without re-uploading
- 35 AI variant tools likely don't have explicit retry logic (they go through SummarizeVariantTool)
- 33,365 total lines of tool code — significant maintenance surface

---

## 3. Improvement plan

### Tier 1 — Quick wins (1-3 days each, high impact, low risk)

#### T1-1 — Remove or fix `/compress-pdf` bait-and-switch (~2h)
**Problem:** SEO landing exists with detailed compression marketing, no actual tool.
**Options:**
- **A (recommended):** Delete the SEO landing entirely. Update sitemap. Add 410 Gone redirect at `/compress-pdf` instead of 308 to `/tools`.
- **B:** Replace with a "We're building this — get notified" page that captures email for launch.
- **C:** Build the actual tool. pdf-lib doesn't support compression but we could:
  - Server-side: use `qpdf --linearize` or `gs -sDEVICE=pdfwrite -dPDFSETTINGS=/screen` (~3 days work).
  - Client-side: image-recompression-only (downsample embedded images via PDFium + sharp, ~5 days).

**Impact:** Stops bleeding visitor trust. ~3-5K monthly visits to `/compress-pdf` per typical SEO patterns.

#### T1-2 — First-page preview rollout to remaining 88 tools (~1 day)
**Problem:** 80% of tools accept files without showing what was uploaded.
**Fix:** Audit the 88 tools missing `<UploadedFilePreview>` and add it. The hook already exists (`useFirstPagePreview` + M25 cache). Most additions are 3-5 lines per file.
**Impact:** Catches "wrong file" errors before processing — reduces "I uploaded the wrong PDF" support tickets and (for AI tools) wasted credit spends.

#### T1-3 — Handoff suggestions on the 93 tools missing them (~1 day)
**Problem:** A user splits a PDF, then wants to merge specific pages — they have to re-upload to `/tool/merge`.
**Fix:** Curate the `TOOL_SUGGESTIONS` map (`lib/client/tool-suggestions.ts`) for the remaining 93 tools. Each tool needs 3-5 logical successors.
**Examples:** split → merge, rotate → page-numbers, extract-pages → merge, OCR → translate/summarize, redact → sign.
**Impact:** Increases tools-per-session (proxy for engagement + monetization for AI handoffs).

#### T1-4 — Mobile UI hardening on visual editors (~1 day)
**Problem:** `PageEditorTool` consumers (13 tools) likely have poor mobile UX — touch targets, pinch-zoom, scroll behavior.
**Fix:** Add Playwright mobile spec covering all 13 visual editors. Fix any issues found. Already have one mobile viewport in playwright.config.
**Impact:** ~40% of traffic is mobile per typical PDF tool site patterns.

#### T1-5 — Pricing page: add annual discount + enterprise CTA (~3h)
**Problem:** Pricing page only shows monthly Plus ($9/200 credits). No annual discount, no enterprise tier.
**Fix:** Add annual Plus ($90/yr = 17% off) + "Need more? Contact us" CTA for enterprise.
**Impact:** Annual conversion + gives a path for the larger SMB customers we currently turn away.

#### T1-6 — OutOfCreditsAlert: convert to Plus CTA, not just "Buy credits" (~2h)
**Problem:** When user hits cap, alert says "Buy credits" — but Plus subscribers get 200/mo + rollover to 400. Better hook for sustained users.
**Fix:** A/B test "Buy credits" vs "Start Plus → 200 credits/mo" CTA. Default winner.
**Impact:** Higher LTV per converting user.

### Tier 2 — Medium effort (1-2 weeks each, medium impact)

#### T2-1 — Build PDF Compress (real tool) — ~5 days
Server-side route using `qpdf --linearize` + `gs` for advanced compression:
- Three levels: Light (lossless linearize, 5-15% reduction), Balanced (downsample images to 150 DPI, 30-50% reduction), Strong (downsample to 96 DPI, 60-75% reduction).
- Run as a credit-priced AI op (~5 credits per doc) since it needs server compute.
- Credits-only display per the existing principles.
- Closes T1-1 option C and the existing SEO landing demand.

#### T2-2 — Fix /tool/compress-pdf 404 + standardize tool ID conventions (~2 days)
**Problem:** Tools have inconsistent naming — `compress-pdf` (SEO) vs (no tool ID), `merge` (tool ID) vs `/merge-pdf` (SEO redirect to `/tool/merge`). Mental model is confusing.
**Fix:** Pick one convention (e.g., always `<verb>-pdf` for tool IDs) and enforce via CI guard. Migrate existing IDs. Add explicit redirect coverage.
**Impact:** Less SEO churn, less "where's the tool I bookmarked" confusion.

#### T2-3 — AI tool retry coverage — ~3 days
**Problem:** Only 18/53 AI tools use `fetchAiWithRetry` explicitly. The rest go through `SummarizeVariantTool` which may or may not have retry.
**Fix:** Audit all 53 AI tools, ensure 408/502/503/504 + TypeError-network all retry once with backoff. Add CI guard.
**Impact:** Reduced "Translation failed — please retry" user-side friction during transient provider hiccups.

#### T2-4 — Refactor the 5 largest tool files (~1 week)
**Targets:** SummarizeVariantTool (1090), SignPdfTool (952), PdfSplitTool (926), PageGridTool (874), PdfAddLinksTool (862).
**Approach:** Extract sub-components, move pure functions to lib helpers, reduce per-file LOC to <500.
**Impact:** Faster code review, easier onboarding, fewer regression bugs (large files have higher bug density in this codebase per cascade history).

#### T2-5 — Per-op cap: friendlier "free trial" copy when capExceeded (~1 day)
The `capExceeded: true` flag from Gap #2 currently ignored by route handlers. Wire through to all 9 AI route bodies + tool components for the friendlier "Free trial cap reached on this tool — top up to keep using it" copy. (Deferred from earlier session.)

#### T2-6 — Tool comparison page (~3 days)
**Problem:** Visitors don't always know which tool they need. "Compress PDF" → no tool. "Reduce PDF size" → ?.
**Fix:** Build `/compare` interactive page that asks "What do you want to do?" → routes to the right tool. Also useful for AI vs free split (e.g., "Summarize PDF (AI, 3 credits) vs Extract Text (free, in-browser)").
**Impact:** Reduces bounce rate from confused visitors. SEO-friendly — covers long-tail keyword queries.

#### T2-7 — Mobile-first refactor on 13 visual editors (~1 week)
Beyond just hardening (T1-4), genuinely mobile-first redesign:
- Pinch-to-zoom canvas
- Touch-optimized rect handles (bigger than mouse)
- Bottom-sheet config panel on small screens (instead of right rail)
- Test with Mobile Safari + Chrome Android via Playwright

### Tier 3 — Strategic (1+ month each, high impact, new capabilities)

#### T3-1 — Bulk processing pipeline (~2-3 weeks)
**Gap:** Today users process one PDF at a time. Real workflows = "process 50 invoices."
**Build:**
- New `pdf-batch` v2 that accepts ZIP of PDFs OR multi-select + one shared config.
- Background job processing with progress UI.
- Per-file results table + bulk download as ZIP.
- Apply to free tools (merge a folder, rotate a folder) AND AI tools (summarize a folder, OCR a folder).
**Pricing:** Per-file credits (no bulk discount initially) + capacity caps.
**Impact:** Unlocks the "I have 100 documents" segment we currently turn away. Strong word-of-mouth for SMB users.

#### T3-2 — API + developer tier (~1 month)
**Gap:** Today the entire surface is web-only. AI tools especially are valuable as APIs for other apps.
**Build:**
- `POST /api/v1/<op>` for every AI op + the 8 most useful free tools.
- API key per user (managed at `/app/api-keys` — already in nav).
- Per-key rate limits + usage attribution.
- Pricing: `/buy api-credits` package, separate from web credits OR shared.
- Developer docs at `/docs/api` (we already mention API in nav).
**Impact:** Opens a B2B revenue channel orthogonal to web users. Defensible moat (PDF processing as a service).

#### T3-3 — Tool catalog reorg + discovery improvements (~2 weeks)
**Gap:** 110 tools across 6 groups is a lot to navigate. Current `/tools` shows them all in one flat grid.
**Build:**
- Categorized view: Convert / Edit / Organize / Extract / Sign / AI
- Search bar that searches name + description + use cases
- "Most used by people like you" personalized rail (uses last 7d ai_usage data)
- "Tool of the day" rotating spotlight (helps surface long-tail tools)
**Impact:** Higher tools-tried per session. Better SEO via category pages.

#### T3-4 — AI tool quality scoring + auto-routing (~1 month)
**Gap:** Today we route to providers via simple priority order (anthropic, openai, gemini). No quality feedback loop.
**Build:**
- Per-call quality signals: response length vs expected, JSON shape compliance, user thumbs-up/down (new affordance).
- Per-(provider, model, op) quality score, recomputed daily by ai-margin-rollup cron extension.
- Routing prefers higher-quality slices when within margin floor.
- Admin sees quality vs cost vs margin tradeoffs in `/admin/margin`.
**Impact:** Better user-perceived AI quality without changing pricing. Defensible because competitors don't track this.

#### T3-5 — Premium / Enterprise plan (~1 month)
**Gap:** Pricing tops out at Plus ($9/mo). No path for power users or teams.
**Build:**
- Premium: $29/mo, 1000 credits, no per-op cap, BYOK supported, priority queue.
- Team: $49/seat/mo, shared credit pool, admin console, SSO via Google Workspace, audit log, billing consolidation.
- Enterprise: contact sales — custom data residency, MSA, DPA pre-signed, BYO-Cloudflare, SAML.
**Impact:** Captures the SMB segment we currently turn away. ARR shape becomes more defensible.

---

## 4. Suggested execution sequence

**Week 1: Trust + UX foundation (Tier 1 batch)**
- Day 1: T1-1 (compress-pdf bait removal) + T1-5 (annual pricing) + T1-6 (Plus CTA)
- Day 2-3: T1-2 (preview rollout) + T1-3 (handoff suggestions)
- Day 4: T1-4 (mobile UI hardening)
- Day 5: smoke test all changes, ship

**Week 2-3: Real compress + retry coverage (Tier 2 partial)**
- T2-1: Build PDF Compress server-side (5 days)
- T2-3: AI retry audit + CI guard (3 days)

**Week 4: Refactor + cap copy (Tier 2 partial)**
- T2-5: capExceeded copy wiring (1 day)
- T2-4 partial: refactor SummarizeVariantTool + SignPdfTool (4 days)

**Week 5-8: Strategic — pick ONE Tier 3 item** based on which acquisition channel is winning:
- If web SEO is the bottleneck → T3-3 (catalog reorg)
- If users keep asking for batch → T3-1 (bulk pipeline)
- If we're getting "any API?" requests → T3-2 (developer tier)

---

## 5. Quick wins shippable in this session (if you want)

If you want me to ship right now, the lowest-risk, highest-bang items I can do today are:

1. **T1-1 option A:** Delete the `/compress-pdf` SEO landing + change redirect to 410 Gone or remove it (~30 min, pure docs/config change, no cascade risk)
2. **T1-2 partial:** Audit which 88 tools lack first-page preview, add it to the top 10 most-trafficked (~2-3h, single commit)
3. **T1-3 partial:** Add handoff suggestions for the most logical 20 missing pairs (~1h)

All three are small enough to batch as one commit, and none touch the auth/payments stack so cascade-pattern risk is minimized.

---

## 6. What this plan deliberately does NOT cover

- **AI quality eval framework** — beyond the existing `lib/ai/eval/` scaffold. Real eval needs golden-set curation per op and human grading rubrics. Multi-week dedicated workstream.
- **i18n / multi-language UI** — the site is English-only today. Adding Hindi/Spanish/Arabic UI is a real localization workstream, not a tool improvement.
- **PDF security suite** — encrypt PDFs (we have unlock but not lock), digital signatures via certificates (we have visual sign but not legally-binding cert sign), watermarking with copyright metadata.
- **Compliance certifications** — SOC 2, ISO 27001, HIPAA. Required for enterprise sales but a 6-12 month project.
- **Mobile apps** — iOS/Android native apps. Different product surface; defer until web revenue justifies.

These are all valid product directions but are too big to fit the "tool improvement" framing. Each deserves its own plan doc.

---

## 7. Related docs

- `docs/PRICING_AND_TELEMETRY_PLAN.md` — pricing infrastructure (credits, abuse stack, telemetry)
- `docs/PLAN_GAP_ANALYSIS.md` — older 42-gap audit covering legal/security/regulatory items
- `docs/CATALOG.md` — tool catalog snapshot
- `docs/TOOL_PATTERN.md` — canonical tool implementation pattern (reference: `/tool/page-count` + `/tool/pdf-inspector`)
- `docs/REMAINING_WORK.md` — older punch list, may overlap with Tier 1 items
