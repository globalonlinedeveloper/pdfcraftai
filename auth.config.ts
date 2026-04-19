/**
 * Edge-safe auth config. Contains only the bits that the middleware
 * needs to evaluate a JWT — no Drizzle, no bcrypt, no node-only modules.
 *
 * The full config in auth.ts extends this with providers and the Drizzle adapter.
 */

import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = request.nextUrl;

      // App routes require a session.
      const isAppRoute =
        pathname === "/app" || pathname.startsWith("/app/");
      if (isAppRoute) return isLoggedIn;

      // Auth pages redirect signed-in users to the dashboard.
      if ((pathname === "/login" || pathname === "/register") && isLoggedIn) {
        return Response.redirect(new URL("/app/dashboard", request.nextUrl));
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id?: string }).id ?? token.sub ?? "";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token) {
        (session.user as { id?: string }).id =
          (token.id as string | undefined) ?? (token.sub as string | undefined);
      }
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
