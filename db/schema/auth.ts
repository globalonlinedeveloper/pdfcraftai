/**
 * NextAuth v5 (@auth/core) Drizzle adapter tables for MySQL.
 *
 * Matches the shape expected by @auth/drizzle-adapter when instantiated with
 * a MySQL driver. Keep column names aligned with the adapter defaults.
 */

import {
  mysqlTable,
  varchar,
  int,
  text,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/mysql-core";

// Users — Auth.js requires id, name, email, emailVerified, image.
// We extend with passwordHash (Credentials provider) and createdAt.
export const users = mysqlTable(
  "users",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    name: varchar("name", { length: 255 }),
    email: varchar("email", { length: 255 }).unique().notNull(),
    emailVerified: timestamp("email_verified", { fsp: 3 }),
    image: varchar("image", { length: 1024 }),
    passwordHash: varchar("password_hash", { length: 255 }),
    createdAt: timestamp("created_at", { fsp: 3 }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index("users_email_idx").on(t.email),
  })
);

// Accounts — OAuth / social providers linked to a user.
export const accounts = mysqlTable(
  "accounts",
  {
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 32 }).notNull(),
    provider: varchar("provider", { length: 64 }).notNull(),
    providerAccountId: varchar("provider_account_id", { length: 255 }).notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: int("expires_at"),
    token_type: varchar("token_type", { length: 64 }),
    scope: varchar("scope", { length: 512 }),
    id_token: text("id_token"),
    session_state: varchar("session_state", { length: 255 }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
    userIdx: index("accounts_user_idx").on(t.userId),
  })
);

// Sessions — only used when the session strategy is "database".
// We use JWT strategy so this table stays empty, but the adapter expects it to exist.
export const sessions = mysqlTable(
  "sessions",
  {
    sessionToken: varchar("session_token", { length: 255 }).primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { fsp: 3 }).notNull(),
  },
  (t) => ({
    userIdx: index("sessions_user_idx").on(t.userId),
  })
);

// Verification tokens — magic-link / email verification.
export const verificationTokens = mysqlTable(
  "verification_tokens",
  {
    identifier: varchar("identifier", { length: 255 }).notNull(),
    token: varchar("token", { length: 255 }).notNull(),
    expires: timestamp("expires", { fsp: 3 }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.identifier, t.token] }),
  })
);
