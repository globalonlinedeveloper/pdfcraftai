import type { Metadata } from "next";
import { redirect } from "next/navigation";

/**
 * `/app/studio` used to host the authenticated Workflow Studio that ran
 * macros server-side. In 2026-04-20 we deleted that runner (commit
 * 10b605c) because the mock Run/Save UX was misleading — Agent and
 * Macros now live exclusively on the public `/studio` and `/macros`
 * routes, where they serve as interactive demos.
 *
 * This file exists only so that old bookmarks, saved sessions, and
 * external links that still point at `/app/studio` don't end up at a
 * 404 after the login dance. The middleware (see auth.config.ts) still
 * gates `/app/*` behind a valid session, so:
 *   - anonymous visitors: middleware bounces to /login?callbackUrl=/app/studio
 *   - after sign-in: they're redirected here, this page redirects
 *     forward to /app/dashboard — a working destination.
 *
 * Target is the dashboard rather than the public /studio because a user
 * who bothered to log in expects an authed destination; they can navigate
 * back out to the public demo from the sidebar.
 */

export const metadata: Metadata = {
  title: "Studio",
  robots: { index: false, follow: false },
};

export const dynamic = "force-static";

export default function AppStudioRedirect() {
  redirect("/app/dashboard");
}
