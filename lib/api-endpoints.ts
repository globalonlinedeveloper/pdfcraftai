// API reference data. Renders /api page (docs landing).
// Kept in TS so endpoint paths/prices stay typed and survive refactors.

export type ApiEndpoint = {
  method: string;
  path: string;
  desc: string;
  price: string;
  /** Anchor id used by the per-endpoint detail card and TOC. */
  anchor: string;
  /** Short tier-grouping label used in the table heading. */
  group: "Free" | "AI";
};

export const API_ENDPOINTS: ApiEndpoint[] = [
  { method: "POST", path: "/v1/merge",        desc: "Merge 2+ PDFs into a single document",          price: "free",           anchor: "ep-merge",     group: "Free" },
  { method: "POST", path: "/v1/split",        desc: "Split into per-page files or page ranges",      price: "free",           anchor: "ep-split",     group: "Free" },
  { method: "POST", path: "/v1/convert",      desc: "PDF ↔ Office (.docx, .xlsx, .pptx) conversions", price: "free",           anchor: "ep-convert",   group: "Free" },
  { method: "POST", path: "/v1/ai/chat",      desc: "Conversational Q&A over a PDF with citations",  price: "5 credits/Q",    anchor: "ep-chat",      group: "AI" },
  { method: "POST", path: "/v1/ai/summarize", desc: "Executive or bullet summary of a document",     price: "8 credits",      anchor: "ep-summarize", group: "AI" },
  { method: "POST", path: "/v1/ai/translate", desc: "Layout-preserving translation across 60+ languages", price: "1 credit/page", anchor: "ep-translate", group: "AI" },
  { method: "POST", path: "/v1/ai/ocr",       desc: "OCR + structured field/table extraction",       price: "2 credits/page", anchor: "ep-ocr",       group: "AI" },
  { method: "POST", path: "/v1/ai/redact",    desc: "Auto-detect and redact PII (names, emails, IDs)", price: "2 credits/page", anchor: "ep-redact",    group: "AI" },
];

export const API_QUICKSTART = `# Install
npm install @pdfcraftai/sdk

# Summarize a PDF
import { PdfCraft } from '@pdfcraftai/sdk';
const client = new PdfCraft({ apiKey: process.env.PDFCRAFT_API_KEY });

const summary = await client.summarize({
  file: fs.createReadStream('./q3-report.pdf'),
  style: 'executive',
});

console.log(summary.text);
// => "Revenue grew 23% YoY driven by..."
console.log(summary.citations);
// => [{ page: 8, quote: "..." }, { page: 14, quote: "..." }]`;

// ──────────────────────────────────────────────────────────────────────────────
// Authentication
// ──────────────────────────────────────────────────────────────────────────────

export const API_AUTH_SNIPPET = `# Every request must include a bearer token in the Authorization header.
# Keys are issued from the dashboard (Settings → API keys) and prefixed
# 'pk_live_' for production traffic and 'pk_test_' for the sandbox.

curl https://api.pdfcraftai.com/v1/merge \\
  -H "Authorization: Bearer pk_live_xxxxxxxxxxxxxxxxxxxx" \\
  -H "Content-Type: multipart/form-data" \\
  -F "files[]=@cover.pdf" \\
  -F "files[]=@body.pdf"`;

// ──────────────────────────────────────────────────────────────────────────────
// Rate limits
// ──────────────────────────────────────────────────────────────────────────────

export type ApiRateLimitTier = {
  name: string;
  monthlyOps: string;
  burst: string;
  notes: string;
};

export const API_RATE_LIMITS: ApiRateLimitTier[] = [
  {
    name: "Sandbox (pk_test_…)",
    monthlyOps: "Unlimited",
    burst: "10 req / sec",
    notes: "Test keys never spend credits. AI endpoints return deterministic stub payloads so you can build against the schema without burn.",
  },
  {
    name: "Free",
    monthlyOps: "10,000 non-AI ops / 200 AI credits",
    burst: "20 req / sec",
    notes: "Hard cap; further requests return HTTP 429. Resets on the 1st of each month UTC.",
  },
  {
    name: "Pro ($29/mo)",
    monthlyOps: "Unlimited non-AI / 5,000 AI credits",
    burst: "50 req / sec",
    notes: "Burst is sustained; concurrent long-running jobs (translate ≥ 10 pages, OCR ≥ 5 pages) cap at 5 in flight.",
  },
  {
    name: "Scale (custom)",
    monthlyOps: "Negotiated",
    burst: "200+ req / sec",
    notes: "Region-pinned processing, signed-URL ingest, dedicated workers, 99.9% SLA. Talk to support@pdfcraftai.com.",
  },
];

// Every response includes these headers.
export const API_RATE_LIMIT_HEADERS: { name: string; meaning: string }[] = [
  { name: "X-RateLimit-Limit",     meaning: "Burst window cap (requests / second) for the current key." },
  { name: "X-RateLimit-Remaining", meaning: "Requests still available in the current burst window." },
  { name: "X-RateLimit-Reset",     meaning: "Unix seconds when the burst window resets." },
  { name: "X-Credits-Remaining",   meaning: "AI credits left in the current billing month." },
];

// ──────────────────────────────────────────────────────────────────────────────
// Error codes
// ──────────────────────────────────────────────────────────────────────────────

export type ApiErrorCode = {
  status: number;
  code: string;
  meaning: string;
  fix: string;
};

export const API_ERROR_CODES: ApiErrorCode[] = [
  { status: 400, code: "invalid_request",      meaning: "Body, query, or form data failed schema validation.", fix: "Check the response.error.details array — it lists every field path and the validation rule it failed." },
  { status: 401, code: "missing_credentials",  meaning: "No Authorization header was sent.",                    fix: "Add `Authorization: Bearer <key>`. The SDK does this automatically when you set apiKey." },
  { status: 401, code: "invalid_key",          meaning: "Key is malformed, revoked, or from a different project.", fix: "Rotate the key from Settings → API keys. Test keys (pk_test_) cannot be used against live endpoints." },
  { status: 402, code: "insufficient_credits", meaning: "AI credit balance is exhausted.",                      fix: "Top up from the billing page or upgrade your plan. Non-AI endpoints continue to work." },
  { status: 413, code: "file_too_large",       meaning: "Input file exceeds the 100 MB per-request cap.",       fix: "Split the file client-side, or contact support to enable signed-URL ingest." },
  { status: 415, code: "unsupported_media",    meaning: "MIME type is not in the supported list for this endpoint.", fix: "Convert to PDF first, or check the endpoint's 'Accepts' list below." },
  { status: 422, code: "processing_failed",    meaning: "The file was readable but the operation could not complete (e.g. encrypted PDF, scanned image with no text).", fix: "Inspect response.error.hint — it explains exactly what went wrong on this file." },
  { status: 429, code: "rate_limited",         meaning: "Burst window exceeded.",                               fix: "Honour the Retry-After header, or upgrade plan for higher burst capacity." },
  { status: 500, code: "internal_error",       meaning: "Something broke on our side. The request id is in the response body.", fix: "Retry once with the same Idempotency-Key, then contact support@pdfcraftai.com with the request id if it persists." },
  { status: 503, code: "maintenance",          meaning: "Brief planned maintenance — usually < 60 seconds.",    fix: "Status page (status.pdfcraftai.com) reflects every maintenance window. Retry with backoff." },
];

// ──────────────────────────────────────────────────────────────────────────────
// Per-endpoint detail (example request + response)
// ──────────────────────────────────────────────────────────────────────────────

export type ApiEndpointDetail = {
  anchor: string;
  request: string;
  response: string;
  /** One-line note about idempotency, async behaviour, etc. */
  note?: string;
};

export const API_ENDPOINT_DETAILS: ApiEndpointDetail[] = [
  {
    anchor: "ep-merge",
    request: `POST /v1/merge
Content-Type: multipart/form-data

files[]: cover.pdf
files[]: body.pdf
files[]: appendix.pdf`,
    response: `200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename="merged.pdf"

(binary PDF stream — 4 pages, 412 KB)`,
    note: "Synchronous. Files are processed in the order they appear. Pass an Idempotency-Key header to make safe retries.",
  },
  {
    anchor: "ep-split",
    request: `POST /v1/split
Content-Type: multipart/form-data

file: report.pdf
mode: "ranges"            # or "pages"
ranges: "1-3,5,8-12"`,
    response: `200 OK
Content-Type: application/zip

(zip with split-1.pdf, split-2.pdf, split-3.pdf)`,
    note: "Synchronous for ≤ 100 pages, async (returns 202 + job id) above that.",
  },
  {
    anchor: "ep-convert",
    request: `POST /v1/convert
Content-Type: multipart/form-data

file: contract.docx
target: "pdf"             # one of: pdf, docx, xlsx, pptx`,
    response: `200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename="contract.pdf"

(binary PDF)`,
    note: "Office → PDF runs synchronous (≤ 30 s). PDF → Office is async — response is 202 with a poll URL.",
  },
  {
    anchor: "ep-chat",
    request: `POST /v1/ai/chat
Content-Type: application/json
Authorization: Bearer pk_live_xxx

{
  "file_id": "fl_8a3...",       // upload first via /v1/files
  "question": "What was Q3 revenue and what drove the growth?",
  "cite": true
}`,
    response: `200 OK
{
  "answer": "Q3 revenue was $312M (+23% YoY). Growth was driven by enterprise expansion (+41%) and a 28% lift in net retention.",
  "citations": [
    { "page": 8,  "quote": "Q3 revenue of $312M…" },
    { "page": 14, "quote": "Net retention rate of 128%…" }
  ],
  "credits_charged": 5,
  "request_id": "req_01HW…"
}`,
    note: "Costs 5 credits per question regardless of document size. Citations always reference the source page index.",
  },
  {
    anchor: "ep-summarize",
    request: `POST /v1/ai/summarize
Content-Type: multipart/form-data

file: q3-report.pdf
style: "executive"        # one of: executive, bullets, action_items`,
    response: `200 OK
{
  "text": "Revenue grew 23% YoY driven by enterprise expansion…",
  "key_points": [
    "Net retention 128%",
    "Operating margin expanded 380 bps",
    "Two new GTM markets opened in EMEA"
  ],
  "credits_charged": 8,
  "request_id": "req_01HW…"
}`,
    note: "Flat 8 credits per call, capped at the first 200 pages of the document.",
  },
  {
    anchor: "ep-translate",
    request: `POST /v1/ai/translate
Content-Type: multipart/form-data

file: handbook-en.pdf
target_lang: "ja"         # ISO-639-1
preserve_layout: true`,
    response: `200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename="handbook-ja.pdf"

(binary PDF — same layout, translated text)`,
    note: "Async above 20 pages — returns 202 with poll URL. Charged at 1 credit per source page.",
  },
  {
    anchor: "ep-ocr",
    request: `POST /v1/ai/ocr
Content-Type: multipart/form-data

file: scanned-invoice.pdf
extract: ["text", "tables", "fields"]`,
    response: `200 OK
{
  "pages": [
    { "page": 1, "text": "INVOICE #4192…", "tables": [ … ], "fields": { "invoice_number": "4192", "total": "$1,240.00", "due": "2026-05-12" } }
  ],
  "credits_charged": 2,
  "request_id": "req_01HW…"
}`,
    note: "2 credits per source page. Returns structured JSON; original PDF is never modified.",
  },
  {
    anchor: "ep-redact",
    request: `POST /v1/ai/redact
Content-Type: multipart/form-data

file: contract.pdf
detect: ["names", "emails", "phones", "ssn", "credit_card"]`,
    response: `200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename="contract-redacted.pdf"

(binary PDF with detected PII boxed and overlaid)`,
    note: "Redactions are burnt-in — the underlying text layer is removed, not just hidden. 2 credits per source page.",
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Webhooks
// ──────────────────────────────────────────────────────────────────────────────

export const API_WEBHOOK_SNIPPET = `// Webhook receiver (Node / Express). HMAC-SHA256 over the raw body
// using your endpoint's signing secret. We send 'pdfcraft-signature: t=…,v1=…'.

import crypto from 'crypto';

app.post('/webhooks/pdfcraft', express.raw({ type: '*/*' }), (req, res) => {
  const sig = req.header('pdfcraft-signature') || '';
  const [tPart, v1Part] = sig.split(',');
  const ts = tPart.split('=')[1];
  const sent = v1Part.split('=')[1];

  const expected = crypto
    .createHmac('sha256', process.env.PDFCRAFT_WEBHOOK_SECRET)
    .update(\`\${ts}.\${req.body.toString('utf8')}\`)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected))) {
    return res.status(400).send('bad signature');
  }

  const event = JSON.parse(req.body.toString('utf8'));
  // event.type: 'job.completed' | 'job.failed' | 'credits.low' | …
  // event.data: { job_id, output_url, credits_remaining, … }
  res.sendStatus(200);
});`;

export const API_WEBHOOK_EVENTS: { name: string; meaning: string }[] = [
  { name: "job.completed", meaning: "Async job (translate, large split, PDF→Office) finished successfully." },
  { name: "job.failed",    meaning: "Async job hit a terminal error. Body includes error.code and error.hint." },
  { name: "credits.low",   meaning: "AI credit balance dropped below 100. Fires once per dip until topped up." },
  { name: "key.rotated",   meaning: "An API key in your project was rotated from the dashboard." },
];

// ──────────────────────────────────────────────────────────────────────────────
// Idempotency
// ──────────────────────────────────────────────────────────────────────────────

export const API_IDEMPOTENCY_SNIPPET = `# Pass any UUID-shaped string in the Idempotency-Key header.
# We cache the response for 24 h — retries return the same payload
# without re-running the operation or charging again.

curl https://api.pdfcraftai.com/v1/ai/summarize \\
  -H "Authorization: Bearer pk_live_xxx" \\
  -H "Idempotency-Key: 1f3b1c8a-9c0e-4d6a-bf5b-c9b8a2d7e1f2" \\
  -F "file=@q3-report.pdf" \\
  -F "style=executive"`;
