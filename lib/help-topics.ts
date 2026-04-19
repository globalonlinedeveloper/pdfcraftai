// Help center topics. Ported from prototype content.jsx HELP_TOPICS.

import type { IconName } from "@/components/icons/Icons";

export type HelpTopic = {
  name: string;
  icon: IconName;
  arts: string[]; // article titles
};

export const HELP_TOPICS: HelpTopic[] = [
  {
    name: "Getting started",
    icon: "Zap",
    arts: [
      "Your first PDF merge",
      "Upload file formats we support",
      "How credits work",
      "Creating an account",
    ],
  },
  {
    name: "AI tools",
    icon: "Sparkle",
    arts: [
      "Chat with PDF: prompt tips",
      "Why did my summary cost more credits?",
      "Translating a 200-page PDF",
      "Redacting custom patterns",
    ],
  },
  {
    name: "Security & privacy",
    icon: "Shield",
    arts: [
      "Where are my files stored?",
      "GDPR & DPA",
      "SSO setup",
      "Zero-retention mode",
    ],
  },
  {
    name: "Billing",
    icon: "Credit",
    arts: [
      "Refund policy",
      "Tax invoices & VAT",
      "Team credit sharing",
      "Refilling credits automatically",
    ],
  },
  {
    name: "API & developers",
    icon: "Code",
    arts: [
      "Quickstart in 5 minutes",
      "Webhook signatures",
      "Rate limits",
      "Error codes",
    ],
  },
  {
    name: "Troubleshooting",
    icon: "Help",
    arts: [
      "File won't upload",
      "OCR quality is poor",
      "Chat citations missing pages",
      "I lost my password",
    ],
  },
];
