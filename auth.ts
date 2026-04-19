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
});
