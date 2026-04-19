// Legal pages. Ported from prototype content.jsx LEGAL_DOCS with compliance claims
// softened per Phase 1 decision:
//   - "SOC 2 Type II certified (2025 audit by Prescient Assurance)"
//     -> "SOC 2 Type II readiness in progress"
//   - specific physical address removed
//   - dpo@, privacy@, security@ collapsed to support@pdfcraftai.com
//   - subprocessor list kept but marked as "current working draft"

export type LegalSlug = "privacy" | "terms" | "security" | "dpa";

export type LegalSection = { h: string; p: string };

export type LegalDoc = {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
  disclaimer?: string; // short note shown above first section
};

const SUPPORT_EMAIL = "support@pdfcraftai.com";

export const LEGAL_DOCS: Record<LegalSlug, LegalDoc> = {
  privacy: {
    title: "Privacy Policy",
    updated: "April 2, 2026",
    intro:
      "We designed pdfcraft ai to do the least possible with your data. This policy tells you exactly what that means.",
    disclaimer:
      "Working draft. This policy is actively being reviewed. Please contact us if you rely on it for compliance.",
    sections: [
      {
        h: "What we collect",
        p: "Account info (email, name, password hash), usage metadata (tool name, credits spent, timestamps), and billing info processed by Stripe. We do not store document contents after processing — see Retention.",
      },
      {
        h: "Retention",
        p: "Uploaded files are deleted from processing servers within 60 minutes of your session ending. Output files are available to you for 24 hours, then permanently deleted. On Studio plans, you can opt into zero-retention mode where we never persist any file.",
      },
      {
        h: "Who sees your files",
        p: "No humans — not us, not contractors. AI tools route through our isolated inference environment or through your own API key if BYOK is on. We never train models on your content.",
      },
      {
        h: "Cookies & analytics",
        p: "We use a single first-party cookie for session auth and anonymous product analytics. No third-party trackers. No ad networks.",
      },
      {
        h: "Your rights",
        p: `Export all your data or delete your account instantly from Settings. EU/UK residents: we follow the GDPR framework; email ${SUPPORT_EMAIL} to exercise your rights.`,
      },
      {
        h: "Contact",
        p: `Privacy and security questions: ${SUPPORT_EMAIL}.`,
      },
    ],
  },
  terms: {
    title: "Terms of Service",
    updated: "April 2, 2026",
    intro:
      "Plain-English terms for using pdfcraft ai. If anything is unclear, ask support — we read every message.",
    disclaimer:
      "Working draft. This agreement is actively being reviewed. Use at your own discretion and contact us with questions.",
    sections: [
      {
        h: "Your account",
        p: "You are responsible for keeping your login credentials safe. You must be 13+ to use the service. Business accounts may have additional admin responsibilities.",
      },
      {
        h: "Acceptable use",
        p: "Don't upload content you don't have rights to. Don't use pdfcraft ai to process material that is illegal, harassing, or intended to deceive (e.g. forged documents). We reserve the right to suspend accounts for abuse.",
      },
      {
        h: "Credits & billing",
        p: `Credits are consumed as you use AI tools. Paid credits never expire. Bonus credits expire per the offer terms. Refunds available within 14 days for unused credit packs — email ${SUPPORT_EMAIL}.`,
      },
      {
        h: "Service availability",
        p: "We target 99.9% uptime. We don't guarantee uninterrupted service, but we'll tell you when something's wrong at our status page.",
      },
      {
        h: "Intellectual property",
        p: "You own your documents and outputs. We own the service, models, and UI. Don't reverse-engineer or rebrand pdfcraft ai.",
      },
      {
        h: "Limitation of liability",
        p: "To the maximum extent permitted by law, our liability is limited to the amount you paid us in the 12 months preceding the incident.",
      },
    ],
  },
  security: {
    title: "Security",
    updated: "April 2, 2026",
    intro:
      "How we keep your documents and account safe — the practices we follow today and the certifications we are working toward.",
    disclaimer:
      "Aspirational document. Items listed below represent our target security posture. Formal certifications (SOC 2, HIPAA BAA) are in progress and not yet issued.",
    sections: [
      {
        h: "Encryption",
        p: "TLS in transit. AES-256 at rest. File contents are encrypted with per-tenant keys, managed in a cloud key-management service with automatic rotation.",
      },
      {
        h: "Infrastructure",
        p: "Hosted on isolated virtual networks per environment. Production access is SSO + hardware-key-gated for a small, audited group of engineers.",
      },
      {
        h: "Compliance (in progress)",
        p: "SOC 2 Type II readiness in progress. We follow the GDPR framework for EU/UK data subjects. HIPAA BAA will be made available on Studio plans once our compliance review is complete.",
      },
      {
        h: "Secure SDLC",
        p: "Every PR is reviewed and passes static analysis, dependency scanning, and secret detection before merge. We plan to engage third-party pen-testers annually and publish summaries as they become available.",
      },
      {
        h: "Incident response",
        p: "On-call rotation in place. Customers will be notified promptly and in line with applicable laws in the event of a confirmed breach affecting their data.",
      },
      {
        h: "Report a vulnerability",
        p: `Responsible disclosure is welcomed at ${SUPPORT_EMAIL}. A formal bounty program is in development.`,
      },
    ],
  },
  dpa: {
    title: "Data Processing Addendum",
    updated: "April 2, 2026",
    intro:
      "For customers processing personal data of EU/UK/Swiss data subjects. Auto-executed when you subscribe to any paid plan.",
    disclaimer:
      "Working draft. The subprocessor list below is a current working list; please contact us for the most up-to-date version before relying on it for compliance.",
    sections: [
      {
        h: "Roles",
        p: "You are the Controller of personal data in documents you upload. pdfcraft ai is the Processor acting only on your documented instructions.",
      },
      {
        h: "Subprocessors (current working list)",
        p: "We engage a small number of vetted subprocessors for cloud infrastructure, billing, transactional email, and optional AI inference. A current list is available on request; we will give at least 30 days' notice of material changes.",
      },
      {
        h: "International transfers",
        p: "Where personal data is transferred outside the EEA or UK, we rely on the applicable EU Standard Contractual Clauses and UK IDTA. Data residency options (EU-only) will be made available on Studio plans as our infrastructure build-out completes.",
      },
      {
        h: "Security measures",
        p: "See our Security page for the technical and organizational measures (TOMs) we apply, including encryption, access controls, and our in-progress SOC 2 readiness program.",
      },
      {
        h: "Data subject rights",
        p: "We assist you in responding to access, rectification, deletion, and portability requests within 30 days of your forwarded request.",
      },
      {
        h: "Audits",
        p: `You may audit our compliance annually via written request. We will share in-progress readiness reports under NDA. Requests: ${SUPPORT_EMAIL}.`,
      },
    ],
  },
};

export const LEGAL_SLUGS: LegalSlug[] = ["privacy", "terms", "security", "dpa"];
