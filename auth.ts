/**
 * NextAuth v5 runtime config. Combines the edge-safe base (auth.config.ts)
 * with Node-only providers and the Drizzle adapter.
 *
 * Exports the standard v5 surface: auth, handlers, signIn, signOut.
 */

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { authConfig } from "./auth.config";
import { db, schema } from "./db/client";
import { eq } from "drizzle-orm";
// 2026-05-02 plan §2 path D + §8 layer 6 — signup grant for new
// OAuth users. The helper is idempotent (key = signup_bonus:${userId}),
// so re-firing on subsequent sign-ins is safe. Default OFF until
// SIGNUP_GRANT_ENABLED=true (Day 6 atomic flip).
import { grantSignupBonus } from "@/lib/payments/signup-bonus";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const { auth, handlers, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      allowDangerousEmailAccountLinking: true,
    }),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(creds) {
        const parsed = credentialsSchema.safeParse(creds);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        const rows = await db
          .select({
            id: schema.users.id,
            email: schema.users.email,
            name: schema.users.name,
            image: schema.users.image,
            passwordHash: schema.users.passwordHash,
          })
          .from(schema.users)
          .where(eq(schema.users.email, email))
          .limit(1);

        const user = rows[0];
        if (!user || !user.passwordHash) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          image: user.image ?? undefined,
        };
      },
    }),
  ],
  // 2026-05-02 plan §2 path D wire-in (Day 6 prep) — fire signup
  // bonus on the FIRST sign-in for a brand-new user. NextAuth's
  // `events.signIn` fires after the user row is created by the
  // adapter (DrizzleAdapter inserts on Google's first sign-in for
  // a new email). The `isNewUser` flag tells us this is genuinely
  // a fresh account vs an existing user signing in again.
  //
  // Idempotent — grantSignupBonus uses `signup_bonus:${userId}` as
  // its key, so even if isNewUser misfires (it shouldn't, but
  // belt-and-suspenders), the second call is a no-op.
  //
  // SIGNUP_GRANT_ENABLED defaults OFF (helper returns early). Day 6's
  // atomic flip enables it; until then this code path is exercised
  // for type-checking + import safety but credits don't move.
  events: {
    async signIn({ user, isNewUser }) {
      if (!isNewUser) return;
      const id = user?.id;
      if (typeof id !== "string" || id.length === 0) return;
      try {
        await grantSignupBonus(id);
      } catch (err) {
        // Don't block sign-in on grant failure — log + continue.
        // Failing the sign-in here would lock the user out of an
        // account they just created.
        console.error("grantSignupBonus failed for", id, err);
      }
    },
  },
});
