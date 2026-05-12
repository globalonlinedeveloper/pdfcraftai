# On-demand production E2E suite

**2026-05-12 — Phase 1: anonymous read-only smoke.**

This suite tests the live production site at https://pdfcraftai.com.
It hits real URLs, parses real responses, validates real JSON-LD —
but it does **not** mutate anything (no file uploads, no AI calls,
no payments, no account changes). Safe to run any time.

## When to run

- **Manually before/after a significant deploy.** Especially the
  ones in CLAUDE.md §5 cascade-prone surface (auth, payments, CSP).
- **Daily via GitHub Actions scheduled workflow.** Set up at
  `.github/workflows/prod-e2e.yml`, runs every day at 06:00 UTC.
  Failures open a GitHub issue.
- **On-demand via `gh workflow run prod-e2e.yml`** when you suspect
  something broke and want a structured probe.

## How to run

### Locally

```bash
# Default — against https://pdfcraftai.com
npm run test:prod-e2e

# Against a different URL (staging, preview, Cloudflare branch)
PROD_E2E_URL=https://staging.pdfcraftai.com npm run test:prod-e2e

# Single group
npx playwright test --config=playwright.prod.config.ts -g "homepage"

# UI mode for debugging
npx playwright test --config=playwright.prod.config.ts --ui
```

### CI

```bash
# Trigger the GitHub Actions workflow
gh workflow run prod-e2e.yml

# Watch it run
gh run watch
```

## What's covered (Phase 1)

13 test groups across the anonymous-visitor surface:

| Group | Coverage | Surfaces |
|---|---|---|
| A. Homepage | hero + JSON-LD + cookie banner | `/` |
| B. Catalog | tools list + intent router | `/tools`, `/compare` |
| C. Pricing | Product JSON-LD + pack names | `/pricing` |
| D. Trust & legal | 8 pages × og:image | `/privacy`, `/terms`, `/refund-policy`, `/cancellation-policy`, `/cookies`, `/dpa`, `/gdpr`, `/security` |
| E. Alternatives | index + 5 per-competitor pages | `/alternatives/*` |
| F. Tool pages | 10 representative tools × JSON-LD | `/tool/*` |
| G. Blog | post count + Article schema + RSS | `/blog`, `/blog/rss.xml`, `/blog/<slug>` |
| H. Help center | article count + search form + cancel article | `/help`, `/help/cancel-subscription` |
| I. Use cases | index + CollectionPage schema | `/use-cases` |
| J. Marketing | TechArticle/Service/contact form | `/api`, `/bulk`, `/enterprise`, `/about` |
| K. Infrastructure | sitemap + robots + health + sample + WASM MIME | `/sitemap.xml`, `/robots.txt`, `/api/health`, `/sample.pdf`, `/api/pdfium-wasm` |
| L. Security headers | CSP + X-Frame-Options + HSTS | `/` |
| M. Auth surfaces | redirect behaviour + login form | `/app/welcome`, `/app/admin/*`, `/login` |

Total: ~50 individual assertions across the suite.

## What's NOT covered (deferred to Phase 2+)

### Phase 2 — Authenticated read-only

Needs a dedicated test account with verified email. Would cover:

- Login flow (Credentials path)
- `/app/dashboard` renders with stats
- `/app/welcome` shows curated tool grid for logged-in users
- `/app/settings` form loads
- Session expiry behaviour

**Blocker:** need a test account on production. Could create one
manually, or wire a `PROD_E2E_TEST_EMAIL` / `PROD_E2E_TEST_PASSWORD`
secret pair in GitHub Actions. Founder decision: are we OK with a
real account existing on prod purely for E2E?

### Phase 3 — Tool execution

Would actually run the tools — drop a PDF, get an output, validate
the result. Catches the highest-value regressions (the kind of
thing the PDFium WASM MIME bug surfaced) but requires:

- Sandbox AI keys (so AI tool runs don't burn real credits)
- A fixed-content sample PDF (public/sample.pdf already exists)
- Output-bytes validation (file size, MIME, page count) without
  per-tool brittleness

### Phase 4 — Payments

Razorpay sandbox keys + a test card. Verifies checkout flow,
webhook delivery, credit allocation. **Not** in scope until the
broader staging-environment decision lands (SEV-1 deferred item).

## Why this is separate from `tests/e2e/`

The dev-targeting suite at `tests/e2e/` boots a local `next dev`
server. It exercises the code in development mode — useful for
catching regressions before they ship, but blind to the
production-build behaviours that bit us with the PDFium WASM MIME
issue (CLAUDE.md §5).

This suite hits production directly. It catches:

- CSP regressions only visible in the prod CSP
- Minified-code edge cases
- Static asset MIME serving via LiteSpeed/Passenger
- Sitemap + robots + canonical alignment with live state
- JSON-LD structured-data correctness AFTER deploy

The two suites are complementary. Don't run them together —
they're separate npm scripts (`test:e2e` vs `test:prod-e2e`).

## Safety guarantees

- Every assertion is on a GET request (zero POST/PUT/DELETE)
- No file uploads (would create real orphan files)
- No credit consumption (no /api/ai/* calls)
- No account mutations (no signups, no settings changes)
- Custom User-Agent (`pdfcraftai-prod-e2e/1.0`) — Hostinger access
  logs can identify and exclude our test traffic from real-user
  analytics
- One-browser-only (Chromium) — no triple-browser test storm

## When tests fail

1. **Single test, transient (network blip):** ignore. Re-run.
2. **Single test, persistent:** check if production changed. If
   the change was intentional (e.g. we added a new pack name),
   update the assertion.
3. **Multiple tests, persistent:** prod regression. Check the
   most recent deploy via `curl https://pdfcraftai.com/api/health`
   and compare commit SHA to the failing assertions.
4. **Whole suite times out:** prod is probably down. Check the
   Hostinger panel or hPanel cascade-recovery runbook (CLAUDE.md
   §5).

## Maintenance

When a new SEO landing or tool ships, the corresponding assertion
in this suite may need updating. The rule: this suite should be a
HONEST mirror of what the production audit-fix CI guards already
pin — if you change a guard, mirror the change here.
