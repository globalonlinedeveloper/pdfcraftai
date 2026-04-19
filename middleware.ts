/**
 * NextAuth v5 middleware — uses the edge-safe config (no Drizzle, no bcrypt)
 * to gate /app/* routes and redirect signed-in users away from /login + /register.
 *
 * The `authorized` callback in auth.config.ts decides allow/deny based on the
 * JWT cookie; anything here is just wiring.
 */
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export const { auth: middleware } = NextAuth(authConfig);

export default middleware;

export const config = {
  // Skip Next internals and static assets.
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
