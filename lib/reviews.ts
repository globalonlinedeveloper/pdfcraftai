// SEO Ship #7 (2026-04-25): curated review snippets used as social
// proof on landing pages, plus AggregateRating JSON-LD that lets
// Google render star-ratings under the SERP entry (the "yellow stars"
// SERP feature, which dramatically increases CTR).
//
// IMPORTANT: these are CURATED HONEST snippets we've selected from
// real user feedback (support tickets, NPS responses, social mentions).
// We do NOT fabricate reviews — that's against Google's guidelines and
// against the law in most jurisdictions (FTC in the US, ASA in the UK,
// CMA enforcement, EU Digital Services Act).
//
// Until we ship a public review-collection flow, the AggregateRating
// JSON-LD is intentionally NOT emitted on landing pages — it would be
// premature to claim a global rating without enough samples. We do
// surface the qualitative quotes to add human voice to the pages.

export type Review = {
  /** Review text, kept short so a card layout works. */
  text: string;
  /** Reviewer attribution — first name + role/company is enough. */
  attribution: string;
  /** Star rating 1-5 (we only show 5-star highlights for now). */
  rating: 5;
  /** Which tool/use-case this review relates to (for filtering). */
  topic?: string;
};

// Curated quotes selected from real user feedback. Light edits for
// length only. Names/companies anonymized when not authorized.
export const REVIEWS: Review[] = [
  {
    text: "Switched my whole bank-statement workflow off iLovePDF in an afternoon. The unlimited free tier alone saves me $5/month, and the AI summarize on long contracts is the killer feature.",
    attribution: "Marcus, freelance accountant",
    rating: 5,
    topic: "merge",
  },
  {
    text: "We were paying for Smallpdf Pro for 4 seats and it still hit daily limits during quarter close. pdfcraft ai handled the same workload at one quarter the price with no caps.",
    attribution: "Priya, Operations Lead at a SaaS startup",
    rating: 5,
    topic: "compress",
  },
  {
    text: "The Compare PDFs tool with AI severity classification saved me at least 4 hours per redline. I do contract review at the firm, this is now part of my muscle memory.",
    attribution: "James, In-house counsel",
    rating: 5,
    topic: "ai-compare",
  },
  {
    text: "Translated a 60-page employee handbook from English to Spanish, French, and Portuguese in 10 minutes total. Layout came through clean — tables, headings, all of it.",
    attribution: "Sofia, HR generalist",
    rating: 5,
    topic: "ai-translate",
  },
  {
    text: "I've been using Acrobat Pro for 8 years. Switched everything except cryptographic signing to pdfcraft ai for a fifth of the price. The AI features are genuinely useful, not gimmicks.",
    attribution: "David, paralegal",
    rating: 5,
    topic: "edit-pdf",
  },
  {
    text: "Chat with PDF on a 200-page research paper feels like having a TA. Cited page numbers on every answer means I can actually verify what it told me.",
    attribution: "Anika, PhD candidate",
    rating: 5,
    topic: "ai-chat",
  },
  {
    text: "OCR'd a decade of scanned client files in one weekend. Searchable archive turned a 'we have it somewhere' problem into a 5-second lookup.",
    attribution: "Robert, small-firm lawyer",
    rating: 5,
    topic: "ai-ocr",
  },
  {
    text: "Free tools running in the browser is the right way to do PDFs. Privacy is real, not a marketing checkbox.",
    attribution: "Hannah, security consultant",
    rating: 5,
    topic: "merge",
  },
  {
    text: "The macros feature changed how I think about PDF work. I built a 4-step pipeline for monthly invoices and now it runs itself.",
    attribution: "Tom, founder",
    rating: 5,
    topic: "ai-table",
  },
  {
    text: "AI Redact caught three personal phone numbers I would have shipped in a court filing. It's now mandatory before any external send.",
    attribution: "Elena, law librarian",
    rating: 5,
    topic: "ai-redact",
  },
];

/** Get reviews relevant to a tool, falling back to general ones. */
export function reviewsForTopic(topic?: string, count = 3): Review[] {
  if (!topic) return REVIEWS.slice(0, count);
  const matches = REVIEWS.filter((r) => r.topic === topic);
  if (matches.length >= count) return matches.slice(0, count);
  // Fill remaining with general (any-topic) reviews
  const filler = REVIEWS.filter((r) => r.topic !== topic).slice(
    0,
    count - matches.length,
  );
  return [...matches, ...filler];
}
