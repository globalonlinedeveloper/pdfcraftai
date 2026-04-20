import type { Metadata } from "next";
import { redirect } from "next/navigation";

/**
 * `/account` is a permanent alias for the real settings page at
 * `/app/settings`. We keep this route because public links (pricing page
 * "Configure BYOK" CTA, external emails, marketing collateral) still
 * point at `/account` — shipping a redirect lets those links keep
 * working without duplicating the settings UI.
 *
 * The target is auth-gated: `/app/settings` itself redirects to /login
 * for unauthenticated visitors, which gives us the correct behaviour
 * (signed-in users land on settings, signed-out users land on login).
 */

export const metadata: Metadata = {
  title: "Account",
  robots: { index: false, follow: false },
};

export const dynamic = "force-static";

export default function AccountAliasPage() {
  redirect("/app/settings");
}
