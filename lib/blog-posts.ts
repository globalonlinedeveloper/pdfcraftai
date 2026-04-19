// Blog post data. Ported from prototype content.jsx BLOG_POSTS.
// Body content: only ai-redact-v2 has real prose (matching the prototype's hardcoded body).
// Other 5 posts show a "Coming soon" placeholder per Phase 1 decision.

export type BlogPost = {
  slug: string;
  title: string;
  excerpt: string;
  cat: string;
  date: string; // display string, e.g. "Apr 14, 2026"
  iso: string; // ISO date for <time> and OG metadata
  read: string; // e.g. "6 min"
  author: {
    name: string;
    role: string;
    initial: string;
  };
  body?: BlogBlock[]; // if undefined, post shows "Coming soon" placeholder
};

export type BlogBlock =
  | { type: "p"; text: string }
  | { type: "h3"; text: string }
  | { type: "quote"; text: string };

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "ai-redact-v2",
    title: "AI Redact v2: 10× faster, now with custom patterns",
    excerpt:
      "Our detection model just got a rewrite. Here's what's new, how we trained it, and why batch jobs now run in seconds.",
    cat: "Product",
    date: "Apr 14, 2026",
    iso: "2026-04-14",
    read: "6 min",
    author: { name: "Priya Sharma", role: "Head of AI · pdfcraft ai", initial: "P" },
    body: [
      {
        type: "p",
        text: "When we started pdfcraft ai, our goal was simple: make PDFs less awful. Three years in, the product has grown past what we expected, and the team has grown with it.",
      },
      { type: "h3", text: "What changed" },
      {
        type: "p",
        text: "The original redaction pipeline was a single pass over each page, detecting entities and masking them in one go. It worked, but performance fell apart on scanned documents above 50 pages.",
      },
      {
        type: "quote",
        text: "We rewrote the core detection path from scratch this quarter. The result: 10× faster throughput and a new suite of custom-pattern rules.",
      },
      { type: "h3", text: "The new pipeline" },
      {
        type: "p",
        text: "The new architecture splits the work into three stages — OCR, classification, and masking — each horizontally scalable. We also added custom-pattern support so teams can register their own regexes for internal IDs, case numbers, or other domain-specific tokens.",
      },
      {
        type: "p",
        text: "We're just getting started. If you have a workflow you'd like us to support, drop us a line — we read everything.",
      },
    ],
  },
  {
    slug: "byok-guide",
    title: "A practical guide to Bring Your Own Key",
    excerpt:
      "When BYOK makes sense, when it doesn't, and how to wire up Anthropic + OpenAI in under two minutes.",
    cat: "Guide",
    date: "Apr 8, 2026",
    iso: "2026-04-08",
    read: "9 min",
    author: { name: "pdfcraft team", role: "pdfcraft ai", initial: "P" },
  },
  {
    slug: "pdf-security-2026",
    title: "PDF security in 2026: what every team should know",
    excerpt:
      "Encryption, redaction, metadata leaks, and the quiet problem of OCR residue.",
    cat: "Security",
    date: "Mar 29, 2026",
    iso: "2026-03-29",
    read: "12 min",
    author: { name: "pdfcraft team", role: "pdfcraft ai", initial: "P" },
  },
  {
    slug: "legal-ai-workflows",
    title: "Five AI workflows legal teams actually ship",
    excerpt:
      "From clause extraction to conflict checks — the playbook we hear most often from AmLaw 200 firms.",
    cat: "Workflows",
    date: "Mar 21, 2026",
    iso: "2026-03-21",
    read: "8 min",
    author: { name: "pdfcraft team", role: "pdfcraft ai", initial: "P" },
  },
  {
    slug: "launching-api",
    title: "Announcing the pdfcraft ai API",
    excerpt:
      "REST, webhooks, SDKs, and a free tier for hobby projects. Build with PDFs like you build with Stripe.",
    cat: "Product",
    date: "Mar 12, 2026",
    iso: "2026-03-12",
    read: "5 min",
    author: { name: "pdfcraft team", role: "pdfcraft ai", initial: "P" },
  },
  {
    slug: "summarize-technique",
    title: "Why our summarizer cites page numbers (and yours should too)",
    excerpt:
      "Hallucinations are a trust problem. Here's the technique we use to make every claim traceable.",
    cat: "Engineering",
    date: "Feb 28, 2026",
    iso: "2026-02-28",
    read: "11 min",
    author: { name: "pdfcraft team", role: "pdfcraft ai", initial: "P" },
  },
];

export const postBySlug = (slug: string) => BLOG_POSTS.find((p) => p.slug === slug);
