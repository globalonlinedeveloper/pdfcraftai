import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/LegalPage";
import { LEGAL_DOCS } from "@/lib/legal-docs";

const doc = LEGAL_DOCS.dpa;

export const metadata: Metadata = {
  title: `${doc.title} — pdfcraft ai`,
  description: doc.intro,
  alternates: { canonical: "/dpa" },
  openGraph: {
    title: `${doc.title} — pdfcraft ai`,
    description: doc.intro,
    url: "/dpa",
    type: "website",
  },
};

export default function Page() {
  return <LegalPage slug="dpa" doc={doc} />;
}
