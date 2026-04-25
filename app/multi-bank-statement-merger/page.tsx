import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/marketing/SeoLandingPage";
import { SEO_PAGES } from "@/lib/seo-pages";

const data = SEO_PAGES["multi-bank-statement-merger"];

export const metadata: Metadata = {
  title: data.h1,
  description: data.sub,
  alternates: { canonical: data.canonical },
};

export default function Page() {
  return <SeoLandingPage data={data} />;
}
